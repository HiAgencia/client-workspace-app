import { z } from "zod";
import { capMessage } from "@/lib/chat/usage";
import { MAIL_LIMIT, type MailContent } from "@/lib/mail/source";
import { readPreferences } from "@/lib/preferences";
import { richTextToPlain } from "@/lib/rich-text";
import type { ToolContext } from "@/lib/tools/context";
import { accountMap, fromExpected, mailOf, taskMailOf, type TaskMail } from "@/lib/tools/mail";
import { dbFail, fail, isError, ok, type ToolResult } from "@/lib/tools/result";
import { selectAllItems } from "@/lib/tools/rows";
import { groupOf } from "@/lib/tools/tasks";
import { loadScope, reachOf } from "@/lib/tools/tree";
import { answers, judgeFor, type ReviewJudge } from "./judge";

// The daily review: it walks the tasks of the person's day —overdue and due today— and those that wait for a message
// whatever their date; for each that waits, it reads what arrived in its accounts since the task exists and lets a judge
// decide with two tools only, both bound to the tasks of the run: write the state of a task's mail, and complete a task
// whose mail did what it waits for. Every thing it does is written with its action in one statement, so it is undone. A
// run counts as the day's once it finishes: one that stopped is resumed by the next call. A message's text reaches the
// judge as data, never as an instruction.

export type ReviewTask = {
  id: string;
  title: string;
  path: string | null;
  dueOn: string | null;
  createdAt: string;
  mail: TaskMail;
  // What arrived for it, newest first, its text in plain words.
  messages: Array<Omit<MailContent, "html" | "text"> & { text: string }>;
};

// The two things the judge can do, each refused outside the tasks of the run. Neither throws: a failure comes back as
// data and is counted in the run.
export type ReviewTools = {
  writeMailStatus(input: { task: string; status: TaskMail["status"]; sentence: string; message?: string }): Promise<{ ok: boolean; message: string }>;
  completeTask(input: { task: string }): Promise<{ ok: boolean; message: string }>;
};

// The task an action is about, as the screens show it: read with the actions, so a card needs no other read.
const actionTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  nodeId: z.string().nullable(),
  path: z.string().nullable(),
  status: z.enum(["open", "done"]),
});

export const reviewActionSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  taskId: z.string(),
  kind: z.enum(["mail_status", "complete"]),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
  // Null only for a task that is no longer reachable.
  task: actionTaskSchema.nullable(),
});

export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  day: z.string(),
  instruction: z.string(),
  requested: z.boolean(),
  provider: z.enum(["simulated", "meta"]),
  taskIds: z.array(z.string()),
  createdAt: z.string(),
  // When it finished, null while it runs or after it stopped; and how many of its steps failed.
  finishedAt: z.string().nullable(),
  failures: z.number(),
});

export type ReviewRun = z.infer<typeof reviewSchema>;

export const reviewOutput = z.object({
  review: reviewSchema.nullable(),
  // Whether this call ran it, or found the day's run already done (or running, or the review off).
  ran: z.boolean(),
  skipped: z.enum(["already_ran", "running", "off"]).nullable(),
  actions: z.array(reviewActionSchema),
  // What this call could not do, in plain words; the details go to the log.
  failures: z.array(z.string()),
});

type ActionRow = { id: string; review_id: string; item_id: string; kind: string; before: unknown; after: unknown; created_at: string; undone_at: string | null };
type RunRow = { id: string; day: string; instruction: string; requested: boolean; provider: string; task_ids: string[]; created_at: string; finished_at: string | null; failures: number };

const ACTION_COLUMNS = "id, review_id, item_id, kind, before, after, created_at, undone_at";
const RUN_COLUMNS = "id, day, instruction, requested, provider, task_ids, created_at, finished_at, failures";

