import type { Db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

export type UsageKind = "chat_message" | "transcription";

// Meta Model API has no hard spend cap of its own: each person's day carries one, on the server, taken before the
// model is called. Overridable per deployment; the defaults keep a public demo inside a known daily spend.
const DEFAULT_CAPS: Record<UsageKind, number> = { chat_message: 60, transcription: 20 };

export function dailyCap(kind: UsageKind): number {
  const configured = Number(serverEnv(kind === "chat_message" ? "CHAT_DAILY_CAP" : "TRANSCRIPTION_DAILY_CAP"));
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CAPS[kind];
}

// The day is cut in UTC, the same for everyone, so the cap cannot be reset by changing the browser's time zone.
export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function secondsToNextDay(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

export type TakeResult = { allowed: true; count: number } | { allowed: false; reason: "cap" | "error" };

// One unit of the day's allowance, taken atomically by the database; the service client is the only caller.
export async function takeUsage(service: Db, ownerId: string, kind: UsageKind, cap = dailyCap(kind), now = new Date()): Promise<TakeResult> {
  const { data, error } = await service.rpc("take_usage", { p_owner: ownerId, p_kind: kind, p_day: usageDay(now), p_cap: cap });
  if (error) {
    console.error("usage cap:", error.message);
    return { allowed: false, reason: "error" };
  }
  return typeof data === "number" ? { allowed: true, count: data } : { allowed: false, reason: "cap" };
}
