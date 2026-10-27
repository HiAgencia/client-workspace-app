"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// What cannot be undone is never one click away: the first press asks in place, with "Back" offered first and holding
// the focus; Escape goes back too. The question takes the button's place and gives it back.
export function ConfirmButton({ children, confirm, onConfirm }: { children: ReactNode; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function back() {
    setAsking(false);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  }

  if (!asking) {
    return (
      <Button ref={opener} variant="danger" size="sm" onClick={() => setAsking(true)}>
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
