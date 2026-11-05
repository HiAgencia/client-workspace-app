import { z } from "zod";
import { decryptAuthorized, storeAuthorizedAccount } from "@/lib/google/connect";
import { hashLinkToken, LINK_LIFETIME_MS, newLinkToken } from "@/lib/google/connect-links";
import { googleDeps, missingGoogleConfig } from "@/lib/google/deps";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { requireUser, serviceClient, userClient } from "@/lib/supabase/server";

type LinkRow = {
  id: string;
  node_id: string;
  status: string;
  email: string | null;
  expires_at: string;
  created_at: string;
};

function shown(link: LinkRow) {
  return { id: link.id, nodeId: link.node_id, status: link.status, email: link.email, expiresAt: link.expires_at, createdAt: link.created_at };
}

export async function GET() {
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const service = serviceClient();
  await service
    .from("google_connect_links")
    .update({ status: "cancelled", refresh_token: null, access_token: null })
    .eq("owner_id", who.user.id)
    .in("status", ["pending", "authorized"])
    .lte("expires_at", new Date().toISOString());
  const { data, error } = await service
    .from("google_connect_links")
    .select("id, node_id, status, email, expires_at, created_at")
    .eq("owner_id", who.user.id)
    .in("status", ["pending", "authorized"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return problem(500, "the connect links could not be loaded");
  return json({ ok: true, links: data.map(shown) });
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), nodeId: z.uuid() }),
  z.object({ action: z.literal("accept"), id: z.uuid() }),
  z.object({ action: z.literal("reject"), id: z.uuid() }),
  z.object({ action: z.literal("cancel"), id: z.uuid() }),
]);

export async function POST(request: Request) {
  const parsed = await readInput(request, input);
  if (!parsed.ok) return parsed.response;
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const { user } = who;
  if (user.isAnonymous) return problem(403, "the demo does not connect Google accounts: sign in with Google to connect yours");
  const service = serviceClient();
  const value = parsed.value;

  if (value.action === "create") {
    if (missingGoogleConfig().length > 0) return problem(503, `connecting accounts is not configured: ${missingGoogleConfig().join(", ")}`);
    const { data: node, error } = await db.from("nodes").select("id").eq("id", value.nodeId).maybeSingle();
    if (error) return problem(500, "the node could not be loaded");
    if (!node) return problem(404, "no such node");
    await service
      .from("google_connect_links")
      .update({ status: "cancelled", refresh_token: null, access_token: null })
      .eq("owner_id", user.id)
      .eq("node_id", value.nodeId)
      .eq("status", "pending");
    const token = newLinkToken();
    const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS).toISOString();
    const { data, error: insertError } = await service
      .from("google_connect_links")
      .insert({ owner_id: user.id, node_id: value.nodeId, token_hash: await hashLinkToken(token), expires_at: expiresAt })
      .select("id, node_id, status, email, expires_at, created_at")
      .single();
    if (insertError) return problem(500, "the connect link could not be created");
    const url = new URL(`/connect/google/${token}`, new URL(request.url).origin);
    return json({ ok: true, link: shown(data), url: url.toString() });
  }

  const { data: link, error } = await service
    .from("google_connect_links")
    .select("id, owner_id, node_id, status, email, refresh_token, access_token, access_token_expires_at, scopes, expires_at")
    .eq("id", value.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) return problem(500, "the connect link could not be loaded");
  if (!link) return problem(404, "no such connect link");

  if (value.action === "cancel" || value.action === "reject") {
    const status = value.action === "cancel" ? "cancelled" : "rejected";
    const { error: updateError } = await service
      .from("google_connect_links")
      .update({ status, refresh_token: null, access_token: null })
      .eq("id", link.id)
      .in("status", ["pending", "authorized"]);
    if (updateError) return problem(500, "the connect link could not be closed");
    return json({ ok: true });
  }

  if (link.status !== "authorized" || !link.email || !link.refresh_token || !link.access_token || !link.access_token_expires_at) {
    return problem(422, "this link has no authorized account waiting");
  }
  if (Date.parse(link.expires_at) < Date.now()) {
    await service.from("google_connect_links").update({ status: "cancelled", refresh_token: null, access_token: null }).eq("id", link.id).eq("status", "authorized");
    return problem(422, "this connect link has expired");
  }
  const deps = await googleDeps();
  if (!deps) return problem(503, `connecting accounts is not configured: ${missingGoogleConfig().join(", ")}`);
  const claim = await service
    .from("google_connect_links")
    .update({ status: "accepted" })
    .eq("id", link.id)
    .eq("owner_id", user.id)
    .eq("status", "authorized")
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (claim.error) return problem(500, "the connect link could not be accepted");
  if (!claim.data || claim.data.length === 0) return problem(422, "this link is no longer waiting to be accepted");
  try {
    const authorized = await decryptAuthorized(deps, {
      email: link.email,
      refresh_token: link.refresh_token,
      access_token: link.access_token,
      access_token_expires_at: link.access_token_expires_at,
      scopes: link.scopes,
    });
    await storeAuthorizedAccount(deps, { ownerId: user.id, nodeId: link.node_id }, authorized);
  } catch (caught) {
    console.error("connect link accept:", caught instanceof Error ? caught.message : caught);
    await service.from("google_connect_links").update({ status: "authorized" }).eq("id", link.id).eq("status", "accepted");
    return problem(422, "the authorized account could not be connected: connect it again");
  }
  const { error: updateError } = await service
    .from("google_connect_links")
    .update({ refresh_token: null, access_token: null })
    .eq("id", link.id)
    .eq("status", "accepted");
  if (updateError) console.error("connect link accept, clearing its tokens:", updateError.message);
  return json({ ok: true });
}
