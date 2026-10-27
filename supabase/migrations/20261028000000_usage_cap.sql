-- The daily cap on chat messages and transcriptions: one statement takes a unit of the day's allowance, so two
-- requests at once never both pass the last unit. Only the server calls it, before it calls a model.

create function public.take_usage(p_owner uuid, p_kind text, p_day date, p_cap integer)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.usage_counters as u (owner_id, day, kind, count)
  values (p_owner, p_day, p_kind, 1)
  on conflict (owner_id, day, kind) do update set count = u.count + 1
    where u.count < p_cap
  returning u.count;
$$;

comment on function public.take_usage(uuid, text, date, integer) is
  'Takes one unit of the day''s allowance and returns the new count, or no row when the cap is reached.';

revoke execute on function public.take_usage(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.take_usage(uuid, text, date, integer) to service_role;
