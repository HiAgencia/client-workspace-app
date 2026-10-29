import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, readPreferences, savePreferences } from "@/lib/preferences";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// A person's preferences through the functions the route calls, against the real database: the defaults before the first
// save, one row per person, each change kept beside the others, and a page forgotten on null.

let user: DisposableUser | undefined;

beforeAll(async () => {
  user = await createDisposableUser("preferences");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

describe("preferences", () => {
  it("start as the defaults, keep each change beside the others in one row, and forget a page on null", async () => {
    const db = user!.client;
    expect(await readPreferences(db, user!.id)).toEqual({ ok: true, preferences: DEFAULT_PREFERENCES });
    expect(DEFAULT_PREFERENCES.dailyReview).toBe(true);

    const boxes = await savePreferences(db, user!.id, { page: "overview", board: { order: ["tasks", "calendar"], hidden: ["activity"] } });
    expect(boxes.ok && boxes.preferences.boards.overview).toEqual({ order: ["tasks", "calendar"], hidden: ["activity"] });
    const layout = await savePreferences(db, user!.id, { page: "tasks", layout: "board" });
    const review = await savePreferences(db, user!.id, { dailyReview: false, dailyReviewInstruction: "Look at what is late first." });
    expect(review).toEqual({
      ok: true,
      preferences: {
        boards: { overview: { order: ["tasks", "calendar"], hidden: ["activity"] } },
        layouts: { tasks: "board" },
        dailyReview: false,
        dailyReviewInstruction: "Look at what is late first.",
      },
    });
    expect(layout.ok).toBe(true);

    const forgotten = await savePreferences(db, user!.id, { page: "overview", board: null });
    expect(forgotten.ok && forgotten.preferences.boards).toEqual({});
    const rows = await serviceClient().from("preferences").select("owner_id").eq("owner_id", user!.id);
    expect(rows.data).toHaveLength(1);
  });

  it("a stored page that no longer reads is left out, and the rest is kept", async () => {
    const { error } = await serviceClient()
      .from("preferences")
      .update({ layouts: { tasks: "list", "not a page": "board", overview: "grid" } })
      .eq("owner_id", user!.id);
    expect(error).toBeNull();
    const read = await readPreferences(user!.client, user!.id);
    expect(read.ok && read.preferences.layouts).toEqual({ tasks: "list" });
  });
});
