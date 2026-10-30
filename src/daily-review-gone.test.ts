import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The daily review left the product: no code may judge a task's mail with a model, run a review, or keep its switch.
// The names it had —its judge, its run, its folder, its switch— appear in this check alone.

const SRC = fileURLToPath(new URL(".", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const TRACE = /\b(?:ReviewJudge|reviewJudge|judgeFor|metaJudge|simulatedJudge|run_daily_review|dailyReview)\b|lib\/review\//;
// Its folder, read from where a file lives and not only from what imports it.
const FOLDER = /^lib\/review\//;

type File = { path: string; text: string };

function filesUnder(folder: string): File[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry): File[] => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    if (!/\.(ts|tsx|css)$/.test(entry.name) || path === SELF) return [];
    return [{ path, text: readFileSync(path, "utf8") }];
  });
}

function noTraceOfTheReview(files: File[]) {
  expect(files.length, "the code was read").toBeGreaterThan(0);
  expect(
    files.filter((file) => TRACE.test(file.text) || FOLDER.test(relative(SRC, file.path).replace(/\\/g, "/"))).map((file) => relative(SRC, file.path)),
    "no trace of the daily review is left in the code",
  ).toEqual([]);
}

describe("the daily review", () => {
  it("left no trace in the code", () => {
    noTraceOfTheReview(filesUnder(SRC));
  });

  // Each twin plants one trace in the code read: a name, or only a file in the review's folder.
  const failsWith = (planted: File) => {
    let failure: unknown = null;
    try {
      noTraceOfTheReview([...filesUnder(SRC), planted]);
    } catch (error) {
      failure = error;
    }
    expect(String((failure as Error | null)?.message)).toContain("no trace of the daily review is left in the code");
  };

  it("its twin: a file that still runs the review fails the check with its own words", () => {
    failsWith({ path: join(SRC, "lib", "elsewhere.ts"), text: "export async function run_daily_review() {}" });
  });

  it("its twin: a file left in the review's folder, naming nothing, fails the check too", () => {
    failsWith({ path: join(SRC, "lib", "review", "notes.ts"), text: "export const notes = [];" });
  });
});
