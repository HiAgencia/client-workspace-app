import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The daily review left the product: no code may judge a task's mail with a model, run a review, or keep its switch.
// The names it had —its judge, its run, its folder, its switch— appear in this check alone.

const SRC = fileURLToPath(new URL(".", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const TRACE = /\b(?:ReviewJudge|reviewJudge|judgeFor|metaJudge|simulatedJudge|run_daily_review|dailyReview)\b|lib\/review\//;

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
    files.filter((file) => TRACE.test(file.text)).map((file) => relative(SRC, file.path)),
    "no trace of the daily review is left in the code",
  ).toEqual([]);
}

describe("the daily review", () => {
  it("left no trace in the code", () => {
    noTraceOfTheReview(filesUnder(SRC));
  });

  it("its twin: a file that still runs the review fails the check with its own words", () => {
    let failure: unknown = null;
    try {
      noTraceOfTheReview([...filesUnder(SRC), { path: join(SRC, "lib", "review", "run.ts"), text: "export async function run_daily_review() {}" }]);
    } catch (error) {
      failure = error;
    }
    expect(String((failure as Error | null)?.message)).toContain("no trace of the daily review is left in the code");
  });
});
