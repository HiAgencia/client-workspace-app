import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@/lib/db/client";

export function suiteDir(): string {
  return process.env.DEMO_POOL_DIR || tmpdir();
}

const registryDir = () => join(suiteDir(), "cw-test-users");
const RUN_FILE = /^run-\d+(?:-\d+)?\.txt$/;

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

export function runAlive(pid: number, start: number | null): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
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

export async function deleteTestUser(admin: Db, id: string): Promise<string | null> {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (!error || error.status === 404 || /not found/i.test(error.message)) return null;
  return error.message;
}

export function keepInRun(run: RunRecord, ids: string[]): void {
  if (ids.length === 0) rmSync(run.file, { force: true });
  else writeFileSync(run.file, `run ${run.pid} ${run.start ?? ""}\n${ids.map((id) => `+${id}\n`).join("")}`);
}

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
    keepInRun(run, left);
  }
  return { runs, deleted, failed };
}

export async function stillThere(admin: Db, ids: string[]): Promise<string[]> {
  const there: string[] = [];
  for (const id of ids) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (data?.user) there.push(id);
    else if (error && error.status !== 404 && !/not found/i.test(error.message)) throw new Error(`reading the test user ${id}: ${error.message}`);
  }
  return there;
}

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
