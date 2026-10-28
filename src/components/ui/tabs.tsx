"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/lib/utils";
import { usePiece } from "./use-piece";

type TabsProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; controls: string }>;
  label: string;
  className?: string;
};

type Fit = "row" | "tight" | "grid";

// Short, exclusive views in a segmented control: a sunken rail and one raised piece that travels to the chosen tab.
// Its segments share one width. Where they do not fit on one line the air around the words gets shorter first, and only
// then the options go two to a row: a label never breaks, keeps its words at every width, and no option runs over its
// neighbor. Arrows move between tabs, as the tabs pattern asks.
export function Tabs<T extends string>({ value, onChange, options, label, className }: TabsProps<T>) {
  const rail = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>("row");
  usePiece(rail, '[aria-selected="true"]');

  const labels = options.map((option) => option.label).join("\n");
  useLayoutEffect(() => {
    const el = rail.current;
    const room = el?.parentElement;
    if (!el || !room) return;
    let live = true;
    const measure = () => {
      if (live) setFit(fitOf(el, room, labels.split("\n")));
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(room);
    // A label measured in the fallback font is narrower or wider than in the real one.
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      sizes.disconnect();
    };
  }, [labels]);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.value === value);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => rail.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.value}"]`)?.focus());
  }

  return (
    <div ref={rail} role="tablist" aria-label={label} className={cx("seg", className)} onKeyDown={onKey} data-fit={fit === "row" ? undefined : fit}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`${option.controls}-tab-${option.value}`}
          data-tab={option.value}
          aria-selected={option.value === value}
          aria-controls={option.controls}
          tabIndex={option.value === value ? 0 : -1}
          className="seg-option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * 10;
  context.font = font;
  return context.measureText(text).width;
}

// Which layout fits the room the rail has: equal segments, each as wide as the widest label at the chosen option's
// weight plus its air, so choosing another option never makes it overflow.
function fitOf(rail: HTMLElement, room: HTMLElement, labels: string[]): Fit {
  const option = rail.querySelector<HTMLElement>(".seg-option");
  if (!option) return "row";
  const own = getComputedStyle(option);
  const railStyle = getComputedStyle(rail);
  const roomStyle = getComputedStyle(room);
  const size = parseFloat(own.fontSize);
  const font = `700 ${own.fontSize} ${own.fontFamily}`;
  const air = (name: string) => 2 * size * (parseFloat(railStyle.getPropertyValue(name)) || 0.9);
  const chrome = parseFloat(railStyle.paddingLeft) + parseFloat(railStyle.paddingRight) + parseFloat(railStyle.borderLeftWidth) + parseFloat(railStyle.borderRightWidth);
  const gap = parseFloat(railStyle.columnGap) || 0;
  const width = room.clientWidth - parseFloat(roomStyle.paddingLeft) - parseFloat(roomStyle.paddingRight);
  // A pixel of slack per segment: text measured off screen and drawn on it round apart.
  const widest = Math.max(...labels.map((text) => textWidth(text, font))) + 1;
  const row = (padding: number) => labels.length * (widest + padding) + (labels.length - 1) * gap + chrome;
  if (row(air("--seg-air-wide")) <= width) return "row";
  if (row(air("--seg-air-tight")) <= width) return "tight";
  return "grid";
}
