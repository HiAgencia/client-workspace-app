import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { publicConfig, requireServerEnv } from "@/lib/env";
import { problem } from "@/lib/http";
import { sessionPerson } from "@/lib/session-person";




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



export type SessionUser = { id: string; email: string | null; isAnonymous: boolean; name: string | null; avatarUrl: string | null };



export type SessionReading = { kind: "user"; user: SessionUser } | { kind: "none" } | { kind: "unavailable" };


const RETRY_PAUSES_MS = [150, 400];


function refused(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}


export async function readSession(db: Db): Promise<SessionReading> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db.auth.getUser();
    if (!error) {
      if (!data.user) return { kind: "none" };
      const { name, avatarUrl } = sessionPerson(data.user.user_metadata);
      return { kind: "user", user: { id: data.user.id, email: data.user.email ?? null, isAnonymous: data.user.is_anonymous ?? false, name, avatarUrl } };
    }
    
    if (error.name === "AuthSessionMissingError") return { kind: "none" };
    console.error("auth: reading the user failed", error.status, error.name);
    if (refused(error.status)) return { kind: "none" };
    if (attempt === RETRY_PAUSES_MS.length) return { kind: "unavailable" };
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSES_MS[attempt]));
  }
}



export async function requireUser(db: Db): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const session = await readSession(db);
  if (session.kind === "user") return { ok: true, user: session.user };
  if (session.kind === "none") return { ok: false, response: problem(401, "not signed in") };
  return { ok: false, response: problem(503, "The session could not be checked. Try again.") };
}
