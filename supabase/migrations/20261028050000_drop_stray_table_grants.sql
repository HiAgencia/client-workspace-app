-- The tables created before the defaults were closed kept TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for the
-- server's role; it only needs to read and write rows, which the first migration grants.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated, service_role;
