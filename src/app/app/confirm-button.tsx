"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// What cannot be undone is never one click away: the first press asks, with "Back" offered first.
export function ConfirmButton({ children, confirm, onConfirm }: { children: ReactNode; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2" role="group" aria-label={confirm}>
      <span>{confirm}</span>
      <Button size="sm" autoFocus onClick={() => setAsking(false)}>
        Back
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Yes, {String(children).toLowerCase()}
      </Button>
    </span>
  );
}
