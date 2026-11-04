import { json, problem } from "@/lib/http";
import { LAYOUT_COOKIE, layoutCookie, preferencesChange, readPreferences, savePreferences } from "@/lib/preferences";
import { readInput } from "@/lib/route-input";
import { requireUser, userClient } from "@/lib/supabase/server";

export async function GET() {
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const { user } = who;
  const read = await readPreferences(db, user.id);
  if (!read.ok) {
    console.error("preferences:", read.message);
    return problem(500, "the preferences could not be loaded");
  }
  return json({ ok: true, preferences: read.preferences });
}

export async function POST(request: Request) {
  const input = await readInput(request, preferencesChange);
  if (!input.ok) return input.response;
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const { user } = who;
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

export async function DELETE(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, { "Set-Cookie": `${LAYOUT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}` });
}
