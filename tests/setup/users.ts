import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";
import { countUsers, openRun, readRun, stillThere, sweepDeadRuns } from "../support/test-users";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import "./env";



function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed in .dev.vars to count the test users");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

declare module "vitest" {
  export interface ProvidedContext {
    
    testUsersFile: string;
  }
}




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
    for (const id of left) await admin.auth.admin.deleteUser(id);
    const after = await countUsers(admin);
    console.log(`[test users] before: ${before.total} (${before.suite} with the suite's address); after: ${after.total} (${after.suite}); left by this run: ${left.length}`);
    if (left.length > 0) throw new Error(`the run left ${left.length} test user(s) behind (deleted now): ${left.join(", ")}`);
    
    rmSync(file, { force: true });
  };
}
