import { z } from "zod";
import { creditCapMicroUsd, keyHint, saveOwnKey, serverSpent } from "@/lib/chat/credits";
import { META_BASE_URL } from "@/lib/chat/model";
import { serverEnv } from "@/lib/env";
import { json, problem, sameOrigin } from "@/lib/http";
import { requireUser, serviceClient, userClient } from "@/lib/supabase/server";

const body = z.object({ key: z.string().trim().min(8).max(512) });

export async function GET() {
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const service = serviceClient();
  const saved = await service.from("ai_keys").select("hint").eq("owner_id", who.user.id).maybeSingle();
  if (saved.error) return problem(500, "the key could not be read");
  const spent = serverSpent(service);
  const serverKey = Boolean(serverEnv("MODEL_API_KEY"));
  const left = serverKey && ((await spent) ?? Number.POSITIVE_INFINITY) < creditCapMicroUsd();
  return json({ ok: true, hint: saved.data?.hint ?? null, freeCredits: left });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  let parsed;
  try {
    parsed = body.safeParse(await request.json());
  } catch {
    return problem(400, "the body must be JSON");
  }
  if (!parsed.success) return problem(422, "paste the whole key");
  const apiKey = parsed.data.key;
  let check: Response;
  try {
    check = await fetch(`${META_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return problem(504, "Meta did not answer to check the key: try again");
  }
  if (check.status === 401 || check.status === 403) return problem(422, "Meta did not accept this key");
  if (!check.ok) return problem(502, "Meta could not check the key right now: try again");
  if (!(await saveOwnKey(serviceClient(), who.user.id, apiKey))) return problem(500, "the key could not be saved");
  return json({ ok: true, hint: keyHint(apiKey) });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const { error } = await serviceClient().from("ai_keys").delete().eq("owner_id", who.user.id);
  if (error) return problem(500, "the key could not be removed");
  return json({ ok: true });
}
