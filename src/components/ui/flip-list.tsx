"use client";

import { useRef, type ComponentProps } from "react";
import { useFlip } from "./flip";






export function FlipList({ ordered = false, share, layout, ...props }: { ordered?: boolean; share?: string; layout?: "list" | "grid" } & ComponentProps<"ul">) {
  const host = useRef<HTMLUListElement & HTMLOListElement>(null);
  useFlip(host, { items: ":scope > li", share, layout });
  return ordered ? <ol ref={host} {...(props as ComponentProps<"ol">)} /> : <ul ref={host} {...props} />;
}



export function FlipBox({ items = "[data-flip-key]", share, layout = "grid", ...props }: { items?: string; share?: string; layout?: "list" | "grid" } & ComponentProps<"div">) {
  const host = useRef<HTMLDivElement>(null);
  useFlip(host, { items, share, layout });
  return <div ref={host} {...props} />;
}
