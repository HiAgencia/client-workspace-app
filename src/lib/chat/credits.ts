import type { LanguageModelUsage } from "ai";
import type { Db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";
import { decrypt, encrypt, importKey } from "@/lib/google/crypto";

const DEFAULT_CAP_USD = 125;

export const PRICE = { input: 1.25, cachedInput: 0.15, output: 4.25 } as const;
const TRANSCRIPTION_PER_MINUTE = 3000;
export const UNREPORTED_STEP = 20_000;

export const CREDITS_MESSAGE =
  "The free AI credits are used up. Add your own Meta API key in Settings to keep using the assistant and dictation.";

export function creditCapMicroUsd(): number {
  const configured = Number(serverEnv("AI_CREDIT_CAP_USD"));
  return Math.floor((Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CAP_USD) * 1_000_000);
}

export function stepCost(usage: LanguageModelUsage | undefined): number {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (input === undefined && output === undefined) return UNREPORTED_STEP;
  const cached = Math.min(usage?.inputTokenDetails?.cacheReadTokens ?? 0, input ?? 0);
  return Math.ceil(((input ?? 0) - cached) * PRICE.input + cached * PRICE.cachedInput + (output ?? 0) * PRICE.output);
}

export function transcriptionCost(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60)) * TRANSCRIPTION_PER_MINUTE;
}

export async function serverSpent(service: Db): Promise<number | null> {
  const { data, error } = await service.from("ai_spend").select("micro_usd").eq("id", true).maybeSingle();
  if (error || !data) {
    console.error("ai credits: the spend could not be read", error?.message ?? "no row");
    return null;
  }
  return Number(data.micro_usd);
}

export async function addServerSpend(service: Db, microUsd: number): Promise<void> {
  if (microUsd <= 0) return;
  const { error } = await service.rpc("add_ai_spend", { p_micro_usd: Math.ceil(microUsd) });
  if (error) console.error("ai credits: the spend could not be added", Math.ceil(microUsd), error.message);
}

function encryptionKey(): Promise<CryptoKey> | null {
  const value = serverEnv("TOKEN_ENCRYPTION_KEY");
  return value ? importKey(value) : null;
}

export const keyHint = (key: string) => key.slice(-4);

export async function ownKey(service: Db, ownerId: string): Promise<string | null> {
  const { data, error } = await service.from("ai_keys").select("ciphertext").eq("owner_id", ownerId).maybeSingle();
  if (error) {
    console.error("ai key: read failed", error.message);
    return null;
  }
  if (!data) return null;
  const key = encryptionKey();
  if (!key) return null;
  try {
    return await decrypt(await key, data.ciphertext);
  } catch {
    console.error("ai key: a stored key no longer decrypts");
    return null;
  }
}

export async function saveOwnKey(service: Db, ownerId: string, apiKey: string): Promise<boolean> {
  const key = encryptionKey();
  if (!key) return false;
  const ciphertext = await encrypt(await key, apiKey);
  const { error } = await service
    .from("ai_keys")
    .upsert({ owner_id: ownerId, ciphertext, hint: keyHint(apiKey), created_at: new Date().toISOString() });
  if (error) console.error("ai key: save failed", error.message);
  return !error;
}

export type KeyChoice =
  | { ok: true; apiKey: string; own: boolean }
  | { ok: false; reason: "credits" | "unconfigured" };

export async function chooseKey(service: Db, ownerId: string): Promise<KeyChoice> {
  const own = await ownKey(service, ownerId);
  if (own) return { ok: true, apiKey: own, own: true };
  const server = serverEnv("MODEL_API_KEY");
  if (!server) return { ok: false, reason: "unconfigured" };
  const spent = await serverSpent(service);
  if (spent === null || spent >= creditCapMicroUsd()) return { ok: false, reason: "credits" };
  return { ok: true, apiKey: server, own: false };
}
