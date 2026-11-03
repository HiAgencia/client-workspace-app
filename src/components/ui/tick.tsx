"use client";

import { useState } from "react";




export function Tick({ value }: { value: number | string }) {
  const [seen, setSeen] = useState(value);
  const [way, setWay] = useState<"up" | "down" | null>(null);
  if (value !== seen) {
    setSeen(value);
    setWay(amount(value) >= amount(seen) ? "up" : "down");
  }
  return (
    <span key={String(value)} className="tick" data-tick={way ?? undefined}>
      {value}
    </span>
  );
}


function amount(value: number | string): number {
  const number = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}
