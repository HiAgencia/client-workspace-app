import { untilAgain } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

export type UsageKind = "chat_message" | "transcription";




const DEFAULTS = {
  person: { chat_message: 60, transcription: 20 },
  demoSession: { chat_message: 20, transcription: 5 },
  demoTotal: { chat_message: 400, transcription: 60 },
} as const;

const NAMES = {
  person: { chat_message: "CHAT_DAILY_CAP", transcription: "TRANSCRIPTION_DAILY_CAP" },
  demoSession: { chat_message: "DEMO_CHAT_DAILY_CAP", transcription: "DEMO_TRANSCRIPTION_DAILY_CAP" },
  demoTotal: { chat_message: "DEMO_TOTAL_CHAT_DAILY_CAP", transcription: "DEMO_TOTAL_TRANSCRIPTION_DAILY_CAP" },
} as const;

export function dailyCap(scope: keyof typeof DEFAULTS, kind: UsageKind): number {
  const configured = Number(serverEnv(NAMES[scope][kind]));
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULTS[scope][kind];
}


export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function secondsToNextDay(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

export type TakeResult = { allowed: true; count: number } | { allowed: false; reason: "cap" | "demo_cap" | "error" };


export async function takeUsage(service: Db, ownerId: string, kind: UsageKind, cap: number, now = new Date()): Promise<TakeResult> {
  const { data, error } = await service.rpc("take_usage", { p_owner: ownerId, p_kind: kind, p_day: usageDay(now), p_cap: cap });
  if (error) {
    console.error("usage cap:", error.message);
    return { allowed: false, reason: "error" };
  }
  return typeof data === "number" ? { allowed: true, count: data } : { allowed: false, reason: "cap" };
}


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



export function capMessage(reason: "cap" | "demo_cap", kind: UsageKind, seconds = secondsToNextDay()): string {
  const what = kind === "chat_message" ? "chat messages" : "voice notes";
  const when = untilAgain(seconds);
  return reason === "demo_cap"
    ? `The demo reached today's limit of ${what} for everyone. Sign in with Google to keep going, or come back ${when}.`
    : `You reached today's limit of ${what}. It comes back ${when}.`;
}
