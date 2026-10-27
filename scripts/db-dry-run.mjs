// Rehearses migrations against the linked Supabase project inside one transaction that is always rolled back, so a
// migration is proven to apply before `supabase db push` runs it for real.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/db-dry-run.mjs supabase/migrations/<file>.sql [more files]
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("ERROR: pass at least one migration file.");
  process.exit(2);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(2);
}
let ref;
try {
  ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
} catch {
  console.error("ERROR: no linked project (supabase/.temp/project-ref); run `supabase link` first.");
  process.exit(2);
}

const body = files.map((file) => readFileSync(file, "utf8")).join("\n");
const query = [
  "begin;",
  "set local lock_timeout = '5s';",
  "set local statement_timeout = '60s';",
  body,
  "rollback;",
].join("\n");

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const text = await response.text();
if (!response.ok) {
  console.error(`ERROR: the rehearsal failed (HTTP ${response.status}): ${text}`);
  process.exit(1);
}
console.log(`OK: ${files.length} migration file(s) applied and rolled back on ${ref}.`);
