-- The data model: the node tree, what lives in each node, Google accounts and their calendars, coding-agent tokens,
-- the chat, and the daily usage caps. Every table is private to its owner through row-level security, with one
-- policy per command; what only the server may touch (OAuth tokens, token hashes, usage counts) is not granted to
-- the API roles at all.

-- New objects in this schema start with no grants: each table and function below grants exactly what it serves.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

create type public.node_kind as enum ('client', 'project', 'subproject');
create type public.item_type as enum ('task', 'decision', 'link', 'review');
create type public.item_status as enum ('open', 'done');
create type public.item_source as enum ('manual', 'chat', 'agent');
create type public.account_status as enum ('active', 'error', 'revoked');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The tree ----------------------------------------------------------------------------------------------------------

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid,
  kind public.node_kind not null,
  name text not null check (length(btrim(name)) > 0),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A client is always a root, and a root is always a client.
  constraint nodes_root_is_client check ((parent_id is null) = (kind = 'client')),
  -- Lets a child reference its parent together with the owner, so a tree never mixes owners.
  constraint nodes_id_owner_key unique (id, owner_id),
  constraint nodes_parent_same_owner foreign key (parent_id, owner_id)
    references public.nodes (id, owner_id) on delete cascade
);

create index nodes_owner_id_idx on public.nodes (owner_id);
create index nodes_parent_id_owner_id_idx on public.nodes (parent_id, owner_id);
create index nodes_updated_at_idx on public.nodes (updated_at);

create trigger nodes_set_updated_at before update on public.nodes
  for each row execute function public.set_updated_at();

-- The ids of a node and all its descendants, as the caller can see them.
create function public.node_subtree(root uuid)
returns table (id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive subtree as (
    select n.id from public.nodes n where n.id = root
    union all
    select c.id from public.nodes c join subtree s on c.parent_id = s.id
  )
  select subtree.id from subtree;
$$;

-- A child of a client is a project; a child of a project or a subproject is a subproject; a node never moves under
-- its own subtree.
create function public.nodes_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_kind public.node_kind;
begin
  if new.parent_id is null then
    return new;
  end if;

  select p.kind into v_parent_kind from public.nodes p where p.id = new.parent_id;
  if v_parent_kind is null then
    raise exception 'parent node % not found', new.parent_id using errcode = '23503';
  end if;
  if v_parent_kind = 'client' and new.kind <> 'project' then
    raise exception 'a node under a client must be a project' using errcode = '23514';
  end if;
  if v_parent_kind <> 'client' and new.kind <> 'subproject' then
    raise exception 'a node under a project or subproject must be a subproject' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    if exists (select 1 from public.node_subtree(new.id) s where s.id = new.parent_id) then
      raise exception 'a node cannot move under its own subtree' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger nodes_check_parent before insert or update of parent_id, kind on public.nodes
  for each row execute function public.nodes_check_parent();

-- What lives in a node -----------------------------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  type public.item_type not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  url text,
  status public.item_status not null default 'open',
  priority smallint check (priority between 1 and 4),
  due_on date,
  source public.item_source not null default 'manual',
  agent_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  constraint items_priority_only_tasks check (type = 'task' or priority is null),
  constraint items_link_has_url check (type <> 'link' or url is not null),
  constraint items_done_has_completed_at check ((status = 'done') = (completed_at is not null)),
  constraint items_agent_has_label check ((source = 'agent') = (agent_label is not null))
);

create index items_node_id_updated_at_idx on public.items (node_id, updated_at);
create index items_updated_at_idx on public.items (updated_at);

create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- Google accounts and calendars --------------------------------------------------------------------------------------

create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  -- AES-GCM ciphertexts written and read only by the server.
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status public.account_status not null default 'active',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_accounts_owner_email_key unique (owner_id, email)
);

create trigger google_accounts_set_updated_at before update on public.google_accounts
  for each row execute function public.set_updated_at();

create table public.node_accounts (
  node_id uuid not null references public.nodes (id) on delete cascade,
  account_id uuid not null references public.google_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (node_id, account_id)
);

create index node_accounts_account_id_idx on public.node_accounts (account_id);

create table public.account_calendars (
  account_id uuid not null references public.google_accounts (id) on delete cascade,
  calendar_id text not null,
  summary text not null,
  color text,
  selected boolean not null default true,
  primary key (account_id, calendar_id)
);

