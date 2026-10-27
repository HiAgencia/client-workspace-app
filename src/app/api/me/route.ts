import { json, problem } from "@/lib/http";
import { currentUser, userClient } from "@/lib/supabase/server";

// Who the session belongs to, as the server sees it.
export async function GET() {
  const user = await currentUser(await userClient());
  if (!user) return problem(401, "not signed in");
  return json({ ok: true, user });
}
