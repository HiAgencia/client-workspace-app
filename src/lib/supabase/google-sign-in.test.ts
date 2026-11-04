import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { googleSignInOptions } from "./google-sign-in";

function memoryClient() {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  return createClient("http://127.0.0.1:54321", "publishable-key", { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage } });
}

describe("signing in with Google", () => {
  it("comes back to the app's callback and asks Google for its account chooser", () => {
    expect(googleSignInOptions("http://localhost:8796")).toEqual({
      redirectTo: "http://localhost:8796/auth/callback",
      queryParams: { prompt: "select_account" },
    });
  });

  it("hands the chooser to Google through Supabase's sign-in address", async () => {
    const { data, error } = await memoryClient().auth.signInWithOAuth({
      provider: "google",
      options: { ...googleSignInOptions("http://localhost:3000"), skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    const address = new URL(data.url!);
    expect(address.pathname).toBe("/auth/v1/authorize");
    expect(address.searchParams.get("provider")).toBe("google");
    expect(address.searchParams.get("prompt")).toBe("select_account");
    expect(address.searchParams.get("redirect_to")).toBe("http://localhost:3000/auth/callback");
  });

  it("its twin: without the chooser, Google is not asked for it and goes to the account it used last", async () => {
    const { data } = await memoryClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback", skipBrowserRedirect: true },
    });
    expect(new URL(data.url!).searchParams.get("prompt")).toBeNull();
  });
});
