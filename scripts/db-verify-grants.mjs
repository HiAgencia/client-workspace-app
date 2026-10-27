// Proves the schema starts closed: inside a transaction that is always rolled back, a function created the way a
// migration creates it must not be executable by the API roles, and the default privileges must give them nothing.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/db-verify-grants.mjs
import { readFileSync } from "node:fs";

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

const query = `
begin;
create function public.grant_probe() returns int language sql as 'select 1';
select
  has_function_privilege('anon', 'public.grant_probe()', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.grant_probe()', 'EXECUTE') as authenticated_can_execute,
  -- Only the defaults of the role that runs the migrations: the platform's own roles keep theirs for their objects.
  (select count(*) from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
     where d.defaclrole = 'postgres'::regrole and (n.nspname = 'public' or n.nspname is null)
       and array_to_string(d.defaclacl, ',') ~ '(^|,)(=|anon=|authenticated=|service_role=)') as api_role_defaults_in_public,
  -- Existing objects: anon reaches nothing, and no API role holds a privilege the schema never grants.
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and (grantee = 'anon'
       or (grantee in ('authenticated', 'service_role') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')))) as stray_table_grants,
  (select count(*) from information_schema.usage_privileges
     where object_schema = 'public' and object_type = 'SEQUENCE' and grantee in ('anon', 'authenticated')) as sequence_grants;
rollback;`;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) {
  console.error(`ERROR: the check could not run (HTTP ${response.status}): ${await response.text()}`);
  process.exit(2);
}
const [row] = await response.json();
console.log(JSON.stringify(row));
const closed =
  row.anon_can_execute === false &&
  row.authenticated_can_execute === false &&
  Number(row.api_role_defaults_in_public) === 0 &&
  Number(row.stray_table_grants) === 0 &&
  Number(row.sequence_grants) === 0;
console.log(closed ? "OK: new functions and tables start closed to the API roles." : "FAIL: the API roles get default access.");
process.exit(closed ? 0 : 1);
