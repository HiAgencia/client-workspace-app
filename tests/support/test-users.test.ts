import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { openRun, readRun, sweepDeadRuns } from "./test-users";

// The registry of a run's users, over a folder of its own and an admin that only records what it is asked to delete.
// Telling a dead run from a live one reads each process's start time, which only Windows answers here.
describe.skipIf(process.platform !== "win32")("the registry of a run's test users", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cw-registry-"));
    vi.stubEnv("DEMO_POOL_DIR", dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the record of a dead run that had this process's id, sweeps it, and leaves the live run's own", async () => {
    const records = join(dir, "cw-test-users");
    mkdirSync(records, { recursive: true });
    // A run that died a day ago under the process id this run now holds, named as a record named only by its process.
    const dead = join(records, `run-${process.pid}.txt`);
    writeFileSync(dead, `run ${process.pid} ${Date.now() - 86_400_000}\n+user-left-behind\n`);
    const own = openRun();
    expect(own).not.toBe(dead);
    expect(readRun(dead)?.users).toEqual(["user-left-behind"]);

    const deleted: string[] = [];
    const admin = { auth: { admin: { deleteUser: async (id: string) => (deleted.push(id), { error: null }) } } } as unknown as Db;
    expect(await sweepDeadRuns(admin)).toEqual({ runs: 1, deleted: 1, failed: [] });
    expect(deleted).toEqual(["user-left-behind"]);
    expect(readdirSync(records)).toEqual([basename(own)]);
  });
});
