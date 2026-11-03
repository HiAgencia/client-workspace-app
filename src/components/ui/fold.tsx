"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/utils";
import { useAutoHeight } from "./use-auto-height";
import { afterExit } from "./use-exit";

type FoldProps = { open: boolean; id: string; className?: string; lazy?: boolean; follow?: boolean; children: ReactNode };





export function Fold(props: FoldProps) {
  return props.follow ? <FollowingFold {...props} /> : <GridFold {...props} />;
}


function GridFold({ open, id, className, lazy, children }: FoldProps) {
  const [settled, setSettled] = useState(open);
  const [seen, setSeen] = useState(open);
  const [held, setHeld] = useState(open);
  if (seen !== open) {
    setSeen(open);
    setSettled(false);
    if (open) setHeld(true);
  }
  return (
    <div
      className={cx("fold", className)}
      id={id}
      data-open={open}
      data-settled={(open && settled) || undefined}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
        setSettled(open);
        if (!open) setHeld(false);
      }}
    >
      <div>{!lazy || open || held ? children : null}</div>
    </div>
  );
}



function FollowingFold({ open, id, className, lazy, children }: FoldProps) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  useAutoHeight(box, body, { trigger: open });
  useEffect(() => {
    if (open || !held) return;
    return afterExit(box.current, () => setHeld(false));
  }, [open, held]);
  return (
    <div ref={box} className={cx("fold", className)} id={id} data-open={open} data-follow="" data-settled={open || undefined}>
      <div>
        <div ref={body} className="fold-body">
          {!lazy || open || held ? children : null}
        </div>
      </div>
    </div>
  );
}
