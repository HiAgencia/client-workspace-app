import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { publicConfig, requireServerEnv } from "@/lib/env";




export async function userClient(): Promise<Db> {
  const store = await cookies();
  const { supabaseUrl, supabaseKey } = publicConfig();
  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}


export function serviceClient(): Db {
  return createClient<Database>(publicConfig().supabaseUrl, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SessionUser = { id: string; email: string | null; isAnonymous: boolean };


export async function currentUser(db: Db): Promise<SessionUser | null> {
  const { data, error } = await db.auth.getUser();
  
  if (error && error.name !== "AuthSessionMissingError") console.error("auth: reading the user failed", error.status, error.name);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, isAnonymous: data.user.is_anonymous ?? false };
}
