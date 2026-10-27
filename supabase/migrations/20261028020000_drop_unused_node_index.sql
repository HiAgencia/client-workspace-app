-- No query filters or orders nodes by `updated_at` (what is new reads items by `updated_at` and nodes by
-- `created_at`), and the database's advisor measured the index as never used: it only cost every write.
drop index if exists public.nodes_updated_at_idx;
