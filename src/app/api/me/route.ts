import { json } from "@/lib/http";
import { requireUser, userClient } from "@/lib/supabase/server";

export async function GET() {
  const who = await requireUser(await userClient());
  if (!who.ok) return who.response;
  const { user } = who;
  return json({ ok: true, user });
}
