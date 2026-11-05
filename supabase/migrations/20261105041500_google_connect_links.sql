-- A link that connects a Google account from another browser or profile: the signed-in person creates it for one
-- node, whoever opens it authorizes a Google account there, and the person accepts it in the session that created
-- it before any account becomes active. Only its hash is kept, and the authorized tokens wait encrypted until
-- acceptance; every terminal state clears them. Only the server reads or writes this table.

create table public.google_connect_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  node_id uuid not null references public.nodes (id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'authorized', 'accepted', 'rejected', 'cancelled')),
  email text,
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  authorized_at timestamptz
);

create index google_connect_links_owner_status on public.google_connect_links (owner_id, status);

alter table public.google_connect_links enable row level security;
revoke all on table public.google_connect_links from public, anon, authenticated;
grant select, insert, update, delete on public.google_connect_links to service_role;
