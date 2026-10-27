-- New tables and sequences start with nothing for the API roles. The first migration revoked only read and write,
-- which left TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on every new table and UPDATE on every new sequence.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
