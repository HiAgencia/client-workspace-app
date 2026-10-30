import { z } from "zod";
import type { Db } from "@/lib/db/client";

// A person's preferences, one row each: the order of the boxes on each page and the ones hidden, and list or board on each
// page. Not offered to models: the screens read and write them through their own route. The server also keeps the page
// layout in a cookie it reads, so a page enters already in its order.

// A page: the Overview, Tasks, or one client's or project's page.
export const pageKey = z.string().regex(/^(overview|tasks|node:[0-9a-f-]{36})$/, "a page is overview, tasks, or node:<id>");

const boxId = z.string().regex(/^[a-z][a-z_]{0,31}$/, "a box is named in lowercase letters and underscores");

export const boardSchema = z.strictObject({
  order: z.array(boxId).max(24),
  hidden: z.array(boxId).max(24).default([]),
});

export const layoutSchema = z.enum(["list", "board"]);

export const preferencesSchema = z.object({
  boards: z.record(pageKey, boardSchema),
  layouts: z.record(pageKey, layoutSchema),
});

export type Preferences = z.infer<typeof preferencesSchema>;

// What a write changes: one page's boxes or its layout. Sending null for either forgets it, so the page goes back to its
// default.
export const preferencesChange = z
  .strictObject({
    page: pageKey,
    board: boardSchema.nullable().optional(),
    layout: layoutSchema.nullable().optional(),
  })
  .refine((value) => value.board !== undefined || value.layout !== undefined, { message: "nothing to change" });

export const DEFAULT_PREFERENCES: Preferences = { boards: {}, layouts: {} };

// A stored map that no longer reads (a page or a box the schema left) keeps what still does.
function readMap<T>(value: unknown, entry: z.ZodType<T>): Record<string, T> {
  const out: Record<string, T> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value)) {
    const parsed = entry.safeParse(raw);
    if (pageKey.safeParse(key).success && parsed.success) out[key] = parsed.data;
  }
  return out;
}

type Row = { boards: unknown; layouts: unknown };

function fromRow(row: Row | null): Preferences {
  if (!row) return DEFAULT_PREFERENCES;
  return { boards: readMap(row.boards, boardSchema), layouts: readMap(row.layouts, layoutSchema) };
}

const COLUMNS = "boards, layouts";

export async function readPreferences(db: Db, ownerId: string): Promise<{ ok: true; preferences: Preferences } | { ok: false; message: string }> {
  const { data, error } = await db.from("preferences").select(COLUMNS).eq("owner_id", ownerId).maybeSingle();
  if (error) return { ok: false, message: error.message };
  return { ok: true, preferences: fromRow(data) };
}

// One write, key by key in the database: the row is created with the change on its first save, and after that only the
// page's boxes or its layout change, so two changes at once both stay. It runs as the signed-in person, whose row it
// writes.
export async function savePreferences(
  db: Db,
  _ownerId: string,
  change: z.infer<typeof preferencesChange>,
): Promise<{ ok: true; preferences: Preferences } | { ok: false; message: string }> {
  // The generated types do not say these take null; the function does.
  const none = null as unknown as string;
  const { data, error } = await db
    .rpc("save_preferences", {
      p_page: change.page,
      p_board: (change.board ?? null) as never,
      p_board_clear: change.board === null,
      p_layout: change.layout ?? none,
      p_layout_clear: change.layout === null,
      // The function still takes the daily review's two arguments until its columns leave; nothing sends them.
      p_daily_review: null as unknown as boolean,
      p_instruction: none,
    })
    .single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, preferences: fromRow(data as Row) };
}

// The cookie the server reads to paint a page in its order before the browser asks: the boxes and the layout of the pages,
// the page just written first, within what a browser keeps of one cookie. A page left out enters in its default order
// and reads its own from the route. It names its owner, so another person signing in on the same browser does not get
// it; signing out clears it.
export const LAYOUT_COOKIE = "cw_layout";
const COOKIE_BUDGET = 3500;
// The key that names the owner; no page is named so.
const OWNER_KEY = "_o";

export function layoutCookie(preferences: Preferences, first?: string, ownerId?: string): string {
  const pages = [...new Set([...(first ? [first] : []), "overview", "tasks", ...Object.keys(preferences.boards), ...Object.keys(preferences.layouts)])];
  const kept: Record<string, { b?: z.infer<typeof boardSchema>; l?: z.infer<typeof layoutSchema> } | string> = ownerId ? { [OWNER_KEY]: ownerId } : {};
  for (const page of pages) {
    const entry = { ...(preferences.boards[page] ? { b: preferences.boards[page] } : {}), ...(preferences.layouts[page] ? { l: preferences.layouts[page] } : {}) };
    if (!entry.b && !entry.l) continue;
    const trial = { ...kept, [page]: entry };
    if (encodeURIComponent(JSON.stringify(trial)).length > COOKIE_BUDGET) continue;
    kept[page] = entry;
  }
  return encodeURIComponent(JSON.stringify(kept));
}

const cookieEntry = z.object({ b: boardSchema.optional(), l: layoutSchema.optional() });

// What the server reads back from the cookie; anything that does not read is left out. Given the person reading, a
// cookie that names someone else, or no one, reads as empty.
export function readLayoutCookie(value: string | undefined, ownerId?: string | null): Pick<Preferences, "boards" | "layouts"> {
  const out: Pick<Preferences, "boards" | "layouts"> = { boards: {}, layouts: {} };
  if (!value) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  if (ownerId !== undefined && (parsed as Record<string, unknown>)[OWNER_KEY] !== ownerId) return out;
  for (const [page, raw] of Object.entries(parsed)) {
    const entry = cookieEntry.safeParse(raw);
    if (!pageKey.safeParse(page).success || !entry.success) continue;
    if (entry.data.b) out.boards[page] = entry.data.b;
    if (entry.data.l) out.layouts[page] = entry.data.l;
  }
  return out;
}
