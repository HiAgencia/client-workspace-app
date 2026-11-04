"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { scrollPageTo } from "@/components/page-scroll";
import { Button } from "@/components/ui/button";
import { GUIDE_KEY, GUIDE_VERSION } from "@/lib/guide-key";
import { ASSISTANT_NAME } from "@/lib/product";
import "../styles/guide.css";




type Step = { targets: string[]; title: string; text: string };

const STEPS: Step[] = [
  {
    targets: [".sidebar .side-main", ".topbar .drawer-trigger"],
    title: "Clients and projects",
    text: "Each one keeps its tasks, notes, calendars and mail together. Open one from here, and its page shows only what belongs to it.",
  },
  {
    targets: [".reply-strip"],
    title: "Mail that may answer a task",
    text: "A task can wait for mail. What may answer it shows up here, and you say whether it did and how it ended.",
  },
  {
    targets: ["[data-box='tasks']"],
    title: "What is due",
    text: "Overdue, today and the days ahead, from every client and project. Press a circle to complete a task, or its row to open it.",
  },
  {
    targets: ["[data-box='calendar']"],
    title: "Your week and your mail",
    text: "A Google account connected to a client or a project brings its events and its mail here, each labeled with its client or project.",
  },
  {
    targets: ["[data-page-header] [data-chat-toggle]"],
    title: `${ASSISTANT_NAME}, when you ask`,
    text: "Tell it what to add or what to look for, in words, with a picture or by voice. It acts only when you ask, and what it did can be undone.",
  },
  {
    targets: [".sidebar .side-foot a[href='/app/settings']", ".topbar .drawer-trigger"],
    title: "Your coding agents",
    text: "In Settings, give a coding agent a token for a client or a project. What it adds shows up there, labeled with the token’s name.",
  },
];



const LEAVE_MS = 130;
const AFTER_ENTRY_MS = 700;
const ENTRY_CAP_MS = 8000;
const SCROLL_CAP_MS = 900;

const RING_AIR = 4;
const CARD_AIR = 14;

const seen = () => localStorage.getItem(GUIDE_KEY) === GUIDE_VERSION;
const remember = () => localStorage.setItem(GUIDE_KEY, GUIDE_VERSION);
const targetOf = (step: Step) => step.targets.map((selector) => document.querySelector<HTMLElement>(selector)).find((element) => element?.checkVisibility()) ?? null;
const docked = () => window.matchMedia("(width < 40rem)").matches;
const between = (low: number, value: number, high: number) => Math.max(low, Math.min(value, high));


function placeCard(card: HTMLElement, part: DOMRect) {
  if (docked()) return;
  const { width, height } = card.getBoundingClientRect();
  const right = part.right + CARD_AIR + width <= innerWidth - CARD_AIR;
  const left = part.left - CARD_AIR - width >= CARD_AIR;
  const below = part.bottom + CARD_AIR + height <= innerHeight - CARD_AIR;
  const above = part.top - CARD_AIR - height >= CARD_AIR;
  const alongY = between(CARD_AIR, part.top, innerHeight - height - CARD_AIR);
  const alongX = between(CARD_AIR, part.left, innerWidth - width - CARD_AIR);
  const [x, y] = right
    ? [part.right + CARD_AIR, alongY]
    : left
      ? [part.left - CARD_AIR - width, alongY]
      : below
        ? [alongX, part.bottom + CARD_AIR]
        : above
          ? [alongX, part.top - CARD_AIR - height]
          : [innerWidth - width - CARD_AIR, innerHeight - height - CARD_AIR];
  card.style.setProperty("--guide-x", `${x}px`);
  card.style.setProperty("--guide-y", `${y}px`);
}

function placeRing(ring: HTMLElement, target: HTMLElement, part: DOMRect) {
  ring.style.setProperty("--guide-x", `${part.left - RING_AIR}px`);
  ring.style.setProperty("--guide-y", `${part.top - RING_AIR}px`);
  ring.style.setProperty("--guide-w", `${part.width + RING_AIR * 2}px`);
  ring.style.setProperty("--guide-h", `${part.height + RING_AIR * 2}px`);
  const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
  ring.style.setProperty("--guide-radius", `${radius + RING_AIR}px`);
}



