"use client";

import { useState, type ReactNode } from "react";


export function Fold({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const [settled, setSettled] = useState(open);
  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    setSettled(false);
  }
  return (
    <div
      className="fold"
      id={id}
      data-open={open}
      data-settled={(open && settled) || undefined}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") setSettled(open);
      }}
    >
      <div>{children}</div>
    </div>
  );
}
