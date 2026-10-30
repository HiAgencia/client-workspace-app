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


const runFile = () => inject("testUsersFile");


export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: integration tests need it in .dev.vars`);
  return value;
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  
  
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


export function publicClient(): Db {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    options,
  );
}


export async function createDisposableUser(label: string): Promise<DisposableUser> {
  const admin = serviceClient();
  const email = `test-${label}-${randomUUID()}@example.com`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`could not create the test user ${label}: ${created.error?.message ?? "no user returned"}`);
  }
  
  track(runFile(), created.data.user.id);
  const client = publicClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign in as ${label}: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client };
}







const POOL_FILE = join(suiteDir(), "cw-demo-pool.json");
const POOL_LOCK = join(suiteDir(), "cw-demo-pool.lock");

type Pool = Record<string, { id: string; refreshToken: string }>;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));



async function withPoolLock<T>(fn: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(POOL_LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(POOL_LOCK).mtimeMs > 20_000) rmSync(POOL_LOCK, { recursive: true, force: true });
      } catch {
        
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




export async function createAnonymousUser(label: string): Promise<DisposableUser> {
  const client = publicClient();
  const kept = await withPoolLock(() => readPool()[label]);
  let id: string | undefined;
  let refreshToken: string | undefined;
  if (kept) {
    
    
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
    
    track(runFile(), id);
    await remember(label, { id, refreshToken });
    untrack(runFile(), id);
  } else await remember(label, { id, refreshToken });
  await resetDemo(client);
  
  const refilled = await serviceClient().rpc("reset_demo_usage", { p_owner: id });
  if (refilled.error) throw new Error(`could not refill the usage of the demo session ${label}: ${refilled.error.message}`);
  return { id, email: `demo session ${label}`, client, pooled: label };
}



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
