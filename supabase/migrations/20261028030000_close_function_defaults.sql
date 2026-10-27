-- New functions start with no EXECUTE for PUBLIC. The first migration revoked it `in schema public`, which cannot
-- remove a global default, so every function created afterwards was still executable by anon and authenticated
-- unless its own migration revoked it. Each function grants what it serves.
alter default privileges for role postgres revoke execute on functions from public;