// A run with no end writes its heartbeat as it walks its tasks (`heartbeat_at`), and the next call decides with it: a run
// whose last beat is older than this floor is taken as cut —a worker that died— and resumed, and one that keeps beating
// is another call's, however long its attempt has been going. The floor is one task's read with room to spare: a live run
// beats again well inside it. A stop clears the beat, so the next call resumes at once. An attempt whose run was taken
// over finds a beat that is not its own and stops writing, its end included (`toolsFor`, `finish`).
const HEARTBEAT_FLOOR_MS = 5 * 60_000;

function toAction(row: ActionRow, task: ReviewAction["task"] = null): ReviewAction {
  return {
    id: row.id,
    reviewId: row.review_id,
    taskId: row.item_id,
    kind: row.kind as ReviewAction["kind"],
    before: (row.before ?? {}) as Record<string, unknown>,
    after: (row.after ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    undoneAt: row.undone_at,
    task,
  };
}

function toRun(row: RunRow): ReviewRun {
  return {
    id: row.id,
    day: row.day,
    instruction: row.instruction,
    requested: row.requested,
    provider: row.provider as ReviewRun["provider"],
    taskIds: row.task_ids,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    failures: row.failures,
  };
}

// The tasks of some actions, read once, with their place.
async function withTasks(ctx: ToolContext, rows: ActionRow[]): Promise<ToolResult<{ actions: ReviewAction[] }>> {
  const ids = [...new Set(rows.map((row) => row.item_id))];
  if (ids.length === 0) return ok({ actions: [] as ReviewAction[] });
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { data, error } = await ctx.db.from("items").select("id, title, node_id, status, deleted_at").eq("owner_id", ctx.ownerId).in("id", ids);
  if (error) return dbFail("reading the reviewed tasks", error);
  const tasks = new Map(
    data
      .filter((item) => !item.deleted_at && (item.node_id === null ? loaded.scope.general : loaded.scope.reachable.has(item.node_id)))
      .map((item) => [
        item.id,
        { id: item.id, title: item.title, nodeId: item.node_id, path: item.node_id ? (loaded.scope.all.get(item.node_id)?.path ?? null) : null, status: item.status },
      ]),
  );
  return ok({ actions: rows.map((row) => toAction(row, tasks.get(row.item_id) ?? null)) });
}

async function actionsOf(ctx: ToolContext, reviewIds: string[]) {
  if (reviewIds.length === 0) return ok({ actions: [] as ReviewAction[] });
  const { data, error } = await ctx.db.from("review_actions").select(ACTION_COLUMNS).in("review_id", reviewIds).order("created_at");
  if (error) return dbFail("reading what the review did", error);
  return withTasks(ctx, data as ActionRow[]);
}

// The tasks of the run: overdue and due today, and every open task that waits for a message, with what arrived for it.
// The accounts each place sees are resolved once, and each account's mail is read once, from the oldest wait that reads it.
// An account holding more than one read brings is read again for the senders its tasks wait for, so a busy inbox does
// not hide a task's answer; what still stays unread —a task waiting for any sender in a busy inbox— and an account that
// could not be read come back as failures in plain words, which the run shows and counts.
async function gather(ctx: ToolContext, today: string): Promise<ToolResult<{ taskIds: string[]; waiting: ReviewTask[]; failures: string[] }>> {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { scope } = loaded;
  const read = await selectAllItems(ctx, reachOf(scope, { kind: "all" }), (query) => query.is("deleted_at", null).eq("type", "task").eq("status", "open"), "reading the tasks to review");
  if (isError(read)) return read;
  const mail = await taskMailOf(ctx, read.rows.map((row) => row.id));
  if (isError(mail)) return mail;
  const rows = read.rows.filter((row) => {
    const group = groupOf(row, today);
    return group === "overdue" || group === "today" || mail.byTask.has(row.id);
  });
  // A task whose message already did what it waits for has nothing left to read.
  const reading = rows.filter((row) => {
    const taskMail = mail.byTask.get(row.id);
    return taskMail && taskMail.status !== "met";
  });
  const mapped = await accountMap(ctx, scope);
  if (isError(mapped)) return mapped;
  const accountsOfTask = new Map(
    reading.map((row) => {
      const taskMail = mail.byTask.get(row.id)!;
      const seen = mapped.map.seenFrom(row.node_id);
      return [row.id, taskMail.accountId ? new Set(seen.has(taskMail.accountId) ? [taskMail.accountId] : []) : seen];
    }),
  );
  const since = new Map<string, string>();
  for (const row of reading) {
    for (const id of accountsOfTask.get(row.id)!) {
      const oldest = since.get(id);
      if (!oldest || row.created_at < oldest) since.set(id, row.created_at);
    }
  }
  // One read per account, all at once.
  const arrived = await Promise.all(
    [...since].map(async ([id, from]) => {
      const account = mapped.map.accounts.get(id)!;
      // What the person reads of each read that failed or stopped short, and what the log keeps, by the account's id.
      const failures: Array<{ log: string; step: string }> = [];
      const failed = (what: string, reason: string) => failures.push({ log: `account ${id}: ${reason}`, step: `${what}: ${reason}` });
      const read = await mailOf(ctx).read({ db: ctx.db, ownerId: ctx.ownerId, accounts: [account], since: from, limit: MAIL_LIMIT });
      for (const failure of read.failures) failed(`reading the mail of ${account.email}`, failure.reason);
      if (!read.more.includes(id)) return { messages: read.messages, failures };
      const readers = reading.filter((row) => accountsOfTask.get(row.id)!.has(id));
      const named = readers.filter((row) => mail.byTask.get(row.id)!.expectFrom);
      const messages = [...read.messages];
      if (named.length > 0) {
        const senders = [...new Set(named.map((row) => mail.byTask.get(row.id)!.expectFrom!))];
        const oldest = named.reduce((first, row) => (row.created_at < first ? row.created_at : first), named[0].created_at);
        const theirs = await mailOf(ctx).read({ db: ctx.db, ownerId: ctx.ownerId, accounts: [account], since: oldest, limit: MAIL_LIMIT, from: senders });
        const known = new Set(messages.map((message) => message.id));
        messages.push(...theirs.messages.filter((message) => !known.has(message.id)));
        const what = `reading the mail of ${account.email} from ${senders.join(", ")}`;
        for (const failure of theirs.failures) failed(what, failure.reason);
        if (theirs.more.includes(id)) failed(what, `only the latest ${MAIL_LIMIT} messages were read`);
      }
      if (readers.length > named.length) {
        failed(`reading the mail of ${account.email} for a task that waits for any sender`, `only the latest ${MAIL_LIMIT} messages since it waits were read`);
      }
      return { messages, failures };
    }),
  );
  const messages = arrived.flatMap((answer) => answer.messages).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  const failures = arrived.flatMap((answer) => answer.failures);
  for (const failure of failures) console.error(`daily review: ${failure.log}`);
  const waiting = reading.map((row): ReviewTask => {
    const accounts = accountsOfTask.get(row.id)!;
    // A task that names who it waits for reads only that sender's mail: what anyone else sent to the same account is not
    // its answer, and never reaches the judge as one.
    const expectFrom = mail.byTask.get(row.id)!.expectFrom;
    return {
      id: row.id,
      title: row.title,
      path: row.node_id ? (scope.all.get(row.node_id)?.path ?? null) : null,
      dueOn: row.due_on,
      createdAt: row.created_at,
      mail: mail.byTask.get(row.id)!,
      messages: messages
        .filter((message) => accounts.has(message.accountId) && message.receivedAt >= row.created_at && (!expectFrom || fromExpected(message, expectFrom)))
        .slice(0, MAIL_LIMIT)
        .map(({ html, text, ...message }) => ({ ...message, text: text ?? richTextToPlain(html) })),
    };
  });
  return ok({ taskIds: rows.map((row) => row.id), waiting, failures: [...new Set(failures.map((failure) => failure.step))] });
}

// The judge's stop when the run became another call's: its walk ends there, and nothing of this attempt is written after.
class TakenOver extends Error {
  constructor() {
    super("the review was taken over by another call");
  }
}

// What an attempt holds of its run: the beat it wrote last. A write of the attempt —a beat, its end— goes through only
// while the row still holds that beat: another call that took the run over as cut wrote its own, and from then on the
// row is not this attempt's.
type Attempt = { lastBeat: string };

// The two tools, bound to one run: each writes only a task the run looked at, records what was there before in the same
// statement, and does nothing when the change is already the state. A task is completed only after this run wrote it as
// met, citing the message that does what it waits for.
function toolsFor(ctx: ToolContext, run: ReviewRun, tasks: ReviewTask[], attempt: Attempt) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const met = new Set<string>();
  const rows: ActionRow[] = [];
  const failures: string[] = [];
  let lost = false;
  const failed = (task: ReviewTask, what: string, cause: string) => {
    console.error(`daily review: ${what} ${task.id}: ${cause}`);
    failures.push(`${what} “${task.title}”`);
    return { ok: false, message: `${what} failed: try it again later` };
  };
  // The run's heartbeat: the judge writes it as it walks its tasks, and every write of a tool counts as one. It moves from
  // the attempt's last beat to a new one in one statement, one beat at a time, so two tools at once never read each
  // other's beat as a takeover. No row moved means another call took the run over: the attempt is lost. A beat that
  // cannot be written is said in the log and the run goes on: it only risks another call taking it as cut later.
  let queue: Promise<boolean> = Promise.resolve(true);
  const beatOnce = async () => {
    if (lost) return false;
    const next = new Date().toISOString();
    const { data, error } = await ctx.db
      .from("daily_reviews")
      .update({ heartbeat_at: next })
      .eq("id", run.id)
      .eq("heartbeat_at", attempt.lastBeat)
      .is("finished_at", null)
      .select("id");
    if (error) {
      console.error(`daily review: the heartbeat of ${run.id} could not be written: ${error.message}`);
      return true;
    }
    if ((data ?? []).length === 0) {
      lost = true;
      console.error(`daily review: ${run.id} was taken over by another call; this attempt stops writing`);
      return false;
    }
    attempt.lastBeat = next;
    return true;
  };
  const beat = () => (queue = queue.then(beatOnce, beatOnce));
  const LOST = { ok: false, message: "this review is now another call's: stop here" };
  const tools: ReviewTools = {
    async writeMailStatus({ task, status, sentence, message }) {
      if (!(await beat())) return LOST;
      const target = byId.get(task);
      if (!target) return { ok: false, message: "that task is not one this review reads" };
      // A state that says a message did or did not do what the task waits for names that message.
      if (status !== "waiting" && !message) return { ok: false, message: "name the message that decides it" };
      const decided = message ? target.messages.find((entry) => entry.id === message) : undefined;
      if (message && !decided) return { ok: false, message: "that message did not arrive for this task" };
      // The message that decides is the task's own answer: from the sender it waits for, or, when it names none, one about
      // it.
      if (decided && status !== "waiting") {
        const fits = target.mail.expectFrom ? fromExpected(decided, target.mail.expectFrom) : answers(target, decided);
        if (!fits) return { ok: false, message: target.mail.expectFrom ? "that message is not from the sender the task waits for" : "that message is not about this task" };
      }
      const clean = sentence.replace(/\s+/g, " ").trim().slice(0, 1000);
      if (!clean) return { ok: false, message: "the state needs its sentence" };
      const now = target.mail;
      if (now.status === status && now.sentence === clean && now.decidedMessageId === (decided?.id ?? null)) {
        if (status === "met") met.add(task);
        return { ok: true, message: "the state was already this" };
      }
      const { data, error } = await ctx.db.rpc("review_write_mail_status", {
        p_review: run.id,
        p_item: task,
        p_status: status,
        p_sentence: clean,
        // The generated types do not say these take null; the function does.
        p_account: (decided?.accountId ?? null) as string,
        p_message: (decided?.id ?? null) as string,
      });
      if (error) return failed(target, "writing the mail's state of", error.message);
      const [action] = (data ?? []) as ActionRow[];
      if (!action) return { ok: false, message: "the task no longer waits for mail" };
      rows.push(action);
      target.mail = {
        ...now,
        status,
        sentence: clean,
        decidedAccountId: decided?.accountId ?? null,
        decidedMessageId: decided?.id ?? null,
        checkedAt: String((action.after as Record<string, unknown>).checked_at ?? new Date().toISOString()),
      };
      if (status === "met") met.add(task);
      return { ok: true, message: "written" };
    },
    async completeTask({ task }) {
      if (!(await beat())) return LOST;
      const target = byId.get(task);
      if (!target) return { ok: false, message: "that task is not one this review reads" };
      if (!met.has(task) || !target.mail.decidedMessageId) return { ok: false, message: "complete a task only once its mail is written as met" };
      const { data, error } = await ctx.db.rpc("review_complete_task", { p_review: run.id, p_item: task });
      if (error) return failed(target, "completing", error.message);
      const [action] = (data ?? []) as ActionRow[];
      if (!action) return { ok: true, message: "the task was no longer open" };
      rows.push(action);
      return { ok: true, message: "completed" };
    },
  };
  // The judge's beat stops its walk once the run is another call's.
  const judgeBeat = async () => {
    if (!(await beat())) throw new TakenOver();
  };
  return { tools, rows, failures, beat: judgeBeat, lost: () => lost };
}

