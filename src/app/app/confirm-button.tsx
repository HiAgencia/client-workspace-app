"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";





export function ConfirmButton({ children, confirm, label, onConfirm }: { children: ReactNode; confirm: string; label?: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function back() {
    setAsking(false);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }

  if (!asking) {
    return (
      <Button ref={opener} variant="danger" size="sm" aria-label={label} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span
      className="inline-note confirm fade-enter"
      data-tone="alert"
      role="group"
      aria-label={confirm}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          back();
        }
      }}
    >
      <span className="confirm-text">{confirm}</span>
      <span className="inline">
        <Button size="sm" autoFocus onClick={back}>
          Back
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          Yes, {String(children).toLowerCase()}
        </Button>
      </span>
    </span>
  );
}
