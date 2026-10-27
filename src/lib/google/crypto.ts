// OAuth tokens are stored encrypted with AES-GCM under a 32-byte key kept as a server secret
// (`TOKEN_ENCRYPTION_KEY`, base64). Each ciphertext carries its own random 12-byte IV: `v1.<iv>.<ciphertext>`, both in
// base64url. WebCrypto runs the same on Node and on Workers.

const VERSION = "v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key.trim());
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes in base64");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
}

// A wrong key or a tampered ciphertext fails the GCM tag check and throws: the caller treats the account as broken.
export async function decrypt(key: CryptoKey, ciphertext: string): Promise<string> {
  const [version, iv, sealed] = ciphertext.split(".");
  if (version !== VERSION || !iv || !sealed) throw new Error("unknown token ciphertext format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(sealed));
  return new TextDecoder().decode(plain);
}

export function newKeyBase64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