// The end of an attempt: finished, or stopped with its failures counted and its marks cleared —the attempt's and the
// beat's—, so the next call resumes it. Only while the run is still the attempt's: the end of a run another call took
// over is that call's to write, and `run` comes back null.
async function finish(ctx: ToolContext, run: ReviewRun, failures: number, finished: boolean, attempt: Attempt) {
  const { data, error } = await ctx.db
    .from("daily_reviews")
    .update({ failures: run.failures + failures, finished_at: finished ? new Date().toISOString() : null, attempt_started_at: null, heartbeat_at: null })
    .eq("id", run.id)
    .eq("heartbeat_at", attempt.lastBeat)
    .select(RUN_COLUMNS)
    .maybeSingle();
  if (error) return dbFail("closing the review", error);
  return ok({ run: data ? toRun(data as RunRow) : null });
}

// The answer of an attempt whose run another call took over: that call runs it, and what it does is its answer.
function takenOver(run: ReviewRun) {
  return ok({ review: run, ran: false, skipped: "running" as const, actions: [], failures: [] });
}

export async function runDailyReview(
  ctx: ToolContext,
  input: { today: string; zone?: string; requested?: boolean; instruction?: string; judge?: ReviewJudge },
): Promise<ToolResult<z.infer<typeof reviewOutput>>> {
  // The review is the person's, over everything: an access scoped to a node does not run it.
  if (ctx.scopeNodeId) return fail("invalid_input", "the daily review runs over everything: ask for it from the Overview");
  const requested = input.requested ?? false;
  const prefs = await readPreferences(ctx.db, ctx.ownerId);
  if (!prefs.ok) return fail("db_error", `reading the preferences: ${prefs.message}`);
  let resumed: ReviewRun | null = null;
  // This call's attempt, from the beat it writes when it takes or starts the run.
  const attempt: Attempt = { lastBeat: new Date().toISOString() };
  if (!requested) {
    const { data, error } = await ctx.db.from("daily_reviews").select(RUN_COLUMNS).eq("owner_id", ctx.ownerId).eq("day", input.today).eq("requested", false).maybeSingle();
    if (error) return dbFail("reading the day's review", error);
    if (data) {
      const run = toRun(data as RunRow);
      // A run with no end is taken over in one statement, only when its last beat is old enough to call it cut: of two
      // calls at once, one resumes it and the other answers that it runs. The claim writes the beat, so the run is the
      // claimant's from here on.
      let claimed: RunRow | null = null;
      if (!run.finishedAt) {
        const now = new Date().toISOString();
        attempt.lastBeat = now;
        const cutoff = new Date(Date.now() - HEARTBEAT_FLOOR_MS).toISOString();
        const claim = await ctx.db
          .from("daily_reviews")
          .update({ attempt_started_at: now, heartbeat_at: now })
          .eq("id", run.id)
          .is("finished_at", null)
          .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
          .select(RUN_COLUMNS)
          .maybeSingle();
        if (claim.error) return dbFail("resuming the day's review", claim.error);
        claimed = claim.data as RunRow | null;
      }
      if (!claimed) {
        const done = await actionsOf(ctx, [run.id]);
        if (isError(done)) return done;
        return ok({ review: run, ran: false, skipped: run.finishedAt ? ("already_ran" as const) : ("running" as const), actions: done.actions, failures: [] });
      }
      resumed = toRun(claimed);
    } else if (!prefs.preferences.dailyReview) {
      return ok({ review: null, ran: false, skipped: "off" as const, actions: [], failures: [] });
    }
  }
  const gathered = await gather(ctx, input.today);
  if (isError(gathered)) return gathered;
  const judge = input.judge ?? ctx.reviewJudge ?? judgeFor();
  // Meta's model is paid per call: a review it reads takes a unit of the person's day, and none runs without the cap.
  if (judge.provider === "meta" && gathered.waiting.length > 0) {
    if (!ctx.reviewQuota) return fail("internal", "a review read by Meta's model needs the person's daily limit");
    const taken = await ctx.reviewQuota();
    if (!taken.allowed) {
      return taken.reason === "error" ? fail("internal", "the daily limit could not be read") : fail("cap", capMessage(taken.reason, "daily_review"));
    }
  }
  const instruction = input.instruction ?? prefs.preferences.dailyReviewInstruction;
  let run = resumed;
  if (!run) {
    attempt.lastBeat = new Date().toISOString();
    const { data: inserted, error } = await ctx.db
      .from("daily_reviews")
      .insert({ owner_id: ctx.ownerId, day: input.today, instruction, requested, provider: judge.provider, task_ids: gathered.taskIds, heartbeat_at: attempt.lastBeat })
      .select(RUN_COLUMNS)
      .single();
    if (error?.code === "23505") {
      // Another call started the day's review a moment ago: its run is the answer.
      return runDailyReview(ctx, { ...input, requested: false });
    }
    if (error) return dbFail("starting the review", error);
    run = toRun(inserted as RunRow);
  }
  const { tools, rows, failures, beat, lost } = toolsFor(ctx, run, gathered.waiting, attempt);
  let judged: Awaited<ReturnType<ReviewJudge["review"]>>;
  try {
    judged = await judge.review(gathered.waiting, tools, { instruction, today: input.today, zone: input.zone ?? "UTC", beat });
  } catch (cause) {
    // A run another call took over is that call's: this attempt neither counts its stop nor clears the other's marks.
    if (cause instanceof TakenOver || lost()) return takenOver(run);
    // The run stays unfinished, with its stop counted, so the next call of the day resumes it.
    console.error("daily review: the judge stopped:", cause instanceof Error ? cause.message : cause);
    const stopped = await finish(ctx, run, failures.length + 1, false, attempt);
    if (!isError(stopped) && !stopped.run) return takenOver(run);
    // A stop that could not be recorded leaves the run looking under way until its mark ages: it is said, never lost.
    if (isError(stopped)) console.error("daily review: recording the stop failed:", stopped.message);
    const unrecorded = isError(stopped) ? `; recording the stop failed too: ${stopped.message}` : "";
    return fail("internal", `the review stopped: ${cause instanceof Error ? cause.message : "the judge failed"}${unrecorded}`);
  }
  if (lost()) return takenOver(run);
  // What the run could not read is as much a step that failed as what it could not write.
  const all = [...gathered.failures, ...failures, ...(judged?.failures ?? [])];
  const closed = await finish(ctx, run, all.length, true, attempt);
  if (isError(closed)) return closed;
  if (!closed.run) return takenOver(run);
  const actions = await withTasks(ctx, rows);
  if (isError(actions)) return actions;
  return ok({ review: closed.run, ran: true, skipped: null, actions: actions.actions, failures: all });
}

