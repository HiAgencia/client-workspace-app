"use client";

import { useEffect, useState } from "react";





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
