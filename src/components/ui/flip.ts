"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";






export type Pace = { fast: number; base: number; slow: number; out: string; in: string; std: string; enter: number; enterEase: string; step: number; rise: string };


export function durationOf(value: string): number {
  const text = value.trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  if (text.endsWith("ms")) return number;
  if (text.endsWith("s")) return number * 1000;
  return 0;
}

export function reducedMotion(): boolean {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function pace(): Pace | null {
  if (reducedMotion()) return null;
  const root = getComputedStyle(document.documentElement);
  const read = (name: string) => root.getPropertyValue(name).trim();
  const motion = {
    fast: durationOf(read("--dur-fast")),
    base: durationOf(read("--dur")),
    slow: durationOf(read("--dur-slow")),
    out: read("--ease-out"),
    in: read("--ease-in"),
    std: read("--ease-std"),
    enter: durationOf(read("--dur-enter")),
    enterEase: read("--ease-enter"),
    step: durationOf(read("--enter-step")),
    rise: read("--enter-rise"),
  };
  
  if (!motion.fast || !motion.base || !motion.slow || !motion.out || !motion.in || !motion.std) return null;
  
  if (!motion.enter || !motion.enterEase || !motion.rise) return { ...motion, enter: motion.slow, enterEase: motion.out, step: 0, rise: "0.5rem" };
  return motion;
}



export type Box = { x: number; y: number; w: number; h: number };


export function translateOf(value: string, width: number, height: number): [number, number] {
  if (!value || value === "none") return [0, 0];
  
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of value.trim()) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (part) parts.push(part);
      part = "";
    } else part += char;
  }
  if (part) parts.push(part);
  const [x = "0px", y = "0px"] = parts;
  const px = (part: string, size: number) => {
    const number = parseFloat(part);
    if (!Number.isFinite(number)) return 0;
    return part.endsWith("%") ? (number / 100) * size : number;
  };
  return [px(x, width), px(y, height)];
}



function laidOut(el: HTMLElement, origin: DOMRect): Box {
  const rect = el.getBoundingClientRect();
  const [tx, ty] = translateOf(getComputedStyle(el).translate, el.offsetWidth, el.offsetHeight);
  return { x: rect.left - origin.left - tx, y: rect.top - origin.top - ty, w: rect.width, h: rect.height };
}

export function boxOf(rect: DOMRect): Box {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}



export type FlipOptions = {
  
  
  items: string;
  
  
  
  layout?: "list" | "grid";
  
  enter?: boolean;
  exit?: boolean;
  
  
  share?: string;
  
  
  arrangement?: string;
  
  cascade?: boolean;
};


const MOST = 12;

type Placed = Box & { el: HTMLElement; index: number; parent: Node | null; next: Node | null };

type HostState = { placed: Map<string, Placed>; mounted: boolean; options: FlipOptions; arrangement?: string };

const keyOf = (el: HTMLElement) => el.dataset.flipKey ?? el.dataset.key ?? el.dataset.box ?? el.dataset.item ?? null;


function piecesOf(host: HTMLElement, selector: string): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const el of host.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest("[data-flip-ghost]")) continue;
    const key = keyOf(el);
    if (key !== null && !found.has(key)) found.set(key, el);
  }
  return found;
}


function originOf(el: HTMLElement, host: HTMLElement, selector: string): HTMLElement {
  const holder = el.parentElement?.closest<HTMLElement>(selector);
  return holder && host.contains(holder) ? holder : host;
}

function place(host: HTMLElement, pieces: Map<string, HTMLElement>, selector: string): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  const origins = new Map<HTMLElement, DOMRect>();
  let index = 0;
  for (const [key, el] of pieces) {
    const origin = originOf(el, host, selector);
    let rect = origins.get(origin);
    if (!rect) {
      rect = origin.getBoundingClientRect();
      origins.set(origin, rect);
    }
    placed.set(key, { ...laidOut(el, rect), el, index: index++, parent: el.parentNode, next: el.nextSibling });
  }
  return placed;
}


function run(el: Element, frames: Keyframe[], options: KeyframeAnimationOptions, end?: () => void): Animation {
  const animation = el.animate(frames, options);
  if (end) {
    let ended = false;
    const once = () => {
      if (ended) return;
      ended = true;
      end();
    };
    animation.addEventListener("finish", once);
    animation.addEventListener("cancel", once);
  }
  return animation;
}


