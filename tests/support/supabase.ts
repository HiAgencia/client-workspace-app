import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { resetDemo } from "@/lib/demo-seed";
import { suiteDir, track, untrack } from "./test-users";

export type { Db };

export type DisposableUser = { id: string; email: string; client: Db; pooled?: string };

// This run's record of the users it creates, opened by the run's global setup (`tests/setup/users.ts`).
const runFile = () => inject("testUsersFile");

// A test that cannot reach its database fails with the reason; it never passes or skips.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: integration tests need it in .dev.vars`);
  return value;
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  // A request that never answers fails its test after this deadline instead of holding the worker; the suite talks to
  // one remote project over the network.
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }),
  },
} as const;

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
  // Written down before anything else can fail: a run cut from here on leaves it for the next run to delete.
  track(runFile(), created.data.user.id);
  const client = publicClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign in as ${label}: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

// The demo sessions the suite reuses, one per label, kept under the machine's temporary folder and never in the
// repository: the project limits the anonymous sign-ups one address opens per hour, and a run that opened one per step
// ran into it. The session of a label lives between runs, and a caller starts from an
// empty workspace because it is emptied before every use. `DEMO_POOL_LIMPIAR=1` deletes them instead of keeping them.
// The pool's file is the only record of those live users: it lives in `suiteDir()` (`DEMO_POOL_DIR`, else the system's
// temporary folder).
const POOL_FILE = join(suiteDir(), "cw-demo-pool.json");
const POOL_LOCK = join(suiteDir(), "cw-demo-pool.lock");

type Pool = Record<string, { id: string; refreshToken: string }>;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A lock of the file itself: the suite's files run at once, each in its own process, and two of them writing the pool at
// the same moment would lose one of the two sessions.
async function withPoolLock<T>(fn: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(POOL_LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(POOL_LOCK).mtimeMs > 20_000) rmSync(POOL_LOCK, { recursive: true, force: true });
      } catch {
        // The lock went away between the two calls: the next attempt takes it.
      }
      if (attempt > 1200) throw new Error("the demo pool's lock was never released");
      await wait(50);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(POOL_LOCK, { recursive: true, force: true });
  }
}

function readPool(): Pool {
  try {
    const read = JSON.parse(readFileSync(POOL_FILE, "utf8"));
    return read && typeof read === "object" ? (read as Pool) : {};
  } catch {
    return {};
  }
}

function writePool(pool: Pool): void {
  writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2));
}

async function remember(label: string, session: { id: string; refreshToken: string }): Promise<void> {
  await withPoolLock(() => {
    writePool({ ...readPool(), [label]: session });
  });
}

async function forget(label: string): Promise<void> {
  await withPoolLock(() => {
    const pool = readPool();
    delete pool[label];
    writePool(pool);
  });
}

// A demo session: an anonymous user, the only one the demo's sample accounts and mail are planted for. Its email is a
// label for the failure messages. The same label keeps the same session between runs, emptied first, so the suite does
// not open one per step.
export async function createAnonymousUser(label: string): Promise<DisposableUser> {
  const client = publicClient();
  const kept = await withPoolLock(() => readPool()[label]);
  let id: string | undefined;
  let refreshToken: string | undefined;
  if (kept) {
    // The session of a previous run answers with a new access token; a session that no longer answers is deleted so the
    // pool never keeps dead users.
    const renewed = await client.auth.refreshSession({ refresh_token: kept.refreshToken });
    if (!renewed.error && renewed.data.session) {
      id = renewed.data.user?.id ?? kept.id;
      refreshToken = renewed.data.session.refresh_token;
    } else {
      await forget(label);
      await serviceClient().auth.admin.deleteUser(kept.id);
    }
  }
  if (!id || !refreshToken) {
    const opened = await client.auth.signInAnonymously();
    if (opened.error || !opened.data.user || !opened.data.session) {
      throw new Error(`could not open a demo session for ${label}: ${opened.error?.message ?? "no session returned"}`);
    }
    id = opened.data.user.id;
    refreshToken = opened.data.session.refresh_token;
    // A new session is this run's until the pool holds it.
    track(runFile(), id);
    await remember(label, { id, refreshToken });
    untrack(runFile(), id);
  } else await remember(label, { id, refreshToken });
  await resetDemo(client);
  // Starting over keeps the day's usage of the models; the suite refills the session it reuses through the service role.
  const refilled = await serviceClient().rpc("reset_demo_usage", { p_owner: id });
  if (refilled.error) throw new Error(`could not refill the usage of the demo session ${label}: ${refilled.error.message}`);
  return { id, email: `demo session ${label}`, client, pooled: label };
}

// Deleting the user cascades to everything it owns. A demo session of the pool is kept for the next run instead, unless
// the run was told to leave nothing behind.
export async function deleteDisposableUsers(users: Array<DisposableUser | undefined>): Promise<void> {
  const admin = serviceClient();
  const clearing = process.env.DEMO_POOL_LIMPIAR === "1";
  const failures: string[] = [];
  for (const user of users) {
    if (!user) continue;
    if (user.pooled && !clearing) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) failures.push(`${user.email}: ${error.message}`);
    else if (!user.pooled) untrack(runFile(), user.id);
    if (user.pooled && !error) await forget(user.pooled);
  }
  if (failures.length > 0) throw new Error(`test users left behind: ${failures.join("; ")}`);
}
