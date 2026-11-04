import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { withInitialCapital } from "@/lib/initial-capital";
import { writtenBody } from "@/lib/inline-links";
import { mailFailureSchema, waitWords, type MailMessage } from "@/lib/mail/source";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { origin, reachableItem, richText } from "./items";
import { accountsOf, failuresByAccount, mailOf, rowsOf, type ReachedAccount } from "./mail";
import { mailRowSchema, taskMailSchema, type TaskMail } from "./mail-schema";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { itemSchema, toItem } from "./rows";
import type { ReadPlace, Scope } from "./tree";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];

const TASK_MAIL_COLUMNS = "item_id, account_id, waits_for, dismissed, created_at";

type TaskMailRow = { item_id: string; account_id: string | null; waits_for: string; dismissed: string[]; created_at: string };

function toTaskMail(row: TaskMailRow): TaskMail {
  return { accountId: row.account_id, waitsFor: row.waits_for, since: row.created_at, dismissed: row.dismissed };
}

const IN_CHUNK = 200;

const PAGE = 1000;

export async function everyTaskMail(ctx: ToolContext): Promise<ToolResult<{ rows: TaskMailRow[] }>> {
  const rows: TaskMailRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.db.from("task_mail").select(TASK_MAIL_COLUMNS).eq("owner_id", ctx.ownerId).order("item_id").range(from, from + PAGE - 1);
    if (error) return dbFail("reading what the tasks wait for", error);
    rows.push(...(data as TaskMailRow[]));
    if (data.length < PAGE) return ok({ rows });
  }
}

export function taskMailIn(rows: TaskMailRow[], itemIds: string[]): Map<string, TaskMail> {
  const ids = new Set(itemIds);
  const byTask = new Map<string, TaskMail>();
  for (const row of rows) if (ids.has(row.item_id)) byTask.set(row.item_id, toTaskMail(row));
  return byTask;
}

export async function taskMailOf(ctx: ToolContext, itemIds: string[]): Promise<ToolResult<{ byTask: Map<string, TaskMail> }>> {
  const byTask = new Map<string, TaskMail>();
  if (itemIds.length === 0) return ok({ byTask });
  const ids = [...new Set(itemIds)];
  for (let start = 0; start < ids.length; start += IN_CHUNK) {
    const { data, error } = await ctx.db
      .from("task_mail")
      .select(TASK_MAIL_COLUMNS)
      .eq("owner_id", ctx.ownerId)
      .in("item_id", ids.slice(start, start + IN_CHUNK));
    if (error) return dbFail("reading what the tasks wait for", error);
    for (const row of data as TaskMailRow[]) byTask.set(row.item_id, toTaskMail(row));
  }
  return ok({ byTask });
}

function placeOf(scope: Scope, nodeId: string | null): ReadPlace {
  return nodeId ? { kind: "node", node: scope.all.get(nodeId)! } : { kind: "all" };
}

const replyKey = (accountId: string, messageId: string) => `${accountId}:${messageId}`;

