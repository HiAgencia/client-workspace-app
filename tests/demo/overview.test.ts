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

  it("show the two possible replies the picture names for the app review, and leave the task open", async () => {
    if (!user) throw new Error("the test user was not created");
    
    expect((await user.client.rpc("seed_demo", { p_today: TODAY })).error).toBeNull();
    const ctx: ToolContext = { db: user.client, ownerId: user.id, source: "manual" };
    const view = (await callTool("get_tasks", ctx, { today: TODAY })) as unknown as TasksView;
    const { groups } = view;
    const rows = [...groups.overdue.tasks, ...groups.today.tasks, ...groups.upcoming.days.flatMap((day) => day.tasks), ...groups.noDate.tasks];
    const task = rows.find((row) => row.title === "Wait for the app review approval");
    expect(task?.mail).toMatchObject({ waitsFor: "Developer Platform", dismissed: [] });
    const read = (await callTool("list_task_replies", ctx, { task: task!.id })) as unknown as { ok: boolean; replies: Array<{ subject: string }> };
    expect(read.ok).toBe(true);
    
    expect(read.replies.map((reply) => reply.subject)).toEqual(["Your app review was approved", "API changes coming in November"]);
    const after = await user.client.from("items").select("status").eq("id", task!.id).single();
    expect(after.data?.status).toBe("open");
  });
});
