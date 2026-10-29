import { json, problem } from "@/lib/http";
import { LAYOUT_COOKIE, layoutCookie, preferencesChange, readPreferences, savePreferences } from "@/lib/preferences";
import { readInput } from "@/lib/route-input";
import { currentUser, userClient } from "@/lib/supabase/server";

// A person's preferences: the order of the boxes and list or board on each page, and the daily review. Everything runs
// as the signed-in person under row-level security. A write also sets the layout cookie the server reads, so the next
// load of a page enters in its order.
export async function GET() {
  const db = await userClient();
  const user = await currentUser(db);
  if (!user) return problem(401, "not signed in");
  const read = await readPreferences(db, user.id);
  if (!read.ok) {
    console.error("preferences:", read.message);
    return problem(500, "the preferences could not be read");
  }
  return json({ ok: true, preferences: read.preferences });
}

export async function POST(request: Request) {
  const input = await readInput(request, preferencesChange);
  if (!input.ok) return input.response;
  const db = await userClient();
  const user = await currentUser(db);
  if (!user) return problem(401, "not signed in");
  const saved = await savePreferences(db, user.id, input.value);
  if (!saved.ok) {
    console.error("saving preferences:", saved.message);
    return problem(500, "the preferences could not be saved");
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true, preferences: saved.preferences }, 200, {
    "Set-Cookie": `${LAYOUT_COOKIE}=${layoutCookie(saved.preferences, input.value.page, user.id)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`,
  });
}

// Signing out clears the layout cookie, which the browser's script cannot reach.
export async function DELETE(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, { "Set-Cookie": `${LAYOUT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}` });
}
