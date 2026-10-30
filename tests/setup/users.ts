import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";
import { countUsers, deleteTestUser, openRun, readRun, stillThere, sweepDeadRuns } from "../support/test-users";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import "./env";

// The service role, built here: the global setup runs outside the test workers, where `../support/supabase` (which reads
// the run's record through vitest's `inject`) is not loaded.
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed in .dev.vars to count the test users");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

declare module "vitest" {
  export interface ProvidedContext {
    // This run's record of the users it creates (`tests/support/test-users.ts`).
    testUsersFile: string;
  }
}

// Once per run, before any test file: deletes what runs cut halfway left, counts the project's users, and opens this run's
// record. At the end it counts again and fails the run if a user it created is still there, deleting it so the next run
// starts clean.
export default async function setup(project: TestProject) {
  const admin = serviceClient();
  const swept = await sweepDeadRuns(admin);
  if (swept.runs > 0 || swept.failed.length > 0) {
    const failed = swept.failed.length > 0 ? `; ${swept.failed.length} could not be, and wait for the next run: ${swept.failed.join("; ")}` : "";
    console.log(`[test users] ${swept.runs} cut run(s) found: ${swept.deleted} user(s) they left deleted${failed}`);
  }
  const before = await countUsers(admin);
  const file = openRun();
  project.provide("testUsersFile", file);

  return async () => {
    const run = readRun(file);
    const left = await stillThere(admin, run?.users ?? []);
    const failed: string[] = [];
    for (const id of left) {
      const error = await deleteTestUser(admin, id);
      if (error) failed.push(`${id}: ${error}`);
    }
    const after = await countUsers(admin);
    console.log(`[test users] before: ${before.total} (${before.suite} with the suite's address); after: ${after.total} (${after.suite}); left by this run: ${left.length}`);
    // A run whose users are all gone leaves no record; one that was cut, or whose user could not be deleted, keeps it for
    // the next run to sweep.
    if (failed.length === 0) rmSync(file, { force: true });
    if (left.length > 0) {
      const deleted = failed.length === 0 ? "deleted now" : `${failed.length} could not be deleted and wait in the run's record for the next run: ${failed.join("; ")}`;
      throw new Error(`the run left ${left.length} test user(s) behind (${deleted}): ${left.join(", ")}`);
    }
  };
}
