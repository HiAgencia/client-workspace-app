-- A demo session starts over. The tests and the probe browser keep a few anonymous sessions and reuse them, emptying the
-- workspace before each use, because the project's anonymous sign-ups share a rate limit and a run that opened one
-- session per step ran into it. It empties only its own
-- workspace, and only the workspace of a demo: a person's own rows are never reached by it.

create function public.reset_demo()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise exception 'the demo reset needs a signed-in session' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_owner and u.is_anonymous) then
    raise exception 'only a demo session starts over' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  -- What hangs from a node goes with it: its items and their versions, its events, the accounts hung on it, the calendars
  -- and links of those accounts, and the agent tokens of the node. What lives outside a node —General's work, the loose
  -- notes and events, the workspace's conversation— is deleted by its owner.
  delete from public.review_actions where owner_id = v_owner;
  delete from public.daily_reviews where owner_id = v_owner;
  delete from public.task_mail where owner_id = v_owner;
  delete from public.mail_links where owner_id = v_owner;
  delete from public.mail_opened where owner_id = v_owner;
  delete from public.demo_mail where owner_id = v_owner;
  delete from public.chat_messages where owner_id = v_owner;
  delete from public.preferences where owner_id = v_owner;
  delete from public.usage_counters where owner_id = v_owner;
  delete from public.items where owner_id = v_owner;
  delete from public.events where owner_id = v_owner;
  delete from public.nodes where owner_id = v_owner;
  delete from public.google_accounts where owner_id = v_owner;
  return true;
end;
$$;

revoke execute on function public.reset_demo() from public, anon;
grant execute on function public.reset_demo() to authenticated;

-- The verification: the reset is not open to a visitor without a session. Its effect —a demo's workspace reads back empty,
-- and one that is not a demo's is refused— is measured by the suite (`tests/demo/seed.test.ts`).
do $$
begin
  if has_function_privilege('anon', 'public.reset_demo()', 'execute') then
    raise exception 'the demo reset is open to anon';
  end if;
end;
$$;
