"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import type { PublicConfig } from "@/lib/env";

let client: Db | undefined;

// One client per tab: it keeps the session fresh and writes it to the cookies the server reads.
export function browserClient(config: PublicConfig): Db {
  client ??= createBrowserClient<Database>(config.supabaseUrl, config.supabaseKey);
  return client;
}
