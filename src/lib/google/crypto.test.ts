import { describe, expect, it } from "vitest";
import { decrypt, encrypt, importKey, newKeyBase64 } from "./crypto";

describe("token encryption", () => {
  it("round-trips a token and never stores it in clear", async () => {
    const key = await importKey(newKeyBase64());
    const sealed = await encrypt(key, "1//refresh-token-ñ");
    expect(sealed).not.toContain("refresh-token");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(await decrypt(key, sealed)).toBe("1//refresh-token-ñ");
  });

  it("uses a fresh IV each time", async () => {
    const key = await importKey(newKeyBase64());
    expect(await encrypt(key, "same")).not.toBe(await encrypt(key, "same"));
  });

  it("refuses the wrong key and a tampered ciphertext", async () => {
    const key = await importKey(newKeyBase64());
    const other = await importKey(newKeyBase64());
    const sealed = await encrypt(key, "secret");
    await expect(decrypt(other, sealed)).rejects.toThrow();
    const [v, iv, body] = sealed.split(".");
    const flipped = body.slice(0, -2) + (body.at(-2) === "A" ? "B" : "A") + body.at(-1);
    await expect(decrypt(key, `${v}.${iv}.${flipped}`)).rejects.toThrow();
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(importKey(btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});