-- The accounts visible from a node: those attached to it or to any ancestor, each with the nearest node it comes
-- from.
create function public.visible_accounts(node uuid)
returns table (account_id uuid, from_node_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive ancestry as (
    select n.id, n.parent_id, 0 as depth from public.nodes n where n.id = node
    union all
    select p.id, p.parent_id, a.depth + 1 from public.nodes p join ancestry a on p.id = a.parent_id
  )
  select distinct on (na.account_id) na.account_id, na.node_id as from_node_id
  from ancestry a
  join public.node_accounts na on na.node_id = a.id
  order by na.account_id, a.depth;
$$;

-- Coding agents, chat, and caps --------------------------------------------------------------------------------------

create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  token_hash text not null unique,
  label text not null check (length(btrim(label)) > 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index agent_tokens_node_id_idx on public.agent_tokens (node_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  parts jsonb not null,
  created_at timestamptz not null default now()
);

create index chat_messages_node_id_created_at_idx on public.chat_messages (node_id, created_at);

create table public.usage_counters (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('chat_message', 'transcription')),
  count integer not null default 0 check (count >= 0),
  primary key (owner_id, day, kind)
);

-- Row-level security: one policy per command ------------------------------------------------------------------------

alter table public.nodes enable row level security;
alter table public.items enable row level security;
alter table public.google_accounts enable row level security;
alter table public.node_accounts enable row level security;
alter table public.account_calendars enable row level security;
alter table public.agent_tokens enable row level security;
alter table public.chat_messages enable row level security;
alter table public.usage_counters enable row level security;

create policy nodes_select on public.nodes for select to authenticated
  using (owner_id = (select auth.uid()));
create policy nodes_insert on public.nodes for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy nodes_update on public.nodes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy nodes_delete on public.nodes for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy items_select on public.items for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())));
create policy items_insert on public.items for insert to authenticated
  with check (exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())));
create policy items_update on public.items for update to authenticated
  using (exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())));
create policy items_delete on public.items for delete to authenticated
  using (exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())));

create policy google_accounts_select on public.google_accounts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy google_accounts_delete on public.google_accounts for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy node_accounts_select on public.node_accounts for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = node_accounts.node_id and n.owner_id = (select auth.uid())));
create policy node_accounts_insert on public.node_accounts for insert to authenticated
  with check (
    exists (select 1 from public.nodes n where n.id = node_accounts.node_id and n.owner_id = (select auth.uid()))
    and exists (
      select 1 from public.google_accounts g
      where g.id = node_accounts.account_id and g.owner_id = (select auth.uid())
    )
  );
create policy node_accounts_delete on public.node_accounts for delete to authenticated
  using (exists (select 1 from public.nodes n where n.id = node_accounts.node_id and n.owner_id = (select auth.uid())));

create policy account_calendars_select on public.account_calendars for select to authenticated
  using (exists (
    select 1 from public.google_accounts g
    where g.id = account_calendars.account_id and g.owner_id = (select auth.uid())
  ));
create policy account_calendars_update on public.account_calendars for update to authenticated
  using (exists (
    select 1 from public.google_accounts g
    where g.id = account_calendars.account_id and g.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.google_accounts g
    where g.id = account_calendars.account_id and g.owner_id = (select auth.uid())
  ));

create policy agent_tokens_select on public.agent_tokens for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = agent_tokens.node_id and n.owner_id = (select auth.uid())));
create policy agent_tokens_insert on public.agent_tokens for insert to authenticated
  with check (exists (select 1 from public.nodes n where n.id = agent_tokens.node_id and n.owner_id = (select auth.uid())));
create policy agent_tokens_update on public.agent_tokens for update to authenticated
  using (exists (select 1 from public.nodes n where n.id = agent_tokens.node_id and n.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.nodes n where n.id = agent_tokens.node_id and n.owner_id = (select auth.uid())));

create policy chat_messages_select on public.chat_messages for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = chat_messages.node_id and n.owner_id = (select auth.uid())));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (exists (select 1 from public.nodes n where n.id = chat_messages.node_id and n.owner_id = (select auth.uid())));
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (exists (select 1 from public.nodes n where n.id = chat_messages.node_id and n.owner_id = (select auth.uid())));

create policy usage_counters_select on public.usage_counters for select to authenticated
  using (owner_id = (select auth.uid()));

-- Grants: the signed-in role gets only what the screens and the chat use; the server's role gets everything ---------

revoke all on public.nodes, public.items, public.google_accounts, public.node_accounts, public.account_calendars,
  public.agent_tokens, public.chat_messages, public.usage_counters from anon, authenticated, public;

grant select, insert, update, delete on public.nodes to authenticated;
grant select, insert, update, delete on public.items to authenticated;
-- The OAuth tokens never reach the signed-in role: it reads the account's public columns and can disconnect it.
grant select (id, owner_id, email, scopes, status, is_demo, created_at, updated_at) on public.google_accounts
  to authenticated;
grant delete on public.google_accounts to authenticated;
grant select, insert, delete on public.node_accounts to authenticated;
grant select on public.account_calendars to authenticated;
grant update (selected) on public.account_calendars to authenticated;
-- A token's hash is compared only by the server; the owner names and revokes tokens.
grant select (id, node_id, label, created_at, last_used_at, revoked_at) on public.agent_tokens to authenticated;
grant insert (node_id, token_hash, label) on public.agent_tokens to authenticated;
grant update (label, revoked_at) on public.agent_tokens to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
-- Counts are written only by the server, before it calls a model.
grant select on public.usage_counters to authenticated;

grant select, insert, update, delete on public.nodes, public.items, public.google_accounts, public.node_accounts,
  public.account_calendars, public.agent_tokens, public.chat_messages, public.usage_counters to service_role;

revoke execute on function public.set_updated_at(), public.nodes_check_parent(), public.node_subtree(uuid),
  public.visible_accounts(uuid) from public, anon, authenticated;
grant execute on function public.node_subtree(uuid), public.visible_accounts(uuid) to authenticated, service_role;
