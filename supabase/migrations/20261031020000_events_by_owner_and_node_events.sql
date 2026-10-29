-- An event of the workspace's own belongs to its person and may live in no node (one created from a general task), and a
-- client or a project links to events —its own or a connected Google account's— as a task does. The policies that read
-- an item's or an event's owner through its node read the row's own owner now.

alter table public.events
  add column owner_id uuid default auth.uid() references auth.users (id) on delete cascade;

-- Filling the owner is the schema's change: it moves neither `updated_at` nor any version.
alter table public.events disable trigger events_set_updated_at;
update public.events e set owner_id = n.owner_id from public.nodes n where n.id = e.node_id;
alter table public.events enable trigger events_set_updated_at;

alter table public.events
  alter column owner_id set not null,
  alter column node_id drop not null,
  drop constraint events_node_id_fkey,
  add constraint events_node_same_owner foreign key (node_id, owner_id) references public.nodes (id, owner_id) on delete cascade;

create index events_owner_id_node_id_idx on public.events (owner_id, node_id);

-- A writer with the server's key has no signed-in person: the node it writes into gives the owner.
create function public.events_fill_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is null and new.node_id is not null then
    select n.owner_id into new.owner_id from public.nodes n where n.id = new.node_id;
  end if;
  return new;
end;
$$;

create trigger events_fill_owner before insert on public.events
  for each row execute function public.events_fill_owner();

drop policy events_select on public.events;
drop policy events_insert on public.events;
drop policy events_update on public.events;
drop policy events_delete on public.events;

create policy events_select on public.events for select to authenticated
  using (owner_id = (select auth.uid()));
create policy events_insert on public.events for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (node_id is null or exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())))
  );
create policy events_update on public.events for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (node_id is null or exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())))
  );
create policy events_delete on public.events for delete to authenticated
  using (owner_id = (select auth.uid()));

-- A task inside an event: its own task, and its own event or account, whether or not either has a node.
drop policy item_events_select on public.item_events;
drop policy item_events_insert on public.item_events;
drop policy item_events_update on public.item_events;
drop policy item_events_delete on public.item_events;

create policy item_events_select on public.item_events for select to authenticated
  using (exists (select 1 from public.items i where i.id = item_events.item_id and i.owner_id = (select auth.uid())));
create policy item_events_insert on public.item_events for insert to authenticated
  with check (
    exists (select 1 from public.items i where i.id = item_events.item_id and i.type = 'task' and i.owner_id = (select auth.uid()))
    and (
      (item_events.event_id is not null and exists (
        select 1 from public.events e where e.id = item_events.event_id and e.owner_id = (select auth.uid())
      ))
      or (item_events.account_id is not null and exists (
        select 1 from public.google_accounts g where g.id = item_events.account_id and g.owner_id = (select auth.uid())
      ))
    )
  );
create policy item_events_update on public.item_events for update to authenticated
  using (exists (select 1 from public.items i where i.id = item_events.item_id and i.owner_id = (select auth.uid())))
  with check (
    exists (select 1 from public.items i where i.id = item_events.item_id and i.type = 'task' and i.owner_id = (select auth.uid()))
    and (
      (item_events.event_id is not null and exists (
        select 1 from public.events e where e.id = item_events.event_id and e.owner_id = (select auth.uid())
      ))
      or (item_events.account_id is not null and exists (
        select 1 from public.google_accounts g where g.id = item_events.account_id and g.owner_id = (select auth.uid())
      ))
    )
  );
create policy item_events_delete on public.item_events for delete to authenticated
  using (exists (select 1 from public.items i where i.id = item_events.item_id and i.owner_id = (select auth.uid())));

drop policy revisions_select on public.revisions;
create policy revisions_select on public.revisions for select to authenticated
  using (
    exists (select 1 from public.items i where i.id = revisions.item_id and i.owner_id = (select auth.uid()))
    or exists (select 1 from public.events e where e.id = revisions.event_id and e.owner_id = (select auth.uid()))
  );

-- A client or a project linked to an event: the workspace's own (event_id), or a connected Google account's (account_id,
-- calendar_id, google_event_id). A node links to many events and an event to many nodes, each pair once.
create table public.node_events (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  account_id uuid references public.google_accounts (id) on delete cascade,
  calendar_id text,
  google_event_id text,
  created_at timestamptz not null default now(),
  constraint node_events_one_event check (
    (event_id is not null and account_id is null and calendar_id is null and google_event_id is null)
    or (event_id is null and account_id is not null and calendar_id is not null and google_event_id is not null)
  )
);

create index node_events_node_id_idx on public.node_events (node_id);
create index node_events_event_id_idx on public.node_events (event_id);
create index node_events_account_id_idx on public.node_events (account_id);
create unique index node_events_own_key on public.node_events (node_id, event_id) where event_id is not null;
create unique index node_events_google_key on public.node_events (node_id, account_id, calendar_id, google_event_id)
  where account_id is not null;

alter table public.node_events enable row level security;

create policy node_events_select on public.node_events for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = node_events.node_id and n.owner_id = (select auth.uid())));
create policy node_events_insert on public.node_events for insert to authenticated
  with check (
    exists (select 1 from public.nodes n where n.id = node_events.node_id and n.owner_id = (select auth.uid()))
    and (
      (node_events.event_id is not null and exists (
        select 1 from public.events e where e.id = node_events.event_id and e.owner_id = (select auth.uid())
      ))
      or (node_events.account_id is not null and exists (
        select 1 from public.google_accounts g where g.id = node_events.account_id and g.owner_id = (select auth.uid())
      ))
    )
  );
create policy node_events_delete on public.node_events for delete to authenticated
  using (exists (select 1 from public.nodes n where n.id = node_events.node_id and n.owner_id = (select auth.uid())));

revoke all on public.node_events from anon, authenticated, public;
grant select, insert, delete on public.node_events to authenticated, service_role;

revoke execute on function public.events_fill_owner() from public, anon, authenticated;

-- The verification: every event has its owner, and a node's events are its owner's.
do $$
begin
  if exists (select 1 from public.events where owner_id is null) then
    raise exception 'an event was left without its owner';
  end if;
  if exists (select 1 from public.events e join public.nodes n on n.id = e.node_id where n.owner_id <> e.owner_id) then
    raise exception 'an event belongs to someone other than its node''s owner';
  end if;
end;
$$;
