"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";



export function CopyButton({ text, target, label = "Copy", onSelecting }: { text: string; target: string; label?: string; onSelecting?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      
      onSelecting?.();
      const block = document.getElementById(target);
      if (block) {
        const range = document.createRange();
        range.selectNodeContents(block);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setState("selected");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className="inline">
      <Button size="sm" onClick={() => void copy()} aria-describedby={`${target}-copy-state`}>
        {label}
      </Button>
      <span id={`${target}-copy-state`} className="t-meta copy-state" role="status" data-shown={state !== "idle" ? "" : undefined}>
        {state === "copied" ? "Copied" : state === "selected" ? "Selected: press Ctrl+C to copy" : ""}
      </span>
    </span>
  );
}
