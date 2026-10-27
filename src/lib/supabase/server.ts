import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { publicConfig, requireServerEnv } from "@/lib/env";

// The signed-in person's client, for route handlers only: they can write cookies, so a refreshed session is stored.
// A Server Component cannot write cookies, and a refresh it could not store would spend the refresh token the browser
// still holds; that is why no page reads the session on the server, and the browser client keeps it fresh.
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

// The server's own client: it bypasses row-level security, so whoever uses it filters by owner itself.
export function serviceClient(): Db {
  return createClient<Database>(publicConfig().supabaseUrl, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SessionUser = { id: string; email: string | null; isAnonymous: boolean };

// Identity is checked against the auth server, so a session revoked there is not accepted from its cookie.
export async function currentUser(db: Db): Promise<SessionUser | null> {
  const { data, error } = await db.auth.getUser();
  // No session is the normal signed-out case; any other failure of the auth server is logged, not hidden as one.
  if (error && error.name !== "AuthSessionMissingError") console.error("auth: reading the user failed", error.status, error.name);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, isAnonymous: data.user.is_anonymous ?? false };
}
