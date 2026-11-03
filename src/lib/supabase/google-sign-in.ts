"use client";

import type { PublicConfig } from "@/lib/env";
import { browserClient } from "./browser";





export function googleSignInOptions(origin: string) {
  return { redirectTo: new URL("/auth/callback", origin).toString(), queryParams: { prompt: "select_account" } };
}


export function signInWithGoogle(config: PublicConfig) {
  return browserClient(config).auth.signInWithOAuth({ provider: "google", options: googleSignInOptions(window.location.origin) });
}