export const setTaskMail = defineTool({
  name: "set_task_mail",
  description:
    "Say that a task waits for a message, in the person's words —who sends it or what it is about, such as «Meta» or " +
    "«app review»—, in one account or in every account of its place; or that it waits for none (waiting false). The " +
    "task then shows the messages that arrive with those words in their sender or subject as possible replies, and the " +
    "person decides which one answers it. Use it when someone says they are waiting for a message. To put back a wait as " +
    "`previous` gave it, pass its since and dismissed too.",
  readOnly: false,
  input: z.strictObject({
    task: z.uuid(),
    waiting: z.boolean().default(true),
    account: z.uuid().nullable().optional().describe("The account it arrives in; null or omitted for every account of the task's place."),
    words: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("What it waits for, in the person's words: every word is looked for in the sender's name or address and in the subject."),
    since: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("Only to put back a wait that was let go: the moment it began, as `previous` gave it. A new wait begins now; one that already waits keeps its own."),
    dismissed: z
      .array(z.string().regex(/^[0-9a-f-]{36}:.{1,200}$/, "each ruled-out reply is `<account id>:<message id>`, as previous gave it"))
      .optional()
      .describe("Only to put back a wait as `previous` gave it: the replies it had ruled out, each `<account id>:<message id>`."),
  }),
  output: z.object({ task: z.string(), title: z.string(), mail: taskMailSchema.nullable(), previous: taskMailSchema.nullable() }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    if (found.row.type !== "task") return fail("invalid_input", `a ${found.row.type} does not wait for mail: a task does`);
    if (!origin(ctx)) return fail("internal", "an agent write needs its token's label");
    const before = await taskMailOf(ctx, [found.row.id]);
    if (isError(before)) return before;
    const previous = before.byTask.get(found.row.id) ?? null;
    if (!input.waiting) {
      const { error } = await ctx.db.from("task_mail").delete().eq("item_id", found.row.id).eq("owner_id", ctx.ownerId);
      if (error) return dbFail("letting go of what the task waits for", error);
      return ok({ task: found.row.id, title: found.row.title, mail: null, previous });
    }
    const words = input.words ?? (previous?.waitsFor || undefined);
    if (!words || waitWords(words).length === 0) {
      return fail("invalid_input", "say what the task waits for: who sends it or what it is about, with at least one word");
    }
    if (input.account) {
      const reached = await accountsOf(ctx, found.scope, placeOf(found.scope, found.row.node_id));
      if (isError(reached)) return reached;
      if (!reached.accounts.some((account) => account.id === input.account)) {
        return fail("not_found", "that account is not connected where the task lives: connect it there in Settings, or choose another");
      }
    }
    if (input.since !== undefined && Date.parse(input.since) < Date.parse(found.row.created_at)) {
      return fail("invalid_input", "a wait cannot begin before its task existed");
    }
    const wanted = { account_id: input.account === undefined ? (previous?.accountId ?? null) : input.account, waits_for: words };
    const changed = previous !== null && (previous.accountId !== wanted.account_id || previous.waitsFor !== wanted.waits_for);
    const rulings = input.dismissed ? { dismissed: input.dismissed } : changed ? { dismissed: [] } : {};
    const update = () =>
      ctx.db
        .from("task_mail")
        .update({ ...wanted, ...rulings })
        .eq("item_id", found.row.id)
        .eq("owner_id", ctx.ownerId)
        .select(TASK_MAIL_COLUMNS)
        .single();
    const first = previous
      ? await update()
      : await ctx.db
          .from("task_mail")
          .insert({ item_id: found.row.id, owner_id: ctx.ownerId, ...wanted, ...rulings, ...(input.since ? { created_at: input.since } : {}) })
          .select(TASK_MAIL_COLUMNS)
          .single();
    let replaced = previous;
    let written = first;
    if (!previous && first.error?.code === "23505") {
      const now = await taskMailOf(ctx, [found.row.id]);
      if (isError(now)) return now;
      replaced = now.byTask.get(found.row.id) ?? null;
      written = await update();
    }
    const { data, error } = written;
    if (error) return dbFail("saving what the task waits for", error);
    return ok({ task: found.row.id, title: found.row.title, mail: toTaskMail(data as TaskMailRow), previous: replaced });
  },
});

const waitingTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "done"]),
  accountId: z.string().nullable(),
  waitsFor: z.string(),
  since: z.string(),
});

async function waitAccounts(ctx: ToolContext, scope: Scope, nodeId: string | null, wait: TaskMail, only?: string): Promise<ToolResult<{ accounts: ReachedAccount[] }>> {
  const reached = await accountsOf(ctx, scope, placeOf(scope, nodeId));
  if (isError(reached)) return reached;
  let accounts = wait.accountId ? reached.accounts.filter((account) => account.id === wait.accountId) : reached.accounts;
  if (wait.accountId && accounts.length === 0) {
    return fail("not_found", "the account the task waits in is not connected where the task lives anymore: choose where it waits in the task");
  }
  if (only) {
    accounts = accounts.filter((account) => account.id === only);
    if (accounts.length === 0) return fail("not_found", "the task does not wait for mail in that account");
  }
  return ok({ accounts });
}

