-- Each attempt of a daily review marks its start, so a run without an end is told apart: one whose attempt is under way
-- belongs to the call running it, and one whose mark was cleared by a stop, or aged, is resumed by the next call. The
-- failures no longer say it. And the reorder that took positions from the client, replaced by
-- `public.reorder_item_positions`, leaves the schema.

alter table public.daily_reviews add column attempt_started_at timestamptz default now();
-- A run already finished has no attempt under way; one without an end, if any, is taken as cut.
update public.daily_reviews set attempt_started_at = null;

revoke update on public.daily_reviews from authenticated;
grant update (finished_at, failures, attempt_started_at) on public.daily_reviews to authenticated;

drop function public.set_item_positions(uuid[], numeric[]);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_item_positions') then
    raise exception 'set_item_positions is still in the schema';
  end if;
  if not has_column_privilege('authenticated', 'public.daily_reviews', 'attempt_started_at', 'update')
    or has_column_privilege('authenticated', 'public.daily_reviews', 'day', 'update') then
    raise exception 'the review''s columns a person may change are not the expected ones';
  end if;
end;
$$;
