"use client";

import { useEffect, useRef } from "react";
import { LOCALE, today } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { browserClient } from "@/lib/supabase/browser";
import { post } from "./client-api";
import { useWorkspace } from "./workspace";

// The daily review on screen. The first time the person opens the workspace in their day, the browser asks the server
// to run it (`POST /api/review` with the day and the zone); the server runs it once per person and day and answers a
// second call with that run, so this browser also remembers the day it asked for and does not ask again. A tab left
// open asks again when it is looked at on a new day. When the run did something, one sentence says so with its «Undo»,
// once the page has entered and no dialog is open over it; what it did also shows in the Activity box, which reads
// again. A run that stopped, that hit the day's limit, that another tab is running, or that could not do every step says
// so in words.

type ActionTask = { id: string; title: string; nodeId: string | null; path: string | null; status: string } | null;
export type ReviewAction = { id: string; taskId: string; kind: "mail_status" | "complete"; after: Record<string, unknown>; undoneAt: string | null; task: ActionTask };
type Review = { ran: boolean; skipped: "already_ran" | "running" | "off" | null; actions: ReviewAction[]; failures: string[] };

const ASKED_KEY = "client-workspace:review-asked";
// How long a page's boxes may take to enter before the notice comes anyway.
const ENTRY_WAIT_MS = 8000;

const list = new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" });
const plural = new Intl.PluralRules(LOCALE);

export function closed(sentence: string): string {
  const clean = sentence.trim();
  return /[.!?”]$/.test(clean) ? clean : `${clean}.`;
}

// A server's message said as a sentence of its own: its first letter capital and its closing point.
export function asSentence(message: string): string {
  const clean = message.trim();
  return closed(clean.charAt(0).toUpperCase() + clean.slice(1));
}

// A task as the action names it: its title, or that it is no longer there (deleted since the run).
const named = (task: ActionTask) => (task ? `“${inlinePlain(task.title)}”` : "a task that is no longer there");

// One sentence for what the run did: what it completed, with the line that decided it when it was one task, and how
// many more it only read the mail of. Each task is named by the task its action carries.
export function reviewSentence(actions: ReviewAction[]): string {
  const byTask = new Map<string, ReviewAction[]>();
  for (const action of actions) byTask.set(action.taskId, [...(byTask.get(action.taskId) ?? []), action]);
  const taskOf = (id: string) => byTask.get(id)![0].task;
  const completed = [...byTask.keys()].filter((id) => byTask.get(id)!.some((action) => action.kind === "complete"));
  const read = [...byTask.keys()].filter((id) => !completed.includes(id));
  const sentenceOf = (id: string) => byTask.get(id)!.map((action) => action.after.sentence).find((value): value is string => typeof value === "string");
  if (completed.length === 1 && read.length === 0) {
    const why = sentenceOf(completed[0]);
    return closed(`The daily review completed ${named(taskOf(completed[0]))}${why ? `: ${why}` : ""}`);
  }
  if (completed.length > 0) {
    const more = read.length > 0 ? `, and read the mail of ${read.length === 1 ? named(taskOf(read[0])) : `${read.length} more tasks`}` : "";
    return closed(`The daily review completed ${list.format(completed.map((id) => named(taskOf(id))))}${more}`);
  }
  if (read.length === 1) {
    const why = sentenceOf(read[0]);
    return closed(`The daily review read the mail of ${named(taskOf(read[0]))}${why ? `: ${why}` : ""}`);
  }
  return closed(`The daily review read the mail of ${read.length} tasks`);
}

// The steps a finished run could not do, and that another tab is running it: the same words in the notice and in the
// chat. A step that failed is not tried again by the day's own run; asking for the review in the chat runs it anew.
export function reviewNotes(review: { skipped?: Review["skipped"]; failures?: string[] }): string[] {
  const notes: string[] = [];
  if (review.skipped === "running") notes.push("The daily review is already running in another tab: what it does shows in Activity.");
  const failures = review.failures ?? [];
  if (failures.length > 0) {
    const steps = plural.select(failures.length) === "one" ? "1 step" : `${failures.length} steps`;
    notes.push(`${steps} of the daily review could not be done: ${list.format(failures)}. Ask the chat to review your day to try again.`);
  }
  return notes;
}

// How long until the limit opens again, from the server's Retry-After (seconds): «in about 5 hours», «in a few minutes».
export function untilAgain(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "tomorrow";
  const hours = Math.round(seconds / 3600);
  if (hours >= 2) return `in about ${hours} hours`;
  if (hours === 1) return "in about an hour";
  return "in a few minutes";
}

