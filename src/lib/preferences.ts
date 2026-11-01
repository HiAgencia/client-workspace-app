import { z } from "zod";
import type { Db } from "@/lib/db/client";






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



export const preferencesChange = z
  .strictObject({
    page: pageKey,
    board: boardSchema.nullable().optional(),
    layout: layoutSchema.nullable().optional(),
  })
  .refine((value) => value.board !== undefined || value.layout !== undefined, { message: "nothing to change" });

export const DEFAULT_PREFERENCES: Preferences = { boards: {}, layouts: {} };


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




export async function savePreferences(
  db: Db,
  _ownerId: string,
  change: z.infer<typeof preferencesChange>,
): Promise<{ ok: true; preferences: Preferences } | { ok: false; message: string }> {
  
  const none = null as unknown as string;
  const { data, error } = await db
    .rpc("save_preferences", {
      p_page: change.page,
      p_board: (change.board ?? null) as never,
      p_board_clear: change.board === null,
      p_layout: change.layout ?? none,
      p_layout_clear: change.layout === null,
    })
    .single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, preferences: fromRow(data as Row) };
}





export const LAYOUT_COOKIE = "cw_layout";
const COOKIE_BUDGET = 3500;

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
