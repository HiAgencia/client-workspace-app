"use client";

import { useEffect, useRef } from "react";
import { LOCALE, today, untilAgain } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { browserClient } from "@/lib/supabase/browser";
import { post } from "./client-api";
import { count } from "./count";
import { useWorkspace } from "./workspace";









type ActionTask = { id: string; title: string; nodeId: string | null; path: string | null; status: string } | null;
export type ReviewAction = { id: string; taskId: string; kind: "mail_status" | "complete"; after: Record<string, unknown>; undoneAt: string | null; task: ActionTask };
type Review = { ran: boolean; skipped: "already_ran" | "running" | "off" | null; actions: ReviewAction[]; failures: string[] };

const ASKED_KEY = "client-workspace:review-asked";

const ENTRY_WAIT_MS = 8000;

const list = new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" });

export function closed(sentence: string): string {
  const clean = sentence.trim();
  return /[.!?”]$/.test(clean) ? clean : `${clean}.`;
}


export function asSentence(message: string): string {
  const clean = message.trim();
  return closed(clean.charAt(0).toUpperCase() + clean.slice(1));
}


const named = (task: ActionTask) => (task ? `“${inlinePlain(task.title)}”` : "a task that is no longer there");



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
    const more = read.length > 0 ? `, and read the mail of ${read.length === 1 ? named(taskOf(read[0])) : count(read.length, "more task", "more tasks")}` : "";
    return closed(`The daily review completed ${list.format(completed.map((id) => named(taskOf(id))))}${more}`);
  }
  if (read.length === 1) {
    const why = sentenceOf(read[0]);
    return closed(`The daily review read the mail of ${named(taskOf(read[0]))}${why ? `: ${why}` : ""}`);
  }
  return closed(`The daily review read the mail of ${count(read.length, "task", "tasks")}`);
}




export function reviewNotes(review: { skipped?: Review["skipped"]; failures?: string[] }): string[] {
  const notes: string[] = [];
  if (review.skipped === "running") notes.push("The daily review is running. What it does shows in Activity.");
  const failures = review.failures ?? [];
  if (failures.length > 0) {
    notes.push(`${count(failures.length, "step", "steps")} of the daily review could not be done: ${list.format(failures)}. Ask the chat to review your day to try again.`);
  }
  return notes;
}


function afterTheLoad(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    
    const boardsReady = () => performance.now() - started > ENTRY_WAIT_MS || !document.querySelector(".boxes .box:not([data-shown]), .boxes-wait");
    const free = () => document.readyState === "complete" && boardsReady() && !document.querySelector("dialog[open]");
    const finish = async () => {
      if (done) return;
      done = true;
      
      const entering = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && target.matches(".box");
      });
      await Promise.all(entering.map((animation) => animation.finished.catch(() => undefined)));
      
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
    
    const capTimer = setInterval(check, 500);
    const watch = () => {
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-shown", "data-ready", "open"] });
      check();
    };
    if (document.readyState !== "complete") window.addEventListener("load", watch, { once: true });
    else watch();
  });
}



type Asked = { ok: true; review: Review } | { ok: false; kind: "cap" | "refused" | "stopped" | "unreached"; message: string; retryAfter: number | null };


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
  
  const lastDay = useRef<string | null>(null);
  const asking = useRef(false);
  
  const saidRunning = useRef<string | null>(null);

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
          
          
          localStorage.setItem(ASKED_KEY, mark);
          const text = answer.message ? asSentence(answer.message) : `The daily review reached its limit for today. It can run again ${untilAgain(answer.retryAfter)}.`;
          return notify({ text, tone: "status", quiet: true, lasts: 12000 });
        }
        
        lastDay.current = null;
        const cause =
          answer.kind === "stopped"
            ? "The daily review stopped before it finished."
            : answer.kind === "unreached"
              ? "The daily review could not reach the server."
              : `The daily review did not run. ${asSentence(answer.message || "The server refused it")}`;
        return notify({ text: `${cause} It runs again the next time you open the workspace.`, tone: "error" });
      }
      const review = answer.review;
      if (review.skipped === "running") {
        
        
        lastDay.current = null;
        if (saidRunning.current === day) return;
        saidRunning.current = day;
        await afterTheLoad();
        return notify({ text: reviewNotes(review).join(" "), tone: "status", quiet: true, lasts: 12000 });
      }
      localStorage.setItem(ASKED_KEY, mark);
      
      const actions = review.ran ? review.actions.filter((action) => !action.undoneAt) : [];
      const notes = reviewNotes(review);
      if (actions.length === 0 && notes.length === 0) return;
      
      if (actions.length > 0) touch();
      await afterTheLoad();
      const text = [...(actions.length > 0 ? [reviewSentence(actions)] : []), ...notes].join(" ");
      notify({
        text,
        tone: review.failures.length > 0 ? "error" : "status",
        quiet: true,
        lasts: 12000,
        
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
    
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [config, notify, saving, touch]);

  return null;
}
