import { z } from "zod";
import { creditCapMicroUsd, keyHint, ownKey, saveOwnKey, serverSpent } from "@/lib/chat/credits";
import { chatProvider, META_BASE_URL } from "@/lib/chat/model";
import { serverEnv } from "@/lib/env";
import { json, problem, sameOrigin } from "@/lib/http";
import { requireUser, serviceClient, userClient } from "@/lib/supabase/server";

const body = z.object({ key: z.string().trim().min(8).max(512).regex(/^[!-~]+$/) });

export async function GET() {
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const service = serviceClient();
  const [saved, own] = await Promise.all([service.from("ai_keys").select("hint").eq("owner_id", who.user.id).maybeSingle(), ownKey(service, who.user.id)]);
  if (saved.error || own.state === "error") return problem(500, "the key could not be read");
  let freeCredits: boolean | null = null;
  if (chatProvider() === "meta" && serverEnv("MODEL_API_KEY")) {
    const spent = await serverSpent(service);
    if (spent === null) return problem(500, "the credits could not be read");
    freeCredits = spent < creditCapMicroUsd();
  }
  return json({ ok: true, hint: saved.data?.hint ?? null, broken: own.state === "broken", freeCredits });
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
  if (!parsed.success) return problem(422, "paste the whole key, with nothing around it");
  const apiKey = parsed.data.key;
  let check: Response;
  try {
    check = await fetch(`${META_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("ai key: the check did not answer", error instanceof Error ? error.name : error);
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
