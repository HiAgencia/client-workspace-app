export const NONCE_COOKIE = "google_connect_nonce";

export type ConnectState ={ nodeId: string; userId: string; nonce: string; expiresAt: number };

export type LinkState = { linkId: string; expiresAt: number };

const LIFETIME_MS = 10 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`oauth-state:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function newNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function signState(secret: string, value: Omit<ConnectState, "expiresAt">, now = Date.now()) {
  const payload = new TextEncoder().encode(JSON.stringify({ ...value, expiresAt: now + LIFETIME_MS }));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload));
  return `${b64url(payload)}.${b64url(signature)}`;
}

export async function signLinkState(secret: string, linkId: string, now = Date.now()) {
  const payload = new TextEncoder().encode(JSON.stringify({ linkId, expiresAt: now + LIFETIME_MS }));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload));
  return `${b64url(payload)}.${b64url(signature)}`;
}

export async function verifyLinkState(secret: string, state: string, now = Date.now()): Promise<LinkState | null> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(signature), fromB64url(payload));
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as LinkState;
    if (typeof value.linkId !== "string" || typeof value.expiresAt !== "number" || value.expiresAt < now) return null;
    return value;
  } catch {
    return null;
  }
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<ConnectState | null> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(signature), fromB64url(payload));
  } catch {
    return null;
  }
  if (!valid) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as ConnectState;
    if (typeof value.nodeId !== "string" || typeof value.userId !== "string" || typeof value.nonce !== "string") return null;
    if (typeof value.expiresAt !== "number" || value.expiresAt < now) return null;
    return value;
  } catch {
    return null;
  }
}
