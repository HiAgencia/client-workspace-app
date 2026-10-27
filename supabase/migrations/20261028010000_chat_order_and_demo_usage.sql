-- The chat reads a node's conversation in the order it was written: a person's message and the answer are stored in
-- one statement with the same timestamp, so their order comes from an identity column, not from `created_at`.
alter table public.chat_messages add column seq bigint generated always as identity;
create index chat_messages_node_id_seq_idx on public.chat_messages (node_id, seq);

-- The demo's daily allowance is shared by every anonymous session: a new demo session does not bring a new budget.
-- It sums the day's counters of anonymous users; only the server calls it, before it takes a unit.
create function public.anonymous_usage(p_kind text, p_day date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.count), 0)
  from public.usage_counters u
  join auth.users a on a.id = u.owner_id
  where u.kind = p_kind and u.day = p_day and a.is_anonymous;
$$;

comment on function public.anonymous_usage(text, date) is
  'The day''s units of one kind taken by all anonymous (demo) sessions together.';

revoke execute on function public.anonymous_usage(text, date) from public, anon, authenticated;
grant execute on function public.anonymous_usage(text, date) to service_role;
