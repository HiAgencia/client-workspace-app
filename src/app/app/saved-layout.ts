import { cookies } from "next/headers";
import { LAYOUT_COOKIE, readLayoutCookie } from "@/lib/preferences";
import { sessionCookieUser } from "@/lib/supabase/session-owner";
import type { BoardLayout } from "./board-layout";
import { STARTED_COOKIE, startedFor } from "./started";

export async function savedLayout(page: string): Promise<{ board: BoardLayout | null; layout: "list" | "board" | null; settled: boolean }> {
  const jar = await cookies();
  const session = sessionCookieUser(jar.getAll());
  const saved = readLayoutCookie(jar.get(LAYOUT_COOKIE)?.value, session?.id ?? null);
  const settled = session?.isAnonymous === true || startedFor(jar.get(STARTED_COOKIE)?.value, session?.id ?? null);
  return { board: saved.boards[page] ?? null, layout: saved.layouts[page] ?? null, settled };
}