function travel(el: HTMLElement, dx: number, dy: number, motion: Pace): Animation | null {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return run(el, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: motion.slow, easing: motion.std, composite: "add" });
}




const IDENTITY = ["id", "data-key", "data-item", "data-box", "data-day", "data-group", "data-note", "data-trash", "data-mail-row", "data-cal-task", "data-cal-event", "data-node", "data-item-title", "data-flip-key"];

function disown(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) for (const name of IDENTITY) el.removeAttribute(name);
  root.setAttribute("data-flip-ghost", "");
  root.setAttribute("aria-hidden", "true");
  root.inert = true;
}


function gapOf(parent: Node | null): number {
  if (!(parent instanceof HTMLElement)) return 0;
  const style = getComputedStyle(parent);
  if (!style.display.includes("flex") || !style.flexDirection.startsWith("column")) return 0;
  return parseFloat(style.rowGap) || 0;
}



function roomOf(el: HTMLElement): [Keyframe, Keyframe] {
  const style = getComputedStyle(el);
  const open: Keyframe = {
    height: `${el.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    borderTopWidth: style.borderTopWidth,
    borderBottomWidth: style.borderBottomWidth,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
  };
  const shut: Keyframe = { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", marginTop: `${-gapOf(el.parentNode)}px`, marginBottom: "0px" };
  return [open, shut];
}

type Ghost = { el: HTMLElement; key: string; share?: string; host: HTMLElement; layout: "list" | "grid"; exit: boolean };

function plantGhost(host: HTMLElement, placed: Placed, key: string, options: FlipOptions, motion: Pace): Ghost | null {
  const el = placed.el;
  if (el.isConnected || placed.h < 1 || el.dataset.flipExit === "none") return null;
  const layout = options.layout ?? "list";
  const ghost = { el, key, share: options.share, host, layout, exit: options.exit ?? true };
  if (layout === "grid") {
    
    if (getComputedStyle(host).position === "static") return null;
    disown(el);
    Object.assign(el.style, { position: "absolute", left: `${placed.x - host.clientLeft}px`, top: `${placed.y - host.clientTop}px`, width: `${placed.w}px`, height: `${placed.h}px`, margin: "0", pointerEvents: "none" });
    host.append(el);
    return ghost;
  }
  const parent = placed.parent;
  if (!parent?.isConnected) return null;
  disown(el);
  parent.insertBefore(el, placed.next && placed.next.parentNode === parent ? placed.next : null);
  
  Object.assign(el.style, { visibility: "hidden", overflow: "clip", minHeight: "0" });
  const [open, shut] = roomOf(el);
  run(el, [open, shut], { duration: motion.base, easing: motion.in, fill: "forwards" }, () => el.remove());
  return ghost;
}





type Arrival = { el: HTMLElement; key: string; share?: string; host: HTMLElement; layout: "list" | "grid"; enter: boolean; silent: boolean; natural: { w: number; h: number }; unfold: Animation | null; hold: Animation | null };

function hide(el: HTMLElement, motion: Pace): Animation {
  return run(el, [{ opacity: 0 }, { opacity: 0 }], { duration: motion.slow * 2 });
}

let arrivals: Arrival[] = [];
let ghosts: Ghost[] = [];
let queued = false;


const landings = new Map<string, { rect: Box; at: number }>();

export function landFrom(key: string, rect: Box): void {
  landings.set(key, { rect, at: performance.now() });
}

function takeLanding(key: string): Box | null {
  const landing = landings.get(key);
  landings.delete(key);
  return landing && performance.now() - landing.at < 1500 ? landing.rect : null;
}

function schedule() {
  if (queued) return;
  queued = true;
  
  queueMicrotask(flush);
}

function flush() {
  queued = false;
  const motion = pace();
  const pending = arrivals;
  const left = ghosts;
  arrivals = [];
  ghosts = [];
  const used = new Set<Ghost>();
  for (const arrival of pending) {
    const el = arrival.el;
    if (!el.isConnected) continue;
    const landing = takeLanding(arrival.key);
    const from = landing
      ? undefined
      : left.find((ghost) => !used.has(ghost) && ghost.key === arrival.key && (ghost.host === arrival.host || (ghost.share !== undefined && ghost.share === arrival.share)));
    if (from) used.add(from);
    if (motion && landing) {
      
      settle(el, landing, motion);
    } else if (motion && from) fly(from, arrival, motion);
    else if (motion && arrival.enter && !arrival.silent) enter(arrival, motion);
    else {
      arrival.unfold?.cancel();
      arrival.hold?.cancel();
    }
  }
  for (const ghost of left) {
    if (used.has(ghost)) continue;
    if (motion && ghost.exit) leave(ghost, motion);
    else {
      ghost.el.getAnimations().forEach((animation) => animation.cancel());
      ghost.el.remove();
    }
  }
}



function entrances(el: HTMLElement, subtree: boolean): CSSAnimation[] {
  return el.getAnimations({ subtree }).filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation && animation.effect?.getComputedTiming().iterations !== Infinity);
}





const CASCADE_MOST = 11;
function cascade(pieces: Map<string, HTMLElement>, motion: Pace) {
  const bottom = window.innerHeight;
  let step = 0;
  for (const el of pieces.values()) {
    if (entrances(el, false).length > 0) continue;
    if (el.getBoundingClientRect().top > bottom) continue;
    const timing = { duration: motion.enter, delay: Math.min(step, CASCADE_MOST) * motion.step, easing: motion.enterEase, fill: "backwards" as const };
    run(el, [{ opacity: 0.001 }, { opacity: 1 }], timing);
    run(el, [{ translate: `0 ${motion.rise}` }, { translate: "0 0" }], { ...timing, composite: "add" });
    step++;
  }
}



function enter(arrival: Arrival, motion: Pace) {
  const el = arrival.el;
  arrival.hold?.cancel();
  if (arrival.layout === "grid") entrances(el, true).forEach((animation) => animation.cancel());
  else if (entrances(el, false).length > 0) return;
  if (arrival.layout === "list") {
    run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: motion.base, easing: motion.out });
    return;
  }
  run(el, [{ opacity: 0, scale: "0.98" }, { opacity: 1, scale: "1" }], { duration: motion.slow, easing: motion.out });
  run(el, [{ translate: "0 0.5rem" }, { translate: "0 0" }], { duration: motion.slow, easing: motion.out, composite: "add" });
}


function leave(ghost: Ghost, motion: Pace) {
  const el = ghost.el;
  el.style.visibility = "";
  if (ghost.layout === "list") {
    run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: motion.base, easing: motion.in, fill: "forwards" });
    return;
  }
  run(el, [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.97" }], { duration: motion.base, easing: motion.in, fill: "forwards" }, () => el.remove());
}


function settle(el: HTMLElement, from: Box, motion: Pace) {
  el.getAnimations().forEach((animation) => {
    if (animation instanceof CSSTransition || animation instanceof CSSAnimation) return;
    animation.cancel();
  });
  entrances(el, true).forEach((animation) => animation.cancel());
  const rect = el.getBoundingClientRect();
  travel(el, from.x - rect.left, from.y - rect.top, motion);
}



let layer: HTMLElement | null = null;
function flightLayer(): HTMLElement {
  if (layer?.isConnected) return layer;
  layer = document.createElement("div");
  layer.setAttribute("data-flight-layer", "");
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  document.body.append(layer);
  return layer;
}

const flights = new Map<string, () => void>();

function fly(ghost: Ghost, arrival: Arrival, motion: Pace) {
  const from = ghost.el.getBoundingClientRect();
  
  if (ghost.layout === "grid") ghost.el.remove();
  const el = arrival.el;
  entrances(el, true).forEach((animation) => animation.cancel());
  flights.get(arrival.key)?.();
  if (ghost.host === arrival.host) {
    
    arrival.hold?.cancel();
    el.style.overflow = "";
    const rect = el.getBoundingClientRect();
    const lifted = el.style.zIndex;
    el.style.zIndex = "1";
    const animation = travel(el, from.left - rect.left, from.top - rect.top, motion);
    if (animation) animation.addEventListener("finish", () => (el.style.zIndex = lifted));
    else el.style.zIndex = lifted;
    return;
  }
  
  
  arrival.unfold?.cancel();
  const hold = arrival.hold ?? hide(el, motion);
  const copy = copyOf(el, arrival.natural);
  if (arrival.layout === "list") {
    const [open, shut] = roomOf(el);
    el.style.overflow = "clip";
    run(el, [shut, open], { duration: motion.base, easing: motion.out }, () => (el.style.overflow = ""));
  }
  flightLayer().append(copy);
  const clock = copy.animate([{ opacity: 1 }, { opacity: 1 }], { duration: motion.slow, easing: motion.std });
  let frame = 0;
  const step = () => {
    const progress = clock.effect?.getComputedTiming().progress ?? 1;
    const to = el.getBoundingClientRect();
    copy.style.translate = `${from.left + (to.left - from.left) * progress}px ${from.top + (to.top - from.top) * progress}px`;
    copy.style.width = `${from.width + (arrival.natural.w - from.width) * progress}px`;
    frame = requestAnimationFrame(step);
  };
  step();
  const land = () => {
    cancelAnimationFrame(frame);
    copy.remove();
    hold.cancel();
    if (flights.get(arrival.key) === land) flights.delete(arrival.key);
  };
  flights.set(arrival.key, land);
  clock.addEventListener("finish", land);
  clock.addEventListener("cancel", land);
}



function copyOf(source: HTMLElement, natural: { w: number; h: number }): HTMLElement {
  const copy = copyNode(source) as HTMLElement;
  
  
  const inner = source.firstElementChild instanceof HTMLElement ? getComputedStyle(source.firstElementChild) : null;
  const own = getComputedStyle(source);
  const bare = (style: CSSStyleDeclaration | null) => !style || style.backgroundColor === "transparent" || /,\s*0\)$/.test(style.backgroundColor);
  if (bare(own) && bare(inner)) copy.style.backgroundColor = "var(--card)";
  if (parseFloat(own.borderTopLeftRadius) === 0 && inner) copy.style.borderRadius = inner.borderTopLeftRadius;
  copy.style.boxShadow = "var(--shadow-pop)";
  Object.assign(copy.style, {
    position: "fixed",
    left: "0",
    top: "0",
    margin: "0",
    width: `${natural.w}px`,
    height: `${natural.h}px`,
    opacity: "1",
    pointerEvents: "none",
    zIndex: "var(--layer-float)",
    translate: "none",
    visibility: "visible",
    overflow: "visible",
  });
  return copy;
}


const KEPT = new Set(["src", "srcset", "viewBox", "d", "cx", "cy", "r", "x", "y", "x1", "x2", "y1", "y2", "rx", "ry", "points", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "xmlns"]);

function copyNode(node: Node): Node {
  if (!(node instanceof Element)) return node.cloneNode(false);
  const copy = node.cloneNode(false) as Element;
  for (const name of copy.getAttributeNames()) if (!KEPT.has(name) || !(copy instanceof SVGElement || copy instanceof HTMLImageElement)) copy.removeAttribute(name);
  copyStyle(getComputedStyle(node), copy, node);
  const before = pseudoOf(node, "::before");
  if (before) copy.append(before);
  for (const child of node.childNodes) copy.append(copyNode(child));
  const after = pseudoOf(node, "::after");
  if (after) copy.append(after);
  return copy;
}

function copyStyle(style: CSSStyleDeclaration, copy: Element, source: Element | null) {
  const target = (copy as HTMLElement | SVGElement).style;
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (!name.startsWith("--")) target.setProperty(name, style.getPropertyValue(name));
  }
  target.setProperty("transition", "none");
  target.setProperty("animation", "none");
  if (!source) return;
  for (const axis of ["columns", "rows"] as const) {
    if (!style.getPropertyValue(`grid-template-${axis}`).startsWith("subgrid")) continue;
    let holder = source.parentElement;
    while (holder && getComputedStyle(holder).getPropertyValue(`grid-template-${axis}`).startsWith("subgrid")) holder = holder.parentElement;
    if (!holder) continue;
    const grid = getComputedStyle(holder);
    target.setProperty(`grid-template-${axis}`, grid.getPropertyValue(`grid-template-${axis}`));
    const gap = axis === "columns" ? "column-gap" : "row-gap";
    target.setProperty(gap, grid.getPropertyValue(gap));
  }
}

function pseudoOf(node: Element, which: "::before" | "::after"): HTMLElement | null {
  const style = getComputedStyle(node, which);
  const content = style.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") return null;
  const box = document.createElement("span");
  copyStyle(style, box, null);
  box.textContent = /^"(.*)"$/.exec(content)?.[1] ?? "";
  return box;
}






export function useFlip(host: RefObject<HTMLElement | null>, options: FlipOptions): void {
  const state = useRef<HostState | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const current = (state.current ??= { placed: new Map(), mounted: false, options, arrangement: options.arrangement });
    current.options = options;
    commit(el, current);
  });

  
  
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = state.current;
        if (current?.mounted) current.placed = place(el, piecesOf(el, current.options.items), current.options.items);
      });
    };
    const sizes = new ResizeObserver(again);
    sizes.observe(el);
    const watched = new Set<Element>();
    const watch = () => {
      for (const piece of watched) {
        if (piece.isConnected) continue;
        watched.delete(piece);
        sizes.unobserve(piece);
      }
      for (const piece of el.querySelectorAll(state.current?.options.items ?? options.items)) {
        if (watched.has(piece)) continue;
        watched.add(piece);
        sizes.observe(piece);
      }
    };
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", again, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
      el.removeEventListener("scroll", again, { capture: true });
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function commit(host: HTMLElement, state: HostState) {
  const { items } = state.options;
  const layout = state.options.layout ?? "list";
  const motion = pace();
  const pieces = piecesOf(host, items);
  const rearranged = state.arrangement !== state.options.arrangement;
  state.arrangement = state.options.arrangement;
  const before = state.placed;
  const arrived = [...pieces].filter(([key, el]) => before.get(key)?.el !== el);
  const departed = [...before].filter(([key, placed]) => pieces.get(key) !== placed.el && !placed.el.isConnected);
  if (!motion || (state.mounted && (rearranged || arrived.length > MOST || departed.length > MOST))) {
    state.mounted = true;
    state.placed = place(host, pieces, items);
    
    
    
    if (motion && rearranged) {
      for (const animation of host.getAnimations({ subtree: true })) if (animation instanceof CSSTransition) animation.finish();
      if (state.options.cascade !== false) cascade(pieces, motion);
    }
    return;
  }

  if (!state.mounted) {
    
    if (pieces.size === 0) return;
    
    state.mounted = true;
    if (state.options.share) {
      for (const [key, el] of arrived) arrivals.push({ el, key, share: state.options.share, host, layout, enter: false, silent: true, natural: { w: el.offsetWidth, h: el.offsetHeight }, unfold: null, hold: null });
      if (arrived.length) schedule();
    }
    state.placed = place(host, pieces, items);
    if (state.options.cascade !== false) cascade(pieces, motion);
    return;
  }

  
  departed.sort((a, b) => b[1].index - a[1].index);
  if (state.options.share || state.options.exit !== false) {
    for (const [key, placed] of departed) {
      const ghost = plantGhost(host, placed, key, state.options, motion);
      if (ghost) ghosts.push(ghost);
    }
  }

  
  const enters = state.options.enter ?? true;
  for (const [key, el] of arrived) {
    const natural = { w: el.offsetWidth, h: el.offsetHeight };
    let unfold: Animation | null = null;
    if (layout === "list" && natural.h > 0 && (enters || state.options.share)) {
      const [open, shut] = roomOf(el);
      el.style.overflow = "clip";
      unfold = run(el, [shut, open], { duration: motion.base, easing: motion.out }, () => (el.style.overflow = ""));
    }
    arrivals.push({ el, key, share: state.options.share, host, layout, enter: enters, silent: false, natural, unfold, hold: hide(el, motion) });
  }

  
  
  const now = place(host, pieces, items);
  for (const [key, placed] of now) {
    const was = before.get(key);
    if (!was || was.el !== placed.el) continue;
    const landing = takeLanding(key);
    if (landing) settle(placed.el, landing, motion);
    else travel(placed.el, was.x - placed.x, was.y - placed.y, motion);
  }
  state.placed = now;
  if (arrivals.length || ghosts.length) schedule();
}
