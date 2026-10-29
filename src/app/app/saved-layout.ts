import { cookies } from "next/headers";
import { LAYOUT_COOKIE, readLayoutCookie } from "@/lib/preferences";
import { sessionOwner } from "@/lib/supabase/session-owner";
import type { BoardLayout } from "./boxes";

// What a page's person saved —the order of its boxes, list or board—, read on the server from the layout cookie so the
// page's first HTML is already in that order. A page the cookie does not carry enters in its default, and so does every
// page when the cookie is another person's.
export async function savedLayout(page: string): Promise<{ board: BoardLayout | null; layout: "list" | "board" | null }> {
  const jar = await cookies();
  const saved = readLayoutCookie(jar.get(LAYOUT_COOKIE)?.value, sessionOwner(jar.getAll()));
  return { board: saved.boards[page] ?? null, layout: saved.layouts[page] ?? null };
}
