"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { addDays, firstWeekday, LOCALE, longDay, today, weekdayNames, weekOf } from "@/lib/dates";
import { cx } from "@/lib/utils";

export type Frame = { set: readonly string[]; ms: number };

export type SceneGlyphs = { pause: ReactNode; play: ReactNode };

const PAUSE_KEY = "landing-scene-paused";
const SEEN_SHARE = 0.35;
const REDUCED = "(prefers-reduced-motion: reduce)";

const pauseListeners = new Set<() => void>();
let pauseChosen: boolean | null = null;

function storedPause(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === "1";
  } catch {
    return false;
  }
}

function pausedNow(): boolean {
  return pauseChosen ?? storedPause();
}

function subscribePause(listener: () => void): () => void {
  pauseListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PAUSE_KEY) return;
    pauseChosen = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    pauseListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function choosePause(paused: boolean) {
  pauseChosen = paused;
  try {
    if (paused) window.localStorage.setItem(PAUSE_KEY, "1");
    else window.localStorage.removeItem(PAUSE_KEY);
  } catch {
  }
  pauseListeners.forEach((listener) => listener());
}

function subscribeMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const reducedNow = () => window.matchMedia(REDUCED).matches;
const noSubscription = () => () => {};

export function Scene({ frames, still, label, glyphs, className, children, labels }: { frames: readonly Frame[]; still: number; label: string; glyphs: SceneGlyphs; className?: string; children: ReactNode; labels?: { pause: string; play: string } }) {
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(subscribeMotion, reducedNow, () => true);
  const paused = useSyncExternalStore(subscribePause, pausedNow, () => false);
  const [seen, setSeen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState(still);
  const left = useRef<number | null>(null);
  const running = !reduced && !paused && seen && !hidden;

  useEffect(() => {
    const node = root.current;
    if (reduced || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        const fits = Math.min(entry.boundingClientRect.height, window.innerHeight);
        setSeen(fits > 0 && entry.intersectionRect.height / fits >= SEEN_SHARE);
      },
      { threshold: Array.from({ length: 11 }, (_, index) => index / 10) },
    );
    observer.observe(node);
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  useEffect(() => {
    if (!running) return;
    const wait = left.current ?? frames[step].ms;
    const started = performance.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      left.current = null;
      setStep((current) => (current + 1) % frames.length);
    }, wait);
    return () => {
      window.clearTimeout(timer);
      if (!fired) left.current = Math.max(0, wait - (performance.now() - started));
    };
  }, [running, step, frames]);

  useEffect(() => {
    const node = art.current;
    if (!paused || !node) return;
    const moving = node.getAnimations({ subtree: true }).filter((animation) => animation instanceof CSSTransition && animation.playState === "running");
    moving.forEach((animation) => animation.pause());
    return () => {
      moving.forEach((animation) => {
        if (animation.playState === "paused") animation.play();
      });
    };
  }, [paused]);

  const flags: Record<string, string> = {};
  for (const flag of frames[reduced ? still : step].set) flags[`data-${flag}`] = "";
  const action = paused ? (labels?.play ?? "Play the animations") : (labels?.pause ?? "Pause the animations");

  return (
    <div ref={root} className={cx("scene", className)} data-running={running ? "" : undefined} {...flags}>
      <div ref={art} className="scene-art" inert aria-hidden="true">
        {children}
      </div>
      <p className="sr-only">{label}</p>
      <button type="button" className="btn btn-icon scene-pause" data-ready={reduced ? undefined : ""} onClick={() => choosePause(!paused)} title={action}>
        {paused ? glyphs.play : glyphs.pause}
        <span className="sr-only">{action}</span>
      </button>
    </div>
  );
}

const REVEAL_MARGIN = "100000px 0px -12% 0px";

export function RevealColumn({ className, children }: { className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node || window.matchMedia(REDUCED).matches) return;
    const waiting = [...node.children].filter((part) => part.getBoundingClientRect().top >= window.innerHeight);
    if (waiting.length === 0) return;
    for (const part of node.children) if (!waiting.includes(part)) part.setAttribute("data-entered", "");
    node.setAttribute("data-reveal", "");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-entered", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: REVEAL_MARGIN },
    );
    waiting.forEach((part) => observer.observe(part));
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

export function VisitorDay() {
  const now = useSyncExternalStore(noSubscription, today, () => null);
  return <>{now ? longDay(now) : "\u00a0"}</>;
}

export function VisitorStamp({ offset }: { offset: number }) {
  const now = useSyncExternalStore(noSubscription, today, () => null);
  if (!now) return <>{"\u00a0"}</>;
  return <>{new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }).format(new Date(`${addDays(now, offset)}T12:00:00`))}</>;
}

export function VisitorWeek() {
  const now = useSyncExternalStore(noSubscription, today, () => null);
  const start = useSyncExternalStore(noSubscription, firstWeekday, () => 7);
  const from = now ? weekOf(now, start).from : null;
  return (
    <div className="seg week">
      {weekdayNames(start).map((name, index) => {
        const day = from ? addDays(from, index) : null;
        const current = day !== null && day === now;
        const weekday = (start + index) % 7;
        return (
          <span key={name.long} className="seg-option week-day" aria-current={current ? "date" : undefined} aria-pressed={current ? "true" : undefined}>
            <span className="week-name">{name.short}</span>
            <span className="week-number" data-known={day ? "" : undefined}>
              {day ? Number(day.slice(8)) : "\u00a0"}
            </span>
            <span className="week-mark" data-some={(weekday >= 1 && weekday <= 5) || undefined} />
          </span>
        );
      })}
    </div>
  );
}
