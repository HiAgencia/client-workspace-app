import { post, tool } from "./client-api";
import { count } from "@/lib/count";
import { inlinePlain } from "@/lib/inline-links";

// What each write of the chat says on its card and how it is undone, from what the tool's output already carries —its
// item, or the title it returns—, so a card never reads anything to say what it is. Undoing goes through the same tools
// as everything else.

type Previous = { title: string; body: string | null; type: "task" | "note" | "decision"; priority: number | null; dueOn: string | null; dueTime: string | null; status: "open" | "done" };
type Moved = { nodeId: string | null; parentId: string | null };
type TaskMail = { accountId: string | null; waitsFor: string; since: string; dismissed: string[] };
type MailLink = { accountId: string; messageId: string; taskId: string | null; nodeId: string | null };
// What `complete_task` linked: the reply, and whether this call linked it.
type ReplyLink = { accountId: string; messageId: string; created: boolean };
type EventLink = { itemId: string; eventId: string | null; accountId: string | null; calendarId: string | null; googleEventId: string | null };

// What a write's output carries: its item, or the title it returns for its card, and what it replaced.
export type WriteOutput = {
  ok: boolean;
  message?: string;
  item?: { id: string; title: string; type: "task" | "note" | "decision" };
  // What `update_item` replaced, or where `move_item` took the item from.
  previous?: Previous | Moved | TaskMail | null;
  // What `reschedule_overdue` moved, each with the day it had.
  count?: number;
  changed?: Array<{ id: string; title: string; previousDueOn: string }>;
  // `reorder_items`: each item with its title and the place it held.
  items?: Array<{ id: string; title: string; position: number; previous: number }>;
  // `link_task_event`, `unlink_task_event`, `link_mail`, `set_task_mail`, `dismiss_reply`: the title of what was written.
  title?: string;
  // `link_mail`'s link, the event link `link_task_event` wrote and `unlink_task_event` took off (null: it was in none), or
  // the reply `complete_task` linked.
  link?: MailLink | EventLink | ReplyLink | null;
  removed?: boolean;
  created?: boolean;
  task?: string;
  mail?: TaskMail | null;
  // `complete_task`: the decision that holds the result.
  decision?: { id: string; title: string };
  // `dismiss_reply`: the reply it ruled out or took back.
  reply?: { account: string; id: string; dismissed: boolean };
};

type Undo = () => Promise<{ ok: boolean; message?: string }>;
type Card = { what: string; undo?: Undo; why?: string } | null;

export const quoted = (title: string) => `“${inlinePlain(title)}”`;

// Every write the chat can make, what its card says, and how it is undone.
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
  // The group goes back to the order it had: its ids sorted by the places they held before.
  reorder_items: (o) =>
    o.items?.length
      ? {
          what: `Reordered ${o.items.length === 1 ? quoted(o.items[0].title) : count(o.items.length, "task", "tasks")}`,
          undo: () => tool("reorder_items", { ids: [...o.items!].sort((a, b) => a.previous - b.previous).map((item) => item.id) }),
        }
      : null,
  link_task_event: (o) => {
    const link = o.link as EventLink | null | undefined;
    return link?.itemId && o.title ? { what: `Put ${quoted(o.title)} in an event`, undo: () => tool("unlink_task_event", { task: link.itemId }) } : null;
  },
  // The task goes back into the event its output says it was in: the workspace's own, or a Google one by its ids.
  unlink_task_event: (o) => {
    const was = o.link as EventLink | null | undefined;
    if (!o.removed || !o.title || !was) return null;
    const back = was.eventId
      ? { task: was.itemId, event: was.eventId }
      : { task: was.itemId, account: was.accountId, calendar: was.calendarId, googleEvent: was.googleEventId };
    return { what: `Took ${quoted(o.title)} out of its event`, undo: () => tool("link_task_event", back) };
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
  // What it waited for goes back whole: none, or the account, the words, the moment it began, and what it had ruled out.
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
  // A ruled-out reply comes back among the possible ones, and one taken back is ruled out again.
  dismiss_reply: (o) => {
    const reply = o.reply;
    if (!o.task || !o.title || !reply) return null;
    return {
      what: reply.dismissed ? `Ruled out a reply to ${quoted(o.title)}` : `Took back a ruled-out reply to ${quoted(o.title)}`,
      undo: () => tool("dismiss_reply", { task: o.task!, account: reply.account, id: reply.id, dismissed: !reply.dismissed }),
    };
  },
  // The task opens again, its result goes, and the reply comes off it when this closing linked it.
  complete_task: (o) => {
    const reply = o.link as ReplyLink | null | undefined;
    if (!o.item || !o.decision) return null;
    const task = o.item;
    const decision = o.decision;
    return {
      what: `Closed ${quoted(task.title)}: ${decision.title}`,
      undo: async () => {
        const reopened = await tool("update_item", { id: task.id, status: "open" });
        if (!reopened.ok) return reopened;
        const gone = await tool("delete_item", { id: decision.id });
        if (!gone.ok) return gone;
        return reply?.created ? tool("unlink_mail", { account: reply.accountId, id: reply.messageId, task: task.id }) : { ok: true };
      },
    };
  },
};

function created(verb: string, output: WriteOutput): Card {
  const item = output.item;
  return item ? { what: `${verb} ${quoted(item.title)}`, undo: () => tool("delete_item", { id: item.id }) } : null;
}

// Every replaced value goes back, in the fields the item's kind takes.
function putBack(item: { id: string; type: string }, p: Previous) {
  if (p.type === "task") return tool("update_item", { id: item.id, title: p.title, notes: p.body, priority: p.priority, dueOn: p.dueOn, dueTime: p.dueTime, status: p.status });
  if (p.type === "note") return tool("update_item", { id: item.id, notes: p.body ?? p.title, ...(item.type !== "note" ? { decision: false } : {}) });
  return tool("update_item", { id: item.id, title: p.title, notes: p.body, status: p.status, ...(item.type !== "decision" ? { decision: true } : {}) });
}

