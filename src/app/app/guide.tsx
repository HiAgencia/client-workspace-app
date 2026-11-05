"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { scrollPageTo } from "@/components/page-scroll";
import { Button } from "@/components/ui/button";
import { GUIDE_KEY, GUIDE_VERSION } from "@/lib/guide-key";
import { ASSISTANT_NAME } from "@/lib/product";
import { translateNow, useStrings, type Stringer } from "@/lib/strings";
import "../styles/guide.css";

type Step = { targets: string[]; title: string; text: string };

function guideSteps(t: Stringer["t"]): Step[] {
  return [
    {
      targets: [".sidebar .side-places", ".topbar .drawer-trigger"],
      title: t("palette.clientsProjects"),
      text: t("guide.clientsText"),
    },
    {
      targets: [".reply-strip"],
      title: t("guide.mailTitle"),
      text: t("guide.mailText"),
    },
    {
      targets: ["[data-box='tasks']"],
      title: t("guide.dueTitle"),
      text: t("guide.dueText"),
    },
    {
      targets: ["[data-box='calendar']"],
      title: t("guide.weekTitle"),
      text: t("guide.weekText"),
    },
    {
      targets: ["[data-page-header] [data-chat-toggle]"],
      title: t("guide.assistantTitle", { assistant: ASSISTANT_NAME }),
      text: t("guide.assistantText"),
    },
    {
      targets: [".sidebar .side-foot a[href='/app/settings']", ".topbar .drawer-trigger"],
      title: t("guide.agentsTitle"),
      text: t("guide.agentsText"),
    },
  ];
}

const FADE_CAP_MS = 400;
const AFTER_ENTRY_MS = 700;
const ENTRY_CAP_MS = 8000;
const SCROLL_CAP_MS = 900;
const RING_AIR = 4;
const CARD_AIR = 14;

const seen = () => localStorage.getItem(GUIDE_KEY) === GUIDE_VERSION;
const remember = () => localStorage.setItem(GUIDE_KEY, GUIDE_VERSION);
const GUIDE_OPEN = "guide:open";

export function requestGuide(): void {
  try {
    sessionStorage.setItem(GUIDE_OPEN, "1");
  } catch {
  }
  window.dispatchEvent(new Event(GUIDE_OPEN));
}

function takeGuideRequest(): boolean {
  try {
    if (sessionStorage.getItem(GUIDE_OPEN) !== "1") return false;
    sessionStorage.removeItem(GUIDE_OPEN);
    return true;
  } catch {
    return false;
  }
}
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
  const { t } = useStrings();
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
      const node = document.querySelector(".guide-card");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setLeaving(true);
      let settled = false;
      const go = () => {
        if (settled) return;
        settled = true;
        node?.removeEventListener("transitionend", onEnd);
        void Promise.resolve(change()).then(() => {
          moving.current = false;
          setLeaving(false);
        });
      };
      const onEnd: EventListener = (event) => {
        if (event.target !== node || !("propertyName" in event) || event.propertyName !== "opacity") return;
        go();
      };
      if (!node || reduced) {
        after(0, go);
        return;
      }
      node.addEventListener("transitionend", onEnd);
      after(FADE_CAP_MS, go);
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
    const present = guideSteps(translateNow as Stringer["t"]).filter((candidate) => targetOf(candidate));
    swap(async () => {
      setSteps(present);
      setIndex(0);
      if (present[0]) await bringIntoView(targetOf(present[0])!);
      setPhase("steps");
      requestAnimationFrame(() => requestAnimationFrame(() => next.current?.focus({ preventScroll: true })));
    });
  }, [swap]);

  useEffect(() => {
    if (!offer) return;
    let waiting: number | undefined;
    let live = true;
    const run = () => {
      if (!takeGuideRequest()) return;
      const started = performance.now();
      const look = () => {
        if (!live) return;
        const ready = document.querySelector(".boxes[data-ready]") !== null || performance.now() - started > ENTRY_CAP_MS;
        if (!ready) {
          waiting = window.setTimeout(look, 200);
          return;
        }
        open();
      };
      look();
    };
    run();
    window.addEventListener(GUIDE_OPEN, run);
    return () => {
      live = false;
      if (waiting) window.clearTimeout(waiting);
      window.removeEventListener(GUIDE_OPEN, run);
    };
  }, [offer, open]);

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
          <section className="guide-card" data-guide="offer" data-leaving={leaving || undefined} aria-label={t("guide.offerLabel")}>
            <p className="guide-text">{t("guide.offerText")}</p>
            <div className="guide-actions">
              <Button size="sm" onClick={finish}>
                {t("guide.notNow")}
              </Button>
              <Button size="sm" variant="primary" onClick={open}>
                {t("guide.showMe")}
              </Button>
            </div>
          </section>
        ) : (
          <section ref={card} className="guide-card" data-guide="step" data-leaving={leaving || undefined} role="dialog" aria-modal="false" aria-labelledby="guide-title" aria-describedby="guide-text">
            <p className="t-meta guide-count">
              {t("guide.ofCount", { n: index + 1, total: steps.length })}
            </p>
            <h2 id="guide-title" className="t-title guide-title">
              {step?.title}
            </h2>
            <p id="guide-text" className="guide-text">
              {step?.text}
            </p>
            <div className="guide-actions">
              <Button size="sm" variant="quiet" className="guide-skip" onClick={finish}>
                {t("guide.skip")}
              </Button>
              <Button size="sm" disabled={index === 0} onClick={() => goTo(index - 1)}>
                {t("guide.back")}
              </Button>
              <Button ref={next} size="sm" variant="primary" onClick={() => (index === steps.length - 1 ? finish() : goTo(index + 1))}>
                {index === steps.length - 1 ? t("guide.done") : t("guide.next")}
              </Button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {step ? t("guide.status", { n: index + 1, total: steps.length, title: step.title, text: step.text }) : ""}
            </p>
          </section>
        )}
      </>
    );

  return { start: open, layer };
}
