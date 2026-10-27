// Writes the linked Supabase project's URL and API keys into .dev.vars (ignored by git), keeping every other line.
// Values are never printed: the output names only the variables it wrote.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/sync-dev-vars.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  console.error(`ERROR: could not read the API keys (HTTP ${response.status}).`);
  process.exit(1);
}
const keys = await response.json();
const pick = (type) => keys.find((key) => key.type === type && typeof key.api_key === "string")?.api_key;
const publishable = pick("publishable");
const secret = pick("secret");
if (!publishable || !secret) {
  console.error("ERROR: the project has no publishable and secret key pair.");
  process.exit(1);
}

const values = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  SUPABASE_SECRET_KEY: secret,
};

const lines = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8").split(/\r?\n/) : [];
const kept = lines.filter((line) => line.trim() !== "" && !Object.keys(values).some((name) => line.startsWith(`${name}=`)));
const written = Object.entries(values).map(([name, value]) => `${name}=${value}`);
writeFileSync(".dev.vars", [...kept, ...written].join("\n") + "\n");
console.log(`OK: wrote ${Object.keys(values).join(", ")} to .dev.vars`);