export const listTaskReplies = defineTool({
  name: "list_task_replies",
  description:
    "The possible replies to what a task waits for: the messages that arrived since it started waiting, in the accounts " +
    "it waits in, whose sender or subject holds every word of what it waits for, newest first, without the ones the " +
    "person ruled out. One account per call: without account, over a task that waits in several, it reads none and toRead " +
    "lists them, each read with its own call. None of them is the answer until the person says so; read them to tell the " +
    "person which one seems to answer, and close the task with complete_task only when the person asks.",
  readOnly: true,
  input: z.strictObject({
    task: z.uuid(),
    account: z.uuid().optional().describe("Only this account; omit it for every account the task waits in."),
    limit: z.number().int().min(1).max(100).default(20).describe("How many replies to read of each account."),
    pageToken: z.string().min(1).max(1000).optional().describe("Where the next replies of the one account asked for start, as `next` gave it."),
  }),
  output: z.object({
    task: waitingTaskSchema,
    accounts: z.array(z.object({ id: z.string(), email: z.string() })),
    toRead: z.array(z.string()),
    replies: z.array(mailRowSchema),
    more: z.array(z.string()),
    next: z.record(z.string(), z.string()),
    failures: z.array(mailFailureSchema),
  }),
  async run(ctx, input) {
    if (input.pageToken !== undefined && input.account === undefined) return fail("invalid_input", "a page token reads one account: say which in account");
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    if (found.row.type !== "task") return fail("invalid_input", `a ${found.row.type} does not wait for mail: a task does`);
    const waits = await taskMailOf(ctx, [found.row.id]);
    if (isError(waits)) return waits;
    const wait = waits.byTask.get(found.row.id);
    if (!wait) return fail("not_found", "the task waits for no mail");
    const task = { id: found.row.id, title: found.row.title, status: found.row.status, accountId: wait.accountId, waitsFor: wait.waitsFor, since: wait.since };
    const reached = await waitAccounts(ctx, found.scope, found.row.node_id, wait, input.account);
    if (isError(reached)) return reached;
    const accounts = reached.accounts.map(({ id, email }) => ({ id, email }));
    const words = waitWords(wait.waitsFor);
    const nothing = { replies: [], more: [], next: {}, failures: [] };
    if (words.length === 0 || reached.accounts.length === 0) return ok({ task, accounts, toRead: [], ...nothing });
    if (reached.accounts.length > 1) return ok({ task, accounts, toRead: accounts.map((account) => account.id), ...nothing });
    const [account] = reached.accounts;
    const answer = await mailOf(ctx).candidates({ db: ctx.db, ownerId: ctx.ownerId, account, since: wait.since, words, limit: input.limit, pageToken: input.pageToken });
    const ruledOut = new Set(wait.dismissed);
    const messages = answer.messages
      .filter((message) => !ruledOut.has(replyKey(message.accountId, message.id)))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
    const rows = await rowsOf(ctx, found.scope, messages, new Map([[account.id, account]]));
    if (isError(rows)) return rows;
    const next: Record<string, string> = answer.nextPageToken ? { [account.id]: answer.nextPageToken } : {};
    return ok({ task, accounts, toRead: [], replies: rows.rows, more: Object.keys(next), next, failures: failuresByAccount(answer.failures) });
  },
});

export const dismissReply = defineTool({
  name: "dismiss_reply",
  description:
    "Rule out a possible reply to what a task waits for, so the task stops showing it (dismissed true), or take that back " +
    "(dismissed false). Use it when the person says a message is not the one the task waits for.",
  readOnly: false,
  input: z.strictObject({
    task: z.uuid(),
    account: z.uuid().describe("The message's account, as list_task_replies gives it."),
    id: z.string().min(1).max(200).describe("The message's id in the account, as list_task_replies gives it."),
    dismissed: z.boolean().default(true),
  }),
  output: z.object({
    task: z.string(),
    title: z.string(),
    reply: z.object({ account: z.string(), id: z.string(), dismissed: z.boolean() }),
    ruledOut: z.array(z.string()),
  }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    if (found.row.type !== "task") return fail("invalid_input", `a ${found.row.type} does not wait for mail: a task does`);
    if (!origin(ctx)) return fail("internal", "an agent write needs its token's label");
    const { data, error } = await ctx.db.rpc("dismiss_task_reply", {
      p_owner: ctx.ownerId,
      p_item: found.row.id,
      p_reply: replyKey(input.account, input.id),
      p_dismissed: input.dismissed,
    });
    if (error) return dbFail("saving the ruled-out reply", error);
    if (data === null) return fail("not_found", "the task waits for no mail");
    return ok({
      task: found.row.id,
      title: found.row.title,
      reply: { account: input.account, id: input.id, dismissed: input.dismissed },
      ruledOut: data as unknown as string[],
    });
  },
});

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function answeringMessage(ctx: ToolContext, scope: Scope, accountId: string, id: string): Promise<ToolResult<{ message: MailMessage }>> {
  const place: ReadPlace = scope.root ? { kind: "node", node: scope.root } : { kind: "all" };
  const reached = await accountsOf(ctx, scope, place);
  if (isError(reached)) return reached;
  const account = reached.accounts.find((entry) => entry.id === accountId);
  if (!account) return fail("not_found", `no account with id ${accountId} is reachable here`);
  let read;
  try {
    read = await mailOf(ctx).many({ db: ctx.db, ownerId: ctx.ownerId, account, ids: [id] });
  } catch (error) {
    return fail("internal", error instanceof Error ? error.message : "the message could not be read");
  }
  const [message] = read.messages;
  if (message) return ok({ message });
  if (read.failures.length > 0) return fail("internal", read.failures[0].reason);
  return fail("not_found", `no message with id ${id} in that account`);
}

type ClosedRows = { item: ItemRow; decision: ItemRow; linked: boolean };

