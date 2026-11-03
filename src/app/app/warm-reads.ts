import { instantsOf, isDay, monthGrid, weekOf, type Day } from "@/lib/dates";
import { activitySince, placeInput, readPlace, type Place } from "./box-kinds";
import { get, peekGet, peekTool, tool, type TreeNode } from "./client-api";
import { keptEvents, readEvents } from "./events-read";
import { accountsSeenFrom, type MailAccountRef, type MailStore } from "./mail-store";
import { onReads, readsInFlight } from "./read-cache";
import { warmReplies } from "./task-replies";
import type { WaitingRead } from "./workspace";






export type Warmth = {
  today: Day;
  weekStart: number;
  tree: TreeNode[] | null;
  accounts: MailAccountRef[] | null;
  waiting: WaitingRead[] | null;
  mailStore: MailStore;
};


export const MAIN_PAGES = ["/app", "/app/tasks", "/app/calendar", "/app/mail"];


const STRIP_REPLIES = 5;
const MAIL_PAGE_REPLIES = 20;

function warmTool(name: string, input: Record<string, unknown>) {
  if (!peekTool(name, input)) void tool(name, input);
}

function warmEvents(input: Record<string, unknown>, withAccounts = true) {
  if (!keptEvents(input, { withAccounts })) void readEvents(input, { withAccounts });
}


function weekInput(warmth: Warmth, node: string | null): Record<string, unknown> {
  const week = weekOf(warmth.today, warmth.weekStart);
  const instants = instantsOf(week.from, week.to);
  return { ...(node ? { node } : {}), from: instants.from, to: instants.to, fromDay: week.from, toDay: week.to };
}


function warmMail(warmth: Warmth, place: Place) {
  if (!warmth.accounts || place.kind === "general") return;
  const seen = place.kind === "node" ? new Set(accountsSeenFrom(warmth.tree, warmth.accounts, place.id)) : null;
  for (const account of warmth.accounts) if (!seen || seen.has(account.id)) warmth.mailStore.list(account);
}

function warmRepliesOf(warmth: Warmth, place: Record<string, unknown>, perAccount: number) {
  if (warmth.tree && warmth.accounts && warmth.waiting) warmReplies(place, warmth.tree, warmth.accounts, warmth.waiting, perAccount);
}


function warmBoxes(warmth: Warmth, place: Place) {
  const node = place.kind === "node" ? place.id : null;
  warmTool("get_tasks", { ...placeInput(place), today: warmth.today, upcomingDays: 3 });
  warmTool("list_notes", { node, limit: 12 });
  warmTool("get_updates_since", { since: activitySince(), ...(node ? { node } : {}) });
  warmEvents(weekInput(warmth, node), place.kind !== "general");
  warmMail(warmth, place);
  warmRepliesOf(warmth, placeInput(place), STRIP_REPLIES);
}


export function warmPage(href: string, warmth: Warmth): void {
  const here = "https://workspace.invalid";
  let url: URL;
  try {
    url = new URL(href, here);
  } catch {
    return;
  }
  
  if (url.origin !== here) return;
  const params = url.searchParams;
  const place = readPlace(params.get("place"), warmth.tree);
  const node = url.pathname.match(/^\/app\/node\/([0-9a-f-]{36})$/)?.[1];
  if (node) return warmBoxes(warmth, { kind: "node", id: node });
  switch (url.pathname) {
    case "/app":
      return warmBoxes(warmth, place);
    case "/app/tasks": {
      const sort = params.get("sort");
      warmTool("get_tasks", { ...placeInput(place), today: warmth.today, sort: sort === "priority" || sort === "manual" ? sort : "date", withCompleted: params.get("completed") === "1" });
      
      return warmEvents(weekInput(warmth, null), false);
    }
    case "/app/calendar": {
      const anchor = isDay(params.get("date")) ? (params.get("date") as Day) : warmth.today;
      const range = params.get("view") === "month" ? monthRange(anchor, warmth.weekStart) : weekOf(anchor, warmth.weekStart);
      const instants = instantsOf(range.from, range.to);
      warmTool("get_tasks", { today: warmth.today, withCompleted: true });
      if (!peekGet("/api/accounts")) void get("/api/accounts");
      return warmEvents({ from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to });
    }
    
    case "/app/mail":
      warmMail(warmth, { kind: "all" });
      return warmRepliesOf(warmth, {}, MAIL_PAGE_REPLIES);
  }
}

function monthRange(anchor: Day, weekStart: number): { from: Day; to: Day } {
  const weeks = monthGrid(anchor, weekStart);
  return { from: weeks[0][0], to: weeks.at(-1)!.at(-1)! };
}


const QUIET_MS = 600;


export function whenSettled(then: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let done = false;
  const idleCallback = typeof window !== "undefined" && "requestIdleCallback" in window;
  const arm = () => {
    clearTimeout(timer);
    if (done || readsInFlight() > 0) return;
    timer = setTimeout(() => {
      if (readsInFlight() > 0) return;
      done = true;
      stop();
      if (idleCallback) idle = window.requestIdleCallback(then, { timeout: 2000 });
      else then();
    }, QUIET_MS);
  };
  const stop = onReads(arm);
  arm();
  return () => {
    done = true;
    stop();
    clearTimeout(timer);
    if (idle !== undefined && idleCallback) window.cancelIdleCallback(idle);
  };
}