// Resolves once the page has entered: every box of its boards in view and its entrance played, and no dialog open over it.
function afterTheLoad(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    // A board is in once every box of it shows and nothing says it is still reading the workspace.
    const boardsReady = () => performance.now() - started > ENTRY_WAIT_MS || !document.querySelector(".boxes .box:not([data-shown]), .boxes-wait");
    const free = () => document.readyState === "complete" && boardsReady() && !document.querySelector("dialog[open]");
    const finish = async () => {
      if (done) return;
      done = true;
      // The boxes' own entrance plays to its end first, so the notice is the last piece of the page's sequence.
      const entering = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && target.matches(".box");
      });
      await Promise.all(entering.map((animation) => animation.finished.catch(() => undefined)));
      // A dialog opened while the entrance played is waited for again.
      if (document.querySelector("dialog[open]")) {
        done = false;
        return;
      }
      observer.disconnect();
      clearInterval(capTimer);
      resolve();
    };
    const check = () => {
      if (free()) void finish();
    };
    const observer = new MutationObserver(check);
    // The board's own wait has its cap; this one ends it if no mutation happens after it.
    const capTimer = setInterval(check, 500);
    const watch = () => {
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-shown", "data-ready", "open"] });
      check();
    };
    if (document.readyState !== "complete") window.addEventListener("load", watch, { once: true });
    else watch();
  });
}

// What a call that did not run says: its cause once —the limit's own sentence, a refusal's reason, that it stopped, or
// that the server was not reached—, and what happens next once.
type Asked = { ok: true; review: Review } | { ok: false; kind: "cap" | "refused" | "stopped" | "unreached"; message: string; retryAfter: number | null };

// The review's own call, read whole: the limit answers 429 with its Retry-After, which the shared client drops.
async function askServer(day: string, zone: string): Promise<Asked> {
  try {
    const response = await fetch("/api/review", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ today: day, zone }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => null)) as ({ ok: boolean; code?: string; message?: string } & Partial<Review>) | null;
    if (response.ok && body?.ok) return { ok: true, review: { ran: Boolean(body.ran), skipped: body.skipped ?? null, actions: body.actions ?? [], failures: body.failures ?? [] } };
    const kind = response.status === 429 || body?.code === "cap" ? "cap" : response.status >= 500 ? "stopped" : "refused";
    const retry = Number(response.headers.get("Retry-After"));
    return { ok: false, kind, message: body?.message ?? "", retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null };
  } catch {
    return { ok: false, kind: "unreached", message: "", retryAfter: null };
  }
}

export function ReviewNotice() {
  const { config, notify, saving, touch } = useWorkspace();
  // The day this tab last asked for (or decided it had nothing to ask), and whether a call is on its way.
  const lastDay = useRef<string | null>(null);
  const asking = useRef(false);

  useEffect(() => {
    async function ask() {
      const day = today();
      if (asking.current || lastDay.current === day) return;
      asking.current = true;
      lastDay.current = day;
      try {
        await run(day);
      } finally {
        asking.current = false;
      }
    }

    async function run(day: string) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data } = await browserClient(config).auth.getSession();
      const owner = data.session?.user.id;
      if (!owner) return;
      const mark = `${owner}:${day}`;
      if (localStorage.getItem(ASKED_KEY) === mark) return;
      const answer = await askServer(day, zone);
      if (!answer.ok) {
        await afterTheLoad();
        if (answer.kind === "cap") {
          // The limit is the day's: this browser does not ask again until it lifts. The server's sentence says which limit
          // and when it resets; without one, the Retry-After says when.
          localStorage.setItem(ASKED_KEY, mark);
          const text = answer.message ? asSentence(answer.message) : `The daily review reached its limit for today. It can run again ${untilAgain(answer.retryAfter)}.`;
          return notify({ text, tone: "status", quiet: true, lasts: 12000 });
        }
        // Not remembered: a run that stopped is picked up where it stopped, and one that never started starts.
        lastDay.current = null;
        const cause =
          answer.kind === "stopped"
            ? "The daily review stopped before it finished."
            : answer.kind === "unreached"
              ? "The daily review could not reach the server."
              : `The daily review did not run. ${asSentence(answer.message || "The server refused it")}`;
        return notify({ text: `${cause} It runs again the next time you open the workspace.`, tone: "error" });
      }
      localStorage.setItem(ASKED_KEY, mark);
      const review = answer.review;
      // Only the run this visit started speaks of what it did; one that already ran today said it then, and lives in Activity.
      const actions = review.ran ? review.actions.filter((action) => !action.undoneAt) : [];
      const notes = reviewNotes(review);
      if (actions.length === 0 && notes.length === 0) return;
      // The boxes read again, so the Activity box shows the run and the Tasks box loses what it completed.
      if (actions.length > 0) touch();
      await afterTheLoad();
      const text = [...(actions.length > 0 ? [reviewSentence(actions)] : []), ...notes].join(" ");
      notify({
        text,
        tone: review.failures.length > 0 ? "error" : "status",
        quiet: true,
        lasts: 12000,
        // What it completed opens again first, then each mail's state goes back.
        undo:
          actions.length > 0
            ? () =>
                void saving(
                  (async () => {
                    for (const action of [...actions].sort((a, b) => Number(b.kind === "complete") - Number(a.kind === "complete"))) {
                      const undone = await post(`/api/review/actions/${action.id}/undo`, {});
                      if (!undone.ok) return undone;
                    }
                    return { ok: true };
                  })(),
                )
            : undefined,
      });
    }

    void ask();
    // A tab left open asks for the new day's review when it is looked at again; nothing is asked while it is hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [config, notify, saving, touch]);

  return null;
}
