"use client";

import { useEffect, useState } from "react";

// What a block shows when its content changes to another thing —another week, another message—: the old content leaves
// first (`leaving`, which the block's style fades out) and only then the new one takes its place and fades in. The same
// thing with newer data (the same key) repaints in place, with no exit. The wait is the exit's duration (`--dur-fast`),
// and none under reduced motion.
const LEAVE_MS = 130;

export function useSwap<T>(value: T, key: string): { shown: T; shownKey: string; leaving: boolean } {
  const [kept, setKept] = useState({ value, key });
  const leaving = key !== kept.key;

  useEffect(() => {
    if (!leaving) return;
    const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : LEAVE_MS;
    const timer = setTimeout(() => setKept({ value, key }), wait);
    return () => clearTimeout(timer);
  }, [leaving, key, value]);

  return leaving ? { shown: kept.value, shownKey: kept.key, leaving } : { shown: value, shownKey: key, leaving };
}
