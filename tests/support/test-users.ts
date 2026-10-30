import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@/lib/db/client";

// The users a run of the suite creates, written down the moment they exist, so a run cut halfway (Ctrl+C, a crash, a
// killed terminal) leaves a record the next run reads to delete what it left. One file per run, named by the process
// that owns it and the moment it opened, and carrying the process's start time: a live run is never swept, a reused
// process id is not taken for the run that wrote it, and a run that gets a dead run's process id writes its own record
// beside that one, never over it. The file only grows (`+id` when a user is created, `-id` when it is deleted or handed
// to the demo pool), so the suite's files, each in its own worker, write it at once without losing a line.

// Where the suite keeps what lives between runs: this registry and the demo pool. The system's temporary folder by
// default; `DEMO_POOL_DIR` moves it somewhere the system does not clean.
export function suiteDir(): string {
  return process.env.DEMO_POOL_DIR || tmpdir();
}

const registryDir = () => join(suiteDir(), "cw-test-users");
// A run's record; one named by its process alone was written before records carried the moment they opened.
const RUN_FILE = /^run-\d+(?:-\d+)?\.txt$/;

// When a process started, in milliseconds since the epoch, or null where the system does not say. On Windows process ids
// are reused, so a live id alone could be another program.
export function startOf(pid: number): number | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate.ToFileTimeUtc()`], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim();
    const fileTime = Number(out);
    return Number.isFinite(fileTime) && fileTime > 0 ? Math.round(fileTime / 10_000 - 11_644_473_600_000) : null;
  } catch {
    return null;
  }
}

// Whether the run that wrote a file still lives: its process answers, and it is the same process (its start time). A
// file with no start time falls on the safe side: a live id counts as alive, and nothing of it is deleted.
export function runAlive(pid: number, start: number | null): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (start === null) return true;
  const actual = startOf(pid);
  return actual === null || Math.abs(actual - start) <= 2_000;
}

export type RunRecord = { file: string; pid: number; start: number | null; users: string[] };

export function readRun(file: string): RunRecord | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const [head, ...lines] = text.split("\n");
  const [, pid, start] = head.split(" ");
  const live = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("+")) live.add(line.slice(1).trim());
    else if (line.startsWith("-")) live.delete(line.slice(1).trim());
  }
  return { file, pid: Number(pid), start: start ? Number(start) : null, users: [...live].filter(Boolean) };
}

// Opens this run's record and returns its path.
export function openRun(pid = process.pid): string {
  mkdirSync(registryDir(), { recursive: true });
  const file = join(registryDir(), `run-${pid}-${Date.now()}.txt`);
  writeFileSync(file, `run ${pid} ${startOf(pid) ?? ""}\n`, { flag: "wx" });
  return file;
}

export function track(file: string, id: string): void {
  appendFileSync(file, `+${id}\n`);
}

export function untrack(file: string, id: string): void {
  appendFileSync(file, `-${id}\n`);
}

// Deletes a user and answers why it could not, or null; one already gone counts as deleted.
export async function deleteTestUser(admin: Db, id: string): Promise<string | null> {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (!error || error.status === 404 || /not found/i.test(error.message)) return null;
  return error.message;
}

// What the runs that no longer live left: each user is deleted and each emptied record removed. A user that could not
// be deleted stays in its record for the next run, and is counted. A live run's record, this run's included, is left
// alone by its process and start time.
export async function sweepDeadRuns(admin: Db): Promise<{ runs: number; deleted: number; failed: string[] }> {
  let names: string[] = [];
  try {
    names = readdirSync(registryDir());
  } catch {
    return { runs: 0, deleted: 0, failed: [] };
  }
  let runs = 0;
  let deleted = 0;
  const failed: string[] = [];
  for (const name of names) {
    if (!RUN_FILE.test(name)) continue;
    const run = readRun(join(registryDir(), name));
    if (!run || runAlive(run.pid, run.start)) continue;
    runs++;
    const left: string[] = [];
    for (const id of run.users) {
      const error = await deleteTestUser(admin, id);
      if (error) {
        left.push(id);
        failed.push(`${id}: ${error}`);
      } else deleted++;
    }
    if (left.length === 0) rmSync(run.file, { force: true });
    else writeFileSync(run.file, `run ${run.pid} ${run.start ?? ""}\n${left.map((id) => `+${id}\n`).join("")}`);
  }
  return { runs, deleted, failed };
}

// The users of a record that still exist in the project.
export async function stillThere(admin: Db, ids: string[]): Promise<string[]> {
  const there: string[] = [];
  for (const id of ids) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (data?.user) there.push(id);
    else if (error && error.status !== 404 && !/not found/i.test(error.message)) throw new Error(`reading the test user ${id}: ${error.message}`);
  }
  return there;
}

// How many users the project holds, and how many of them carry the suite's own address.
export async function countUsers(admin: Db): Promise<{ total: number; suite: number }> {
  let total = 0;
  let suite = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`counting the users: ${error.message}`);
    total += data.users.length;
    suite += data.users.filter((user) => /^test-.+@example\.com$/.test(user.email ?? "")).length;
    if (data.users.length < 1000) break;
  }
  return { total, suite };
}
