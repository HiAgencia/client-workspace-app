import { count } from "@/lib/count";
import { mailFailureText } from "@/lib/mail/failure-text";
import type { MailRow } from "@/lib/tools/mail-schema";
import type { Answer, TreeNode } from "./client-api";





export type MailAccountRef = { id: string; email: string; isDemo: boolean; status: string; nodeId: string | null; nodeIds: string[] };
export type MailFailureRow = { accountId: string; accountEmail: string; reason: string; partial?: boolean };

type Group = { count: number; messages: MailRow[] };
export type MailGroups = Record<"forTasks" | "unread" | "earlier", Group>;


export type AccountMail = { groups: MailGroups; unread: number | null; unreadByAccount: Record<string, number>; failures: MailFailureRow[]; countFailures: MailFailureRow[] };


export type MailList = {
  accounts: MailAccountRef[];
  groups: MailGroups;
  unread: number;
  unreadByAccount: Record<string, number>;
  failures: MailFailureRow[];
  waiting: number;
};


export type MailFigure = { unread: number; partial: boolean; why: string | null };

type Ask = (name: string, input: Record<string, unknown>) => Promise<Answer<unknown>>;
type Counted = { unread: number | null; failures: MailFailureRow[] };
type Entry = { listedIn: number; list: AccountMail | null; listError: string | null; counted: Counted | null; counting: boolean };

export type MailStore = ReturnType<typeof createMailStore>;

export function createMailStore(ask: Ask) {
  
  let round = 1;
  let revision = 0;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const entryOf = (id: string) => {
    let entry = entries.get(id);
    if (!entry) {
      entry = { listedIn: 0, list: null, listError: null, counted: null, counting: false };
      entries.set(id, entry);
    }
    return entry;
  };
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const failureOf = (account: MailAccountRef, reason: string): MailFailureRow => ({ accountId: account.id, accountEmail: account.email, reason });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    revision: () => revision,
    
    forget() {
      round++;
    },
    
    list(account: MailAccountRef) {
      const entry = entryOf(account.id);
      if (entry.listedIn === round) return;
      entry.listedIn = round;
      void ask("list_mail", { account: account.id, limit: 50 }).then((answer) => {
        if (answer.ok) {
          const read = answer as unknown as AccountMail;
          entry.list = read;
          entry.listError = null;
          entry.counted = { unread: read.unreadByAccount[account.id] ?? null, failures: read.countFailures };
        } else {
          entry.listError = answer.message;
          
          entry.counted ??= { unread: null, failures: [failureOf(account, answer.message)] };
        }
        changed();
      });
    },
    
    count(account: MailAccountRef) {
      const entry = entryOf(account.id);
      if (entry.listedIn === round || entry.counted) return;
      this.recount(account);
    },
    
    recount(account: MailAccountRef) {
      const entry = entryOf(account.id);
      if (entry.counting) return;
      entry.counting = true;
      void ask("count_unread_mail", { account: account.id }).then((answer) => {
        entry.counting = false;
        entry.counted = answer.ok ? (answer as unknown as Counted) : { unread: null, failures: [failureOf(account, answer.message)] };
        changed();
      });
    },
    
    mailOf(accounts: MailAccountRef[]): MailList {
      const merged: MailList = {
        accounts,
        groups: { forTasks: { count: 0, messages: [] }, unread: { count: 0, messages: [] }, earlier: { count: 0, messages: [] } },
        unread: 0,
        unreadByAccount: {},
        failures: [],
        waiting: 0,
      };
      for (const account of accounts) {
        const entry = entryOf(account.id);
        if (!entry.list && !entry.listError) merged.waiting++;
        if (entry.listError) merged.failures.push(failureOf(account, entry.listError));
        if (!entry.list) continue;
        for (const key of ["forTasks", "unread", "earlier"] as const) {
          merged.groups[key].count += entry.list.groups[key].count;
          merged.groups[key].messages.push(...entry.list.groups[key].messages);
        }
        if (!entry.listError) merged.failures.push(...entry.list.failures);
        Object.assign(merged.unreadByAccount, entry.list.unreadByAccount);
        merged.unread += entry.list.unread ?? 0;
      }
      for (const group of Object.values(merged.groups)) group.messages.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
      return merged;
    },
    
    figure(accounts: MailAccountRef[]): MailFigure | null {
      const counts = accounts.map((account) => entryOf(account.id).counted);
      if (counts.some((counted) => counted === null)) return null;
      return figureOf(counts as Counted[]);
    },
  };
}

export function figureOf(counts: Counted[]): MailFigure {
  const failures = counts.flatMap((counted) => counted.failures);
  return {
    unread: counts.reduce((sum, counted) => sum + (counted.unread ?? 0), 0),
    partial: failures.length > 0,
    why: failures.length === 0 ? null : failures.length === 1 ? mailFailureText(failures[0]) : `${count(failures.length, "account is", "accounts are")} not counted whole: Mail says why.`,
  };
}


export function figureText(figure: MailFigure): { shown: string; spoken: string } | null {
  if (!figure.partial) return figure.unread > 0 ? { shown: String(figure.unread), spoken: `${figure.unread} unread` } : null;
  return figure.unread > 0
    ? { shown: `${figure.unread}+`, spoken: `at least ${figure.unread} unread. ${figure.why}` }
    : { shown: "Not counted", spoken: `the unread could not be counted. ${figure.why}` };
}


export function accountsSeenFrom(tree: TreeNode[] | null, accounts: Array<{ id: string; nodeIds: string[] }>, nodeId: string | null): string[] {
  if (nodeId === null) return accounts.map((account) => account.id);
  const line = new Set<string>();
  const byId = new Map((tree ?? []).map((node) => [node.id, node]));
  for (let node = byId.get(nodeId); node && !line.has(node.id); node = node.parentId ? byId.get(node.parentId) : undefined) line.add(node.id);
  return accounts.filter((account) => account.nodeIds.some((id) => line.has(id))).map((account) => account.id);
}
