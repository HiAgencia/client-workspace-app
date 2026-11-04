"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import type { PublicConfig } from "@/lib/env";

let client: Db | undefined;

export function browserClient(config: PublicConfig): Db {
  client ??= createBrowserClient<Database>(config.supabaseUrl, config.supabaseKey);
  return client;
}
