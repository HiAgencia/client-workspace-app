import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoOverview } from "@/lib/demo-seed";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import type { TasksView } from "@/lib/tools/tasks";
import { createAnonymousUser, deleteDisposableUsers, type DisposableUser } from "../support/supabase";




const TODAY = "2026-10-27";
let user: DisposableUser | undefined;

beforeAll(async () => {
  user = await createAnonymousUser("demo-overview");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

describe("the demo's Overview figures", () => {
  it("are the ones the landing's picture says", async () => {
    if (!user) throw new Error("the test user was not created");
    const planted = await user.client.rpc("seed_demo", { p_today: TODAY });
    expect(planted.error).toBeNull();
    expect(planted.data).toBe(true);
    const ctx: ToolContext = { db: user.client, ownerId: user.id, source: "manual" };
    const view = await callTool("get_tasks", ctx, { today: TODAY });
    const inbox = await callTool("list_mail", ctx, {});
    if (!view.ok || !inbox.ok) throw new Error(`reading the Overview: ${JSON.stringify(view.ok ? inbox : view)}`);
    const { groups } = view as unknown as TasksView;
    const figures = demoOverview(TODAY);
    expect({
      overdue: groups.overdue.count,
      today: groups.today.count,
      upcoming: groups.upcoming.count,
      
      scheduled: groups.overdue.count + groups.today.count + groups.upcoming.count,
      unread: (inbox as unknown as { unread: number }).unread,
    }).toEqual(figures);
    
    expect(figures.scheduled).toBeGreaterThan(0);
    expect(figures.unread).toBeGreaterThan(0);
  });
});
