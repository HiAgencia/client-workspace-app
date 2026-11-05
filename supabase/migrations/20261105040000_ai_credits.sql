-- The AI's credits. The model API has no balance to read, so the server keeps its own: one running total of what the
-- server's key spent, in millionths of a dollar, each step's cost added as it ends. Past the server's cap that key is not
-- used again, and a person goes on with their own key, kept encrypted. Only the server reads or writes either table.

create table public.ai_spend (
  id boolean primary key default true check (id),
  micro_usd bigint not null default 0 check (micro_usd >= 0),
  updated_at timestamptz not null default now()
);

insert into public.ai_spend (id) values (true);

alter table public.ai_spend enable row level security;
revoke all on table public.ai_spend from public, anon, authenticated;
grant select, update on public.ai_spend to service_role;

create function public.add_ai_spend(p_micro_usd bigint)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.ai_spend
     set micro_usd = micro_usd + greatest(p_micro_usd, 0), updated_at = now()
   where id
  returning micro_usd;
$$;

comment on function public.add_ai_spend(bigint) is
  'Adds a step''s cost to what the server''s key spent and returns the new total, in millionths of a dollar.';

revoke execute on function public.add_ai_spend(bigint) from public, anon, authenticated;
grant execute on function public.add_ai_spend(bigint) to service_role;

create table public.ai_keys (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  ciphertext text not null,
  hint text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_keys enable row level security;
revoke all on table public.ai_keys from public, anon, authenticated;
grant select, insert, update, delete on public.ai_keys to service_role;
