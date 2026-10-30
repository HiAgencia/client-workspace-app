-- Starting a demo over keeps its usage counters. The daily caps are the only brake on what the demo spends on Meta's
-- models, and `reset_demo()` is callable by the demo session itself: if it emptied the counters, a session could refill
-- its own budget, and lower the day of all demo sessions together, as often as it liked. The counters belong to the day
-- and the person, not to the workspace.
create or replace function public.reset_demo()
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
  -- notes and events, the workspace's conversation— is deleted by its owner. The usage counters stay.
  delete from public.review_actions where owner_id = v_owner;
  delete from public.daily_reviews where owner_id = v_owner;
  delete from public.task_mail where owner_id = v_owner;
  delete from public.mail_links where owner_id = v_owner;
  delete from public.mail_opened where owner_id = v_owner;
  delete from public.demo_mail where owner_id = v_owner;
  delete from public.chat_messages where owner_id = v_owner;
  delete from public.preferences where owner_id = v_owner;
  delete from public.items where owner_id = v_owner;
  delete from public.events where owner_id = v_owner;
  delete from public.nodes where owner_id = v_owner;
  delete from public.google_accounts where owner_id = v_owner;
  return true;
end;
$$;

-- The test suite and the browser checks reuse a few demo sessions across a day, so they refill those sessions' caps
-- themselves, through the service role only: no session reaches it, its own included. It touches demo sessions alone.
create function public.reset_demo_usage(p_owner uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.usage_counters c
    where c.owner_id = p_owner
      and exists (select 1 from auth.users u where u.id = p_owner and u.is_anonymous)
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.reset_demo_usage(uuid) from public, anon, authenticated;
grant execute on function public.reset_demo_usage(uuid) to service_role;

-- The verification: the refill is closed to every session role, and the reset stays closed to a visitor without one.
do $$
begin
  if has_function_privilege('anon', 'public.reset_demo_usage(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_usage(uuid)', 'execute') then
    raise exception 'the demo usage refill is open to a session';
  end if;
  if has_function_privilege('anon', 'public.reset_demo()', 'execute') then
    raise exception 'the demo reset is open to anon';
  end if;
end;
$$;
