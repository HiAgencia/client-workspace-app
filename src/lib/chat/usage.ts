import { untilAgain } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

export type UsageKind = "chat_message" | "transcription" | "daily_review";

// Meta Model API has no hard spend cap of its own, so the server carries three: each signed-in person's day, each
// demo session's day (smaller), and the day of all demo sessions together, because a new demo session is one click
// away and must not bring a new budget. Each is overridable per deployment. A daily review read by Meta's model is one
// unit, however many tasks it reads.
const DEFAULTS = {
  person: { chat_message: 60, transcription: 20, daily_review: 5 },
  demoSession: { chat_message: 20, transcription: 5, daily_review: 2 },
  demoTotal: { chat_message: 400, transcription: 60, daily_review: 100 },
} as const;

const NAMES = {
  person: { chat_message: "CHAT_DAILY_CAP", transcription: "TRANSCRIPTION_DAILY_CAP", daily_review: "DAILY_REVIEW_DAILY_CAP" },
  demoSession: { chat_message: "DEMO_CHAT_DAILY_CAP", transcription: "DEMO_TRANSCRIPTION_DAILY_CAP", daily_review: "DEMO_DAILY_REVIEW_DAILY_CAP" },
  demoTotal: { chat_message: "DEMO_TOTAL_CHAT_DAILY_CAP", transcription: "DEMO_TOTAL_TRANSCRIPTION_DAILY_CAP", daily_review: "DEMO_TOTAL_DAILY_REVIEW_DAILY_CAP" },
} as const;

export function dailyCap(scope: keyof typeof DEFAULTS, kind: UsageKind): number {
  const configured = Number(serverEnv(NAMES[scope][kind]));
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULTS[scope][kind];
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

export type TakeResult = { allowed: true; count: number } | { allowed: false; reason: "cap" | "demo_cap" | "error" };

// One unit of a person's day, taken atomically by the database; the service client is the only caller.
export async function takeUsage(service: Db, ownerId: string, kind: UsageKind, cap: number, now = new Date()): Promise<TakeResult> {
  const { data, error } = await service.rpc("take_usage", { p_owner: ownerId, p_kind: kind, p_day: usageDay(now), p_cap: cap });
  if (error) {
    console.error("usage cap:", error.message);
    return { allowed: false, reason: "error" };
  }
  return typeof data === "number" ? { allowed: true, count: data } : { allowed: false, reason: "cap" };
}

// The cap that applies to who is asking: a demo session first checks the day of all demo sessions together.
export async function takeUsageFor(
  service: Db,
  user: { id: string; isAnonymous: boolean },
  kind: UsageKind,
  now = new Date(),
): Promise<TakeResult> {
  if (!user.isAnonymous) return takeUsage(service, user.id, kind, dailyCap("person", kind), now);
  const { data, error } = await service.rpc("anonymous_usage", { p_kind: kind, p_day: usageDay(now) });
  if (error) {
    console.error("demo usage:", error.message);
    return { allowed: false, reason: "error" };
  }
  if (Number(data) >= dailyCap("demoTotal", kind)) return { allowed: false, reason: "demo_cap" };
  return takeUsage(service, user.id, kind, dailyCap("demoSession", kind), now);
}

// The cap's sentence says when it lifts in the words of whoever reads it —the hours left, or that it comes back
// tomorrow—, never as «midnight UTC», which is a time the person does not live in.
export function capMessage(reason: "cap" | "demo_cap", kind: UsageKind, seconds = secondsToNextDay()): string {
  const what = kind === "chat_message" ? "chat messages" : kind === "transcription" ? "voice notes" : "daily reviews";
  const when = untilAgain(seconds);
  return reason === "demo_cap"
    ? `The demo reached today's limit of ${what} for everyone. Sign in with Google to keep going, or come back ${when}.`
    : `You reached today's limit of ${what}. It comes back ${when}.`;
}
