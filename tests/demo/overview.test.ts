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
    const asked = (await callTool("list_tree", ctx, { withMail: true })) as unknown as { mail: { accounts: Array<{ id: string }> } };
    
    const inboxes = await Promise.all(asked.mail.accounts.map((account) => callTool("list_mail", ctx, { account: account.id })));
    const failed = [view, ...inboxes].find((answer) => !answer.ok);
    if (failed) throw new Error(`reading the Overview: ${JSON.stringify(failed)}`);
    const { groups } = view as unknown as TasksView;
    const figures = demoOverview(TODAY);
    expect({
      overdue: groups.overdue.count,
      today: groups.today.count,
      unread: inboxes.reduce((sum, inbox) => sum + ((inbox as unknown as { unread: number | null }).unread ?? 0), 0),
    }).toEqual(figures);
    
    expect(figures.overdue + figures.today).toBeGreaterThan(0);
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
    type Read = { ok: boolean; toRead: string[]; replies: Array<{ subject: string; receivedAt: string }> };
    const read = (await callTool("list_task_replies", ctx, { task: task!.id })) as unknown as Read;
    expect(read.ok).toBe(true);
    const each = await Promise.all(read.toRead.map((account) => callTool("list_task_replies", ctx, { task: task!.id, account }) as unknown as Promise<Read>));
    const replies = [read, ...each].flatMap((answer) => answer.replies).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    
    expect(replies.map((reply) => reply.subject)).toEqual(["Your app review was approved", "API changes coming in November"]);
    const after = await user.client.from("items").select("status").eq("id", task!.id).single();
    expect(after.data?.status).toBe("open");
  });
});