export const completeTask = defineTool({
  name: "complete_task",
  description:
    "Close a task with its result, as the person says it —«Approved», «Rejected», or their own words—, and, when a " +
    "message answered it, that message: the task is marked done, a decision with the result hangs from it, and the " +
    "message stays linked to it. Use it only when the person says how the task ended; never decide it from a message.",
  readOnly: false,
  input: z.strictObject({
    task: z.uuid(),
    outcome: z.string().trim().min(1).max(120).describe("The result, in the person's words."),
    reply: z
      .strictObject({
        account: z.uuid().describe("The message's account."),
        id: z.string().min(1).max(200).describe("The message's id in the account."),
      })
      .optional()
      .describe("The message that answered the task."),
    notes: richText("What the decision says under the result; without it, who sent the reply and what about").optional(),
  }),
  output: z.object({
    item: itemSchema,
    decision: itemSchema,
    link: z.object({ accountId: z.string(), messageId: z.string(), created: z.boolean() }).nullable(),
  }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    const { row, scope } = found;
    if (row.type !== "task") return fail("invalid_input", `a ${row.type} is not closed with a result: a task is`);
    if (row.status === "done") return fail("invalid_input", "the task is already done: open it again to close it with another result");
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    let said = writtenBody(input.notes);
    if (input.reply) {
      const answer = await answeringMessage(ctx, scope, input.reply.account, input.reply.id);
      if (isError(answer)) return answer;
      const { message } = answer;
      said ??= `<p>${escaped(`From ${message.from.name ?? message.from.email}: ${message.subject || "(no subject)"} · ${message.receivedAt.slice(0, 10)}`)}</p>`;
    }
    const { data, error } = await ctx.db.rpc("complete_task", {
      p_owner: ctx.ownerId,
      p_item: row.id,
      p_outcome: withInitialCapital(input.outcome),
      p_body: said as string,
      p_account: (input.reply?.account ?? null) as string,
      p_message: (input.reply?.id ?? null) as string,
      p_source: mark.source,
      p_agent_label: mark.agent_label as string,
    });
    if (error) return dbFail("closing the task", error);
    if (!data) return fail("not_found", `task ${row.id} was deleted or done meanwhile`);
    const closed = data as unknown as ClosedRows;
    const link = input.reply ? { accountId: input.reply.account, messageId: input.reply.id, created: closed.linked } : null;
    return ok({ item: toItem(closed.item, scope), decision: toItem(closed.decision, scope), link });
  },
});

async function leftByClosing(ctx: ToolContext, task: ItemRow): Promise<ToolResult<{ decision: { id: string; title: string; body: string | null } | null; link: { account_id: string; message_id: string } | null }>> {
  if (!task.completed_at) return ok({ decision: null, link: null });
  const decisions = await ctx.db
    .from("items")
    .select("id, title, body")
    .eq("owner_id", ctx.ownerId)
    .eq("parent_item_id", task.id)
    .eq("type", "decision")
    .eq("created_at", task.completed_at)
    .is("deleted_at", null)
    .limit(1);
  if (decisions.error) return dbFail("reading what the closing left", decisions.error);
  const [decision] = decisions.data;
  if (!decision) return ok({ decision: null, link: null });
  const links = await ctx.db.from("mail_links").select("account_id, message_id").eq("owner_id", ctx.ownerId).eq("item_id", task.id).eq("created_at", task.completed_at).limit(1);
  if (links.error) return dbFail("reading what the closing left", links.error);
  return ok({ decision, link: links.data[0] ?? null });
}

export const reopenTask = defineTool({
  name: "reopen_task",
  description:
    "Open a done task again and take its closing back, whole: when complete_task closed it, the decision with its result goes " +
    "and the message comes off the task if that closing linked it. Its answer says what it took back, to make it again with " +
    "complete_task. Use it when the person says a task was closed by mistake.",
  readOnly: false,
  input: z.strictObject({ task: z.uuid() }),
  output: z.object({
    item: itemSchema,
    closing: z.object({ outcome: z.string(), notes: z.string().nullable(), reply: z.object({ account: z.string(), id: z.string() }).nullable() }).nullable(),
  }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    const { row, scope } = found;
    if (row.type !== "task") return fail("invalid_input", `a ${row.type} is not closed with a result: a task is`);
    if (row.status !== "done") return fail("invalid_input", "the task is already open");
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const left = await leftByClosing(ctx, row);
    if (isError(left)) return left;
    const { decision, link } = left;
    const { data, error } = await ctx.db.rpc("reopen_task", {
      p_owner: ctx.ownerId,
      p_item: row.id,
      p_decision: (decision?.id ?? null) as string,
      p_account: (link?.account_id ?? null) as string,
      p_message: (link?.message_id ?? null) as string,
      p_source: mark.source,
      p_agent_label: mark.agent_label as string,
    });
    if (error) return dbFail("opening the task again", error);
    if (!data) return fail("not_found", `task ${row.id} was deleted meanwhile`);
    return ok({
      item: toItem(data as unknown as ItemRow, scope),
      closing: decision ? { outcome: decision.title, notes: decision.body, reply: link ? { account: link.account_id, id: link.message_id } : null } : null,
    });
  },
});
