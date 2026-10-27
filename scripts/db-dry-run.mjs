// Rehearses migrations against the linked Supabase project inside one transaction that is always rolled back, so a
// migration is proven to apply before `supabase db push` runs it for real. A migration the project already applied is
// refused: replaying it would take exclusive locks on live tables and measure an old definition.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/db-dry-run.mjs supabase/migrations/<file>.sql [more files]
import { readFileSync } from "node:fs";
import { basename } from "node:path";

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

async function run(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

const registry = await run("select version from supabase_migrations.schema_migrations");
if (!registry.ok) {
  console.error(`ERROR: could not read the migration registry (HTTP ${registry.status}): ${registry.text}`);
  process.exit(2);
}
const applied = new Set(JSON.parse(registry.text).map((row) => String(row.version)));
const version = (file) => basename(file).split("_")[0];
const refused = files.filter((file) => applied.has(version(file)));
const pending = files.filter((file) => !applied.has(version(file)));
if (refused.length > 0) console.log(`Refused, already applied: ${refused.map((file) => basename(file)).join(", ")}`);
if (pending.length === 0) {
  console.error("ERROR: nothing left to rehearse.");
  process.exit(1);
}

const body = pending.map((file) => readFileSync(file, "utf8")).join("\n");
const rehearsal = await run(
  ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '60s';", body, "rollback;"].join("\n"),
);
if (!rehearsal.ok) {
  console.error(`ERROR: the rehearsal failed (HTTP ${rehearsal.status}): ${rehearsal.text}`);
  process.exit(1);
}
console.log(`OK: rehearsed and rolled back on ${ref}: ${pending.map((file) => basename(file)).join(", ")}`);
