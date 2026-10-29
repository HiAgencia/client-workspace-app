-- The daily review's heartbeat: a run under way writes it as it walks its tasks, and the next call decides with it. A run
-- whose last beat is older than the floor is taken as cut —a worker that died— and resumed; one that keeps beating is
-- another call's, however long its attempt has been going. `attempt_started_at` stays as when the attempt began.

alter table public.daily_reviews add column heartbeat_at timestamptz;
-- A run under way when this lands keeps the clock it had; a finished one has none.
update public.daily_reviews set heartbeat_at = attempt_started_at where finished_at is null;

grant update (heartbeat_at) on public.daily_reviews to authenticated;

do $$
begin
  if not has_column_privilege('authenticated', 'public.daily_reviews', 'heartbeat_at', 'update') then
    raise exception 'the review''s heartbeat is not writable by the call that runs it';
  end if;
  if has_column_privilege('authenticated', 'public.daily_reviews', 'created_at', 'update') then
    raise exception 'the review''s columns a person may change are wider than expected';
  end if;
end;
$$;
