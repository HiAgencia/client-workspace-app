import { serverEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import type { GoogleDeps } from "./events";
import { importKey } from "./crypto";

export function missingGoogleConfig(): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].filter((name) => !serverEnv(name));
}

export async function googleDeps(): Promise<GoogleDeps | null> {
  if (missingGoogleConfig().length > 0) return null;
  return {
    service: serviceClient(),
    key: await importKey(serverEnv("TOKEN_ENCRYPTION_KEY")!),
    client: { clientId: serverEnv("GOOGLE_CLIENT_ID")!, clientSecret: serverEnv("GOOGLE_CLIENT_SECRET")! },
    fetch: (input, init) => fetch(input, init),
  };
}