// What the reviews of the last days did, latest first, for the activity.
export async function recentReviews(ctx: ToolContext, since: string): Promise<ToolResult<{ reviews: Array<ReviewRun & { actions: ReviewAction[] }> }>> {
  const { data, error } = await ctx.db.from("daily_reviews").select(RUN_COLUMNS).eq("owner_id", ctx.ownerId).gte("day", since).order("created_at", { ascending: false });
  if (error) return dbFail("reading the reviews", error);
  const runs = (data as RunRow[]).map(toRun);
  const done = await actionsOf(ctx, runs.map((run) => run.id));
  if (isError(done)) return done;
  return ok({ reviews: runs.map((run) => ({ ...run, actions: done.actions.filter((action) => action.reviewId === run.id) })) });
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

// Undo of one thing the review did: what was there before goes back, and the action says it was undone. A state the
// person changed after the review is theirs: the undo is refused instead of writing over it.
export async function undoReviewAction(ctx: ToolContext, actionId: string): Promise<ToolResult<{ action: ReviewAction }>> {
  const { data, error } = await ctx.db.from("review_actions").select(ACTION_COLUMNS).eq("id", actionId).eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) return dbFail("reading the action", error);
  if (!data) return fail("not_found", `no action with id ${actionId} is reachable here`);
  const row = data as ActionRow;
  const action = toAction(row);
  if (!action.undoneAt) {
    const before = action.before;
    if (action.kind === "complete") {
      const restored = await ctx.db
        .from("items")
        .update({ status: "open", completed_at: null, changed_source: ctx.source === "agent" ? "agent" : ctx.source, changed_agent_label: ctx.source === "agent" ? (ctx.agentLabel ?? null) : null })
        .eq("id", action.taskId)
        .eq("owner_id", ctx.ownerId)
        .eq("status", "done")
        .select("id");
      if (restored.error) return dbFail("opening the task again", restored.error);
    } else {
      const after = action.after;
      const current = await ctx.db
        .from("task_mail")
        .select("status, sentence, decided_account_id, decided_message_id")
        .eq("item_id", action.taskId)
        .eq("owner_id", ctx.ownerId)
        .maybeSingle();
      if (current.error) return dbFail("reading the mail's state", current.error);
      const untouched =
        current.data &&
        sameValue(current.data.status, after.status) &&
        sameValue(current.data.sentence, after.sentence) &&
        sameValue(current.data.decided_account_id, after.decided_account_id) &&
        sameValue(current.data.decided_message_id, after.decided_message_id);
      if (!untouched) return fail("invalid_input", "the mail's state changed after the review: it stays as it is now");
      const restored = await ctx.db
        .from("task_mail")
        .update({
          status: String(before.status ?? "waiting"),
          sentence: (before.sentence as string | null) ?? null,
          decided_account_id: (before.decided_account_id as string | null) ?? null,
          decided_message_id: (before.decided_message_id as string | null) ?? null,
          checked_at: (before.checked_at as string | null) ?? null,
        })
        .eq("item_id", action.taskId)
        .eq("owner_id", ctx.ownerId)
        // Only the state the review left: one written meanwhile stays.
        .eq("status", String(after.status))
        .select("item_id");
      if (restored.error) return dbFail("writing back the mail's state", restored.error);
      if (restored.data.length === 0) return fail("invalid_input", "the mail's state changed after the review: it stays as it is now");
    }
    const marked = await ctx.db.from("review_actions").update({ undone_at: new Date().toISOString() }).eq("id", action.id).select(ACTION_COLUMNS).single();
    if (marked.error) return dbFail("marking the action undone", marked.error);
    Object.assign(row, marked.data);
  }
  const shown = await withTasks(ctx, [row]);
  if (isError(shown)) return shown;
  return ok({ action: shown.actions[0] });
}
