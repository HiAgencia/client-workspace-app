import { documentCookies, sessionOwner } from "@/lib/supabase/session-owner";







export type Stamp = { seq: number; epoch: number; at: number };
export type Kept<T> = { value: T; at: number };

type Entry = { value: unknown; seq: number; at: number };



export const KEPT_LIMIT = 120;



export const FRESH_MS = 10_000;



const STORED_PREFIX = "client-workspace:read:";

let epoch = 0;
let seq = 0;
const kept = new Map<string, Entry>();
const listeners = new Set<() => void>();
let inFlight = 0;


export function stamp(): Stamp {
  return { seq: ++seq, epoch, at: Date.now() };
}


export function keep(key: string, value: unknown, stamped: Stamp, stored = false): void {
  if (stamped.epoch !== epoch) return;
  const known = kept.get(key);
  if (known && known.seq > stamped.seq) return;
  kept.delete(key);
  kept.set(key, { value, seq: stamped.seq, at: stamped.at });
  while (kept.size > KEPT_LIMIT) kept.delete(kept.keys().next().value as string);
  if (stored) store(key, value);
}


export function peek<T>(key: string, stored = false): Kept<T> | null {
  const entry = kept.get(key);
  if (entry) {
    
    kept.delete(key);
    kept.set(key, entry);
    return { value: entry.value as T, at: entry.at };
  }
  if (!stored) return null;
  const value = restore(key);
  
  return value === undefined ? null : { value: value as T, at: 0 };
}

export function isFresh(entry: Kept<unknown>, now = Date.now()): boolean {
  return entry.at > 0 && now - entry.at < FRESH_MS;
}



export function wrote(): void {
  epoch++;
  kept.clear();
  dropStored();
}


export function forgetReads(): void {
  wrote();
}




export function readStarted(): void {
  inFlight++;
  if (inFlight === 1) notify(listeners);
}

export function readEnded(): void {
  inFlight = Math.max(0, inFlight - 1);
  if (inFlight === 0) notify(listeners);
}

export function readsInFlight(): number {
  return inFlight;
}

export function onReads(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

let refreshing = 0;
const refreshListeners = new Set<() => void>();


export function refreshStarted(): void {
  refreshing++;
  if (refreshing === 1) notify(refreshListeners);
}

export function refreshEnded(): void {
  refreshing = Math.max(0, refreshing - 1);
  if (refreshing === 0) notify(refreshListeners);
}

export function refreshesInFlight(): number {
  return refreshing;
}

export function onRefreshes(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => void refreshListeners.delete(listener);
}

function notify(to: Set<() => void>) {
  for (const listener of to) listener();
}



function owner(): string | null {
  return sessionOwner(documentCookies());
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  const who = owner();
  if (!who) return;
  try {
    storage()?.setItem(STORED_PREFIX + key, JSON.stringify({ owner: who, value }));
  } catch {
    
  }
}

function restore(key: string): unknown {
  const who = owner();
  if (!who) return undefined;
  try {
    const raw = storage()?.getItem(STORED_PREFIX + key);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { owner?: unknown; value?: unknown };
    
    if (saved.owner !== who) {
      storage()?.removeItem(STORED_PREFIX + key);
      return undefined;
    }
    return saved.value;
  } catch {
    return undefined;
  }
}

function dropStored() {
  const tab = storage();
  if (!tab) return;
  try {
    for (let index = tab.length - 1; index >= 0; index--) {
      const name = tab.key(index);
      if (name?.startsWith(STORED_PREFIX)) tab.removeItem(name);
    }
  } catch {
    
  }
}
