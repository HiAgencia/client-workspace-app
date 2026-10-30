import { z } from "zod";
import { mailFailureSchema, waitWords, type MailFailure, type MailMessage } from "@/lib/mail/source";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { insertItem, origin, reachableItem } from "./items";
import { accountsOf, failuresByAccount, mailOf, reachableMessage, rowsOf, type ReachedAccount } from "./mail";
import { mailRowSchema, taskMailSchema, type TaskMail } from "./mail-schema";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { ITEM_COLUMNS, itemSchema, toItem } from "./rows";
import type { ReadPlace, Scope } from "./tree";

// What a task waits for, and its possible replies. The person says in their own words what the task waits for; the app
// looks for those words in the sender and the subject of what arrived since, and shows every message that holds them as a
// possible reply. The person decides which one answers the task and closes it with its result, or rules out the one that
// does not: nothing marks a task done on its own, and no model is read to decide it.

const TASK_MAIL_COLUMNS = "item_id, account_id, waits_for, dismissed, created_at";

type TaskMailRow = { item_id: string; account_id: string | null; waits_for: string | null; dismissed: string[]; created_at: string };

function toTaskMail(row: TaskMailRow): TaskMail {
  return { accountId: row.account_id, waitsFor: row.waits_for ?? "", since: row.created_at, dismissed: row.dismissed };
}

// How many ids one `in` filter carries, so a long list never makes a request line too long.
const IN_CHUNK = 200;

// What some tasks wait for, by task.
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

// The place a task's wait looks in: its client or project, or every account for a task of General.
function placeOf(scope: Scope, nodeId: string | null): ReadPlace {
  return nodeId ? { kind: "node", node: scope.all.get(nodeId)! } : { kind: "all" };
}

// A reply ruled out, as the wait keeps it.
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
      .array(z.string().min(1).max(250))
      .optional()
      .describe("Only to put back a wait as `previous` gave it: the replies it had ruled out."),
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
        return fail("not_found", `no account with id ${input.account} is visible from the task's place`);
      }
    }
    // A wait put back begins when it began, never before its task existed.
    if (input.since !== undefined && Date.parse(input.since) < Date.parse(found.row.created_at)) {
      return fail("invalid_input", "a wait cannot begin before its task existed");
    }
    const wanted = { account_id: input.account === undefined ? (previous?.accountId ?? null) : input.account, waits_for: words };
    // Waiting for other words or in another account is another wait: what was ruled out for the old one does not hold,
    // unless the call puts back what it had.
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
    // Two first waits at once: the one that finds the row the other just wrote writes over it.
    const { data, error } = !previous && first.error?.code === "23505" ? await update() : first;
    if (error) return dbFail("saving what the task waits for", error);
    return ok({ task: found.row.id, title: found.row.title, mail: toTaskMail(data as TaskMailRow), previous });
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

// The accounts a task's wait looks in, among those its place sees: its own account, or all of them; one asked for must be
// among them. An account its place stopped seeing —taken off the client in Settings— is read for nobody: the person
// chooses again where the task waits.
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
    "person ruled out. None of them is the answer until the person says so; read them to tell the person which one " +
    "seems to answer, and close the task with complete_task only when the person asks.",
  readOnly: true,
  input: z.strictObject({
    task: z.uuid(),
    account: z.uuid().optional().describe("Only this account; omit it for every account the task waits in."),
    limit: z.number().int().min(1).max(100).default(20).describe("How many replies to read of each account."),
    pageToken: z.string().min(1).max(1000).optional().describe("Where the next replies of the one account asked for start, as `next` gave it."),
  }),
  output: z.object({
    task: waitingTaskSchema,
    // The accounts that were read.
    accounts: z.array(z.object({ id: z.string(), email: z.string() })),
    replies: z.array(mailRowSchema),
    // The accounts that hold more possible replies than were read, and where each one's next replies start.
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
    if (words.length === 0 || reached.accounts.length === 0) return ok({ task, accounts, replies: [], more: [], next: {}, failures: [] });
    const answers = await Promise.all(
      reached.accounts.map((account) =>
        mailOf(ctx).candidates({ db: ctx.db, ownerId: ctx.ownerId, account, since: wait.since, words, limit: input.limit, pageToken: input.pageToken }),
      ),
    );
    const ruledOut = new Set(wait.dismissed);
    const messages: MailMessage[] = answers
      .flatMap((answer) => answer.messages)
      .filter((message) => !ruledOut.has(replyKey(message.accountId, message.id)))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
    const failures: MailFailure[] = failuresByAccount(...answers.map((answer) => answer.failures));
    const rows = await rowsOf(ctx, found.scope, messages, new Map(reached.accounts.map((account) => [account.id, account])));
    if (isError(rows)) return rows;
    const next: Record<string, string> = {};
    reached.accounts.forEach((account, index) => {
      const token = answers[index].nextPageToken;
      if (token) next[account.id] = token;
    });
    return ok({ task, accounts, replies: rows.rows, more: Object.keys(next), next, failures });
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
    // The reply this call ruled out or took back.
    reply: z.object({ account: z.string(), id: z.string(), dismissed: z.boolean() }),
    // Every reply the task's wait has ruled out now, each as `<account id>:<message id>`.
    ruledOut: z.array(z.string()),
  }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return found;
    if (found.row.type !== "task") return fail("invalid_input", `a ${found.row.type} does not wait for mail: a task does`);
    if (!origin(ctx)) return fail("internal", "an agent write needs its token's label");
    // One statement in the database, so two at once each keep their own.
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
  }),
  output: z.object({
    item: itemSchema,
    decision: itemSchema,
    // The message linked to the task, and whether this call linked it (false when it already was).
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
    // The message is read first: one the caller does not reach stops everything before anything is written.
    let said = "";
    if (input.reply) {
      const message = await reachableMessage(ctx, input.reply.account, input.reply.id);
      if (isError(message)) return message;
      const sender = message.content.from.name ?? message.content.from.email;
      said = `<p>${escaped(`From ${sender}: ${message.content.subject || "(no subject)"} · ${message.content.receivedAt.slice(0, 10)}`)}</p>`;
    }
    // Done first, and only if it is still open, as `update_item` marks it: a task closed or deleted meanwhile writes
    // nothing. Its result and its reply hang from it after.
    const { data, error } = await ctx.db
      .from("items")
      .update({ status: "done", completed_at: new Date().toISOString(), changed_source: mark.source, changed_agent_label: mark.agent_label })
      .eq("id", row.id)
      .eq("owner_id", ctx.ownerId)
      .eq("status", "open")
      .is("deleted_at", null)
      .select(ITEM_COLUMNS)
      .maybeSingle();
    if (error) return dbFail("marking the task done", error);
    if (!data) return fail("not_found", `task ${row.id} was deleted or done meanwhile`);
    const decision = await insertItem(ctx, { parent: row.id }, { type: "decision", title: input.outcome, body: said || null });
    if (isError(decision)) return fail(decision.code, `the task is done, but its result was not saved: ${decision.message}`);
    let link: { accountId: string; messageId: string; created: boolean } | null = null;
    if (input.reply) {
      const linked = await ctx.db
        .from("mail_links")
        .insert({ owner_id: ctx.ownerId, account_id: input.reply.account, message_id: input.reply.id, item_id: row.id });
      if (linked.error && linked.error.code !== "23505") return dbFail("the task is done with its result, but linking the reply failed", linked.error);
      link = { accountId: input.reply.account, messageId: input.reply.id, created: !linked.error };
    }
    return ok({ item: toItem(data, scope), decision: decision.item, link });
  },
});