function bringIntoView(target: HTMLElement): Promise<void> {
  const part = target.getBoundingClientRect();
  const fixed = target.closest(".sidebar, .topbar") !== null;
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const foot = docked() ? innerHeight * 0.62 : innerHeight;
  const inSight = part.top >= top + RING_AIR && part.bottom <= foot - RING_AIR;
  if (fixed || inSight) return Promise.resolve();
  const room = foot - top;
  const wanted = part.height < room ? top + (room - part.height) / 2 : top + CARD_AIR;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollPageTo(window.scrollY + part.top - wanted, reduced);
  return new Promise((done) => {
    const started = performance.now();
    let last = window.scrollY;
    let still = 0;
    const look = () => {
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
      if (still >= 4 || performance.now() - started > SCROLL_CAP_MS) done();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}



export function useGuide(offer = true): { start: () => void; layer: ReactNode } {
  const [phase, setPhase] = useState<"none" | "offer" | "steps">("none");
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const held = useRef<HTMLElement | null>(null);
  const moving = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const after = useCallback((wait: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, wait);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  
  useEffect(() => {
    if (!offer || seen()) return;
    const started = performance.now();
    let waiting: ReturnType<typeof setTimeout>;
    const look = () => {
      const entered = document.querySelector(".boxes[data-ready]") !== null || performance.now() - started > ENTRY_CAP_MS;
      if (!entered || document.querySelector("dialog[open]")) {
        waiting = setTimeout(look, 200);
        return;
      }
      waiting = setTimeout(() => {
        if (document.querySelector("dialog[open]")) look();
        else setPhase((now) => (now === "none" ? "offer" : now));
      }, AFTER_ENTRY_MS);
    };
    look();
    return () => clearTimeout(waiting);
  }, [offer]);

  const step = phase === "steps" ? steps[index] : null;

  
  const place = useCallback(() => {
    if (!step || !card.current || !ring.current) return;
    const target = targetOf(step);
    if (!target) return;
    const part = target.getBoundingClientRect();
    placeRing(ring.current, target, part);
    placeCard(card.current, part);
  }, [step]);

  useLayoutEffect(place, [place, leaving]);

  useEffect(() => {
    if (phase !== "steps") return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", soon, { capture: true, passive: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon, { capture: true });
      window.removeEventListener("resize", soon);
    };
  }, [phase, place]);

  
  const swap = useCallback(
    (change: () => Promise<void> | void) => {
      if (moving.current) return;
      moving.current = true;
      setLeaving(true);
      after(LEAVE_MS, () => {
        void Promise.resolve(change()).then(() => {
          moving.current = false;
          setLeaving(false);
        });
      });
    },
    [after],
  );

  const finish = useCallback(() => {
    remember();
    swap(() => {
      setPhase("none");
      setIndex(0);
      const back = held.current?.isConnected ? held.current : document.querySelector<HTMLElement>("[data-page-title]");
      back?.focus({ preventScroll: true });
    });
  }, [swap]);

  const open = useCallback(() => {
    held.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const present = STEPS.filter((candidate) => targetOf(candidate));
    swap(async () => {
      setSteps(present);
      setIndex(0);
      if (present[0]) await bringIntoView(targetOf(present[0])!);
      setPhase("steps");
      requestAnimationFrame(() => requestAnimationFrame(() => next.current?.focus({ preventScroll: true })));
    });
  }, [swap]);

  const goTo = useCallback(
    (to: number) => {
      swap(async () => {
        const target = targetOf(steps[to]);
        setIndex(to);
        if (target) await bringIntoView(target);
      });
    },
    [steps, swap],
  );

  
  useEffect(() => {
    if (phase === "none") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], .menu-popup")) return;
      finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, finish]);

  const layer: ReactNode =
    phase === "none" ? null : (
      <>
        {phase === "steps" && <div ref={ring} className="guide-ring" data-leaving={leaving || undefined} aria-hidden="true" />}
        {phase === "offer" ? (
          <section className="guide-card" data-guide="offer" data-leaving={leaving || undefined} aria-label="A guide to this page">
            <p className="guide-text">New here? A short guide shows what each part of this page does.</p>
            <div className="guide-actions">
              <Button size="sm" onClick={finish}>
                Not now
              </Button>
              <Button size="sm" variant="primary" onClick={open}>
                Show me
              </Button>
            </div>
          </section>
        ) : (
          <section ref={card} className="guide-card" data-guide="step" data-leaving={leaving || undefined} role="dialog" aria-modal="false" aria-labelledby="guide-title" aria-describedby="guide-text">
            <p className="t-meta guide-count">
              {index + 1} of {steps.length}
            </p>
            <h2 id="guide-title" className="t-title guide-title">
              {step?.title}
            </h2>
            <p id="guide-text" className="guide-text">
              {step?.text}
            </p>
            <div className="guide-actions">
              <Button size="sm" variant="quiet" className="guide-skip" onClick={finish}>
                Skip
              </Button>
              <Button size="sm" disabled={index === 0} onClick={() => goTo(index - 1)}>
                Back
              </Button>
              <Button ref={next} size="sm" variant="primary" onClick={() => (index === steps.length - 1 ? finish() : goTo(index + 1))}>
                {index === steps.length - 1 ? "Done" : "Next"}
              </Button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {step ? `${index + 1} of ${steps.length}. ${step.title}. ${step.text}` : ""}
            </p>
          </section>
        )}
      </>
    );

  return { start: open, layer };
}
