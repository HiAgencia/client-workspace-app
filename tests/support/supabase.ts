import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type Db = SupabaseClient<Database>;

export type DisposableUser = { id: string; email: string; client: Db };

// A test that cannot reach its database fails with the reason; it never passes or skips.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: integration tests need it in .dev.vars`);
  return value;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): Db {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    options,
  );
}

// A client with the public key and no session: what anyone on the internet can do.
export function publicClient(): Db {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    options,
  );
}

// Creates a confirmed user with a random password and returns a client signed in as that user.
export async function createDisposableUser(label: string): Promise<DisposableUser> {
  const admin = serviceClient();
  const email = `test-${label}-${randomUUID()}@example.com`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`could not create the test user ${label}: ${created.error?.message ?? "no user returned"}`);
  }
  const client = publicClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign in as ${label}: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

// Deleting the user cascades to everything it owns.
export async function deleteDisposableUsers(users: Array<DisposableUser | undefined>): Promise<void> {
  const admin = serviceClient();
  const failures: string[] = [];
  for (const user of users) {
    if (!user) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.email}: ${error.message}`);
  }
  if (failures.length > 0) throw new Error(`test users left behind: ${failures.join("; ")}`);
}
