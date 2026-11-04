import { post, tool } from "./client-api";
import { count } from "@/lib/count";
import { inlinePlain } from "@/lib/inline-links";

type Previous = { title: string; body: string | null; type: "task" | "note" | "decision"; priority: number | null; dueOn: string | null; dueTime: string | null; status: "open" | "done" };
type Moved = { nodeId: string | null; parentId: string | null };
type TaskMail = { accountId: string | null; waitsFor: string; since: string; dismissed: string[] };
type MailLink = { accountId: string; messageId: string; taskId: string | null; nodeId: string | null };
type EventLink = { itemId: string; eventId: string | null; accountId: string | null; calendarId: string | null; googleEventId: string | null };

export type WriteOutput = {
  ok: boolean;
  message?: string;
  item?: { id: string; title: string; type: "task" | "note" | "decision" };
  previous?: Previous | Moved | TaskMail | null;
  count?: number;
  changed?: Array<{ id: string; title: string; previousDueOn: string }>;
  items?: Array<{ id: string; title: string; position: number; previous: number }>;
  title?: string;
  link?: MailLink | EventLink | null;
  removed?: boolean;
  created?: boolean;
  task?: string;
  mail?: TaskMail | null;
  decision?: { id: string; title: string };
  closing?: { outcome: string; notes: string | null; reply: { account: string; id: string } | null } | null;
  reply?: { account: string; id: string; dismissed: boolean };
};

type Undo = () => Promise<{ ok: boolean; message?: string }>;
type Card = { what: string; undo?: Undo; why?: string } | null;

const quoted = (title: string) => `“${inlinePlain(title)}”`;

export const WRITES: Record<string, (output: WriteOutput) => Card> = {
  create_task: (o) => created("Added task", o),
  create_task_from_mail: (o) => created("Added task", o),
  add_note: (o) => created("Added note", o),
  add_decision: (o) => created("Added decision", o),
  delete_item: (o) => (o.item ? { what: `Deleted ${quoted(o.item.title)}`, undo: () => post(`/api/items/${o.item!.id}/restore`, {}) } : null),
  move_item: (o) =>
    o.item && o.previous && "nodeId" in o.previous
      ? { what: `Moved ${quoted(o.item.title)}`, undo: () => tool("move_item", { id: o.item!.id, node: (o.previous as Moved).nodeId, parent: (o.previous as Moved).parentId }) }
      : null,
  update_item: (o) => (o.item && o.previous && "type" in o.previous ? { what: `Changed ${quoted(o.item.title)}`, undo: () => putBack(o.item!, o.previous as Previous) } : null),
  reschedule_overdue: (o) =>
    o.changed?.length
      ? {
          what: `Rescheduled ${o.changed.length === 1 ? quoted(o.changed[0].title) : count(o.changed.length, "overdue task", "overdue tasks")}`,
          undo: async () => {
            for (const task of o.changed ?? []) {
              const answer = await tool("update_item", { id: task.id, dueOn: task.previousDueOn });
              if (!answer.ok) return answer;
            }
            return { ok: true };
          },
        }
      : null,
  reorder_items: (o) =>
    o.items?.length
      ? {
          what: `Reordered ${o.items.length === 1 ? quoted(o.items[0].title) : count(o.items.length, "task", "tasks")}`,
          undo: () => tool("reorder_items", { ids: [...o.items!].sort((a, b) => a.previous - b.previous).map((item) => item.id) }),
        }
      : null,
  link_task_event: (o) => {
    const link = o.link as EventLink | null | undefined;
    return link?.itemId && o.title ? { what: `Linked ${quoted(o.title)} to a calendar event`, undo: () => tool("unlink_task_event", { task: link.itemId }) } : null;
  },
  unlink_task_event: (o) => {
    const was = o.link as EventLink | null | undefined;
    if (!o.removed || !o.title || !was) return null;
    const back = was.eventId
      ? { task: was.itemId, event: was.eventId }
      : { task: was.itemId, account: was.accountId, calendar: was.calendarId, googleEvent: was.googleEventId };
    return { what: `Unlinked ${quoted(o.title)} from its calendar event`, undo: () => tool("link_task_event", back) };
  },
  link_mail: (o) => {
    const link = o.link as MailLink | null | undefined;
    return link && o.title
      ? {
          what: `Linked a message to ${quoted(o.title)}`,
          undo: o.created ? () => tool("unlink_mail", { account: link.accountId, id: link.messageId, ...(link.taskId ? { task: link.taskId } : { node: link.nodeId }) }) : undefined,
          why: o.created ? undefined : "It was already linked.",
        }
      : null;
  },
  set_task_mail: (o) => {
    if (!o.task || !o.title) return null;
    const was = o.previous as TaskMail | null | undefined;
    return {
      what: o.mail ? `${quoted(o.title)} waits for mail with “${o.mail.waitsFor}”` : `${quoted(o.title)} no longer waits for mail`,
      undo: () =>
        was
          ? tool("set_task_mail", { task: o.task!, waiting: true, account: was.accountId, words: was.waitsFor, since: was.since, dismissed: was.dismissed })
          : tool("set_task_mail", { task: o.task!, waiting: false }),
    };
  },
  dismiss_reply: (o) => {
    const reply = o.reply;
    if (!o.task || !o.title || !reply) return null;
    return {
      what: reply.dismissed ? `Dismissed a possible reply to ${quoted(o.title)}` : `Restored a possible reply to ${quoted(o.title)}`,
      undo: () => tool("dismiss_reply", { task: o.task!, account: reply.account, id: reply.id, dismissed: !reply.dismissed }),
    };
  },
  complete_task: (o) => {
    if (!o.item || !o.decision) return null;
    const task = o.item;
    return { what: `Completed ${quoted(task.title)}: ${o.decision.title}`, undo: () => tool("reopen_task", { task: task.id }) };
  },
  reopen_task: (o) => {
    if (!o.item) return null;
    const { id } = o.item;
    const was = o.closing;
    return {
      what: `Reopened ${quoted(o.item.title)}`,
      undo: () =>
        was
          ? tool("complete_task", { task: id, outcome: was.outcome, ...(was.notes ? { notes: was.notes } : {}), ...(was.reply ? { reply: was.reply } : {}) })
          : tool("update_item", { id, status: "done" }),
    };
  },
};

function created(verb: string, output: WriteOutput): Card {
  const item = output.item;
  return item ? { what: `${verb} ${quoted(item.title)}`, undo: () => tool("delete_item", { id: item.id }) } : null;
}

function putBack(item: { id: string; type: string }, p: Previous) {
  if (p.type === "task") return tool("update_item", { id: item.id, title: p.title, notes: p.body, priority: p.priority, dueOn: p.dueOn, dueTime: p.dueTime, status: p.status });
  if (p.type === "note") return tool("update_item", { id: item.id, notes: p.body ?? p.title, ...(item.type !== "note" ? { decision: false } : {}) });
  return tool("update_item", { id: item.id, title: p.title, notes: p.body, status: p.status, ...(item.type !== "decision" ? { decision: true } : {}) });
}

