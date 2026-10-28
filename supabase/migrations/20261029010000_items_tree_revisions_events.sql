-- The model of stage 3: notes and subtasks hang from a task, bodies are rich text, a branch is deleted and restored
-- whole, every change leaves its previous version, the workspace keeps events of its own, a task can live inside an
-- event, and a person saves the views they use. Each new table carries row-level security per command and its explicit
-- grants; the schema's defaults give the API roles nothing.

-- Items: a parent task, and who made the last change ------------------------------------------------------------------

alter table public.items
  add column parent_item_id uuid references public.items (id) on delete cascade,
  add column changed_source public.item_source,
  add column changed_agent_label text;

-- The rows written before this migration were last changed by whoever created them. The conversion of the bodies below
-- is the schema's, not a person's change: it moves neither `updated_at` (what is new reads it) nor any version.
alter table public.items disable trigger items_set_updated_at;
update public.items set changed_source = source, changed_agent_label = agent_label;

-- A body is HTML from a closed list; the plain text written so far becomes escaped paragraphs, one per line.
update public.items
set body = '<p>' || regexp_replace(
  replace(replace(replace(replace(body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'),
  E'\r?\n', '</p><p>', 'g') || '</p>'
where body is not null and btrim(body) <> '' and body !~ '^<(p|ul|ol)>';
update public.items set body = null where body is not null and btrim(body) = '';
alter table public.items enable trigger items_set_updated_at;

alter table public.items
  alter column changed_source set default 'manual',
  alter column changed_source set not null,
  add constraint items_changed_agent_has_label check ((changed_source = 'agent') = (changed_agent_label is not null)),
  -- A note is text: no status, priority, or date.
  add constraint items_note_is_text check (type <> 'note' or (priority is null and due_on is null and status = 'open')),
  -- A due date belongs to tasks only.
  add constraint items_due_only_tasks check (type = 'task' or due_on is null);

create index items_parent_item_id_idx on public.items (parent_item_id);

-- The parent is a live task of the same node; a branch has no cycle; only a task keeps children.
create function public.items_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_node uuid;
  v_parent_type public.item_type;
  v_parent_deleted timestamptz;
begin
  if tg_op = 'UPDATE' and exists (select 1 from public.items c where c.parent_item_id = new.id) then
    if new.type <> 'task' then
      raise exception 'only a task keeps children' using errcode = '23514';
    end if;
    if new.node_id <> old.node_id then
      raise exception 'a task with children cannot move to another node' using errcode = '23514';
    end if;
  end if;

  if new.parent_item_id is null then
    return new;
  end if;

  select p.node_id, p.type, p.deleted_at into v_parent_node, v_parent_type, v_parent_deleted
  from public.items p where p.id = new.parent_item_id;
  if v_parent_node is null then
    raise exception 'parent item % not found', new.parent_item_id using errcode = '23503';
  end if;
  if v_parent_node <> new.node_id then
    raise exception 'the parent item lives in another node' using errcode = '23514';
  end if;
  if v_parent_type <> 'task' then
    raise exception 'only a task can have children' using errcode = '23514';
  end if;
  if v_parent_deleted is not null then
    raise exception 'the parent item was deleted' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.parent_item_id is distinct from old.parent_item_id then
    if exists (
      with recursive up as (
        select p.id, p.parent_item_id from public.items p where p.id = new.parent_item_id
        union all
        select p.id, p.parent_item_id from public.items p join up on p.id = up.parent_item_id
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'an item cannot move under its own branch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger items_check_parent before insert or update of parent_item_id, node_id, type on public.items
  for each row execute function public.items_check_parent();

-- A branch: the item and every descendant are deleted with the SAME moment, so restoring brings back exactly that
-- branch and not what was deleted before on its own. One statement each, with the caller's rights.
create function public.delete_item_branch(p_item uuid, p_source public.item_source, p_agent_label text)
returns setof public.items
language sql
security invoker
set search_path = ''
as $$
  with recursive branch as (
    select i.id from public.items i where i.id = p_item and i.deleted_at is null
    union all
    select c.id from public.items c join branch b on c.parent_item_id = b.id where c.deleted_at is null
  )
  update public.items i
  set deleted_at = now(), changed_source = p_source, changed_agent_label = p_agent_label
  where i.id in (select branch.id from branch)
  returning i.*;
$$;

create function public.restore_item_branch(p_item uuid, p_source public.item_source, p_agent_label text)
returns setof public.items
language sql
security invoker
set search_path = ''
as $$
  with recursive target as (
    select i.deleted_at as stamp from public.items i where i.id = p_item
  ), branch as (
    select i.id from public.items i where i.id = p_item
    union all
    select c.id from public.items c join branch b on c.parent_item_id = b.id
  )
  update public.items i
  set deleted_at = null, changed_source = p_source, changed_agent_label = p_agent_label
  from target
  where i.id in (select branch.id from branch) and i.deleted_at = target.stamp
  returning i.*;
$$;

-- Events of the workspace's own -------------------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  body text,
  all_day boolean not null default false,
  -- A whole-day event spans calendar days (the last one included); a timed one spans two instants.
  starts_on date,
  ends_on date,
  starts_at timestamptz,
  ends_at timestamptz,
  source public.item_source not null default 'manual',
  agent_label text,
  changed_source public.item_source not null default 'manual',
  changed_agent_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_when check (
    (all_day and starts_on is not null and ends_on is not null and ends_on >= starts_on
      and starts_at is null and ends_at is null)
    or (not all_day and starts_at is not null and ends_at is not null and ends_at >= starts_at
      and starts_on is null and ends_on is null)
  ),
  constraint events_agent_has_label check ((source = 'agent') = (agent_label is not null)),
  constraint events_changed_agent_has_label check ((changed_source = 'agent') = (changed_agent_label is not null))
);

create index events_node_id_idx on public.events (node_id);
create index events_updated_at_idx on public.events (updated_at);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- A task inside an event: one event per task, either the workspace's own or one of a connected Google account.
create table public.item_events (
  item_id uuid primary key references public.items (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  account_id uuid references public.google_accounts (id) on delete cascade,
  calendar_id text,
  google_event_id text,
  created_at timestamptz not null default now(),
  constraint item_events_one_event check (
    (event_id is not null and account_id is null and calendar_id is null and google_event_id is null)
    or (event_id is null and account_id is not null and calendar_id is not null and google_event_id is not null)
  )
);

create index item_events_event_id_idx on public.item_events (event_id);
create index item_events_account_id_idx on public.item_events (account_id);

-- Versions ----------------------------------------------------------------------------------------------------------

create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  -- The versioned columns as they were before the change.
  snapshot jsonb not null,
  -- Who made the change that left this version.
  source public.item_source not null,
  agent_label text,
  created_at timestamptz not null default now(),
  constraint revisions_one_target check ((item_id is null) <> (event_id is null))
);

create index revisions_item_id_created_at_idx on public.revisions (item_id, created_at);
create index revisions_event_id_created_at_idx on public.revisions (event_id, created_at);

-- Written by the database on every change of a versioned column, so no writer skips it; the signed-in role only reads.
create function public.items_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.body, old.url, old.status, old.priority, old.due_on, old.parent_item_id, old.deleted_at)
     is not distinct from
     (new.title, new.body, new.url, new.status, new.priority, new.due_on, new.parent_item_id, new.deleted_at) then
    return null;
  end if;
  insert into public.revisions (item_id, snapshot, source, agent_label)
  values (
    old.id,
    jsonb_build_object(
      'title', old.title, 'body', old.body, 'url', old.url, 'status', old.status, 'priority', old.priority,
      'due_on', old.due_on, 'parent_item_id', old.parent_item_id, 'deleted_at', old.deleted_at,
      'completed_at', old.completed_at
    ),
    new.changed_source,
    new.changed_agent_label
  );
  return null;
end;
$$;

create trigger items_record_revision after update on public.items
  for each row execute function public.items_record_revision();

create function public.events_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.body, old.all_day, old.starts_on, old.ends_on, old.starts_at, old.ends_at, old.deleted_at)
     is not distinct from
     (new.title, new.body, new.all_day, new.starts_on, new.ends_on, new.starts_at, new.ends_at, new.deleted_at) then
    return null;
  end if;
  insert into public.revisions (event_id, snapshot, source, agent_label)
  values (
    old.id,
    jsonb_build_object(
      'title', old.title, 'body', old.body, 'all_day', old.all_day, 'starts_on', old.starts_on,
      'ends_on', old.ends_on, 'starts_at', old.starts_at, 'ends_at', old.ends_at, 'deleted_at', old.deleted_at
    ),
    new.changed_source,
    new.changed_agent_label
  );
  return null;
end;
$$;

create trigger events_record_revision after update on public.events
  for each row execute function public.events_record_revision();

-- Saved views -------------------------------------------------------------------------------------------------------

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- The view's URL parameters, as the screen writes them.
  query text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint saved_views_owner_name_key unique (owner_id, name)
);

-- Row-level security: one policy per command -------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.item_events enable row level security;
alter table public.revisions enable row level security;
alter table public.saved_views enable row level security;

create policy events_select on public.events for select to authenticated
  using (exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())));
create policy events_insert on public.events for insert to authenticated
  with check (exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())));
create policy events_update on public.events for update to authenticated
  using (exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())));
create policy events_delete on public.events for delete to authenticated
  using (exists (select 1 from public.nodes n where n.id = events.node_id and n.owner_id = (select auth.uid())));

create policy item_events_select on public.item_events for select to authenticated
  using (exists (
    select 1 from public.items i join public.nodes n on n.id = i.node_id
    where i.id = item_events.item_id and n.owner_id = (select auth.uid())
  ));
create policy item_events_insert on public.item_events for insert to authenticated
  with check (
    exists (
      select 1 from public.items i join public.nodes n on n.id = i.node_id
      where i.id = item_events.item_id and i.type = 'task' and n.owner_id = (select auth.uid())
    )
    and (
      (item_events.event_id is not null and exists (
        select 1 from public.events e join public.nodes n on n.id = e.node_id
        where e.id = item_events.event_id and n.owner_id = (select auth.uid())
      ))
      or (item_events.account_id is not null and exists (
        select 1 from public.google_accounts g
        where g.id = item_events.account_id and g.owner_id = (select auth.uid())
      ))
    )
  );
create policy item_events_delete on public.item_events for delete to authenticated
  using (exists (
    select 1 from public.items i join public.nodes n on n.id = i.node_id
    where i.id = item_events.item_id and n.owner_id = (select auth.uid())
  ));

create policy revisions_select on public.revisions for select to authenticated
  using (
    exists (
      select 1 from public.items i join public.nodes n on n.id = i.node_id
      where i.id = revisions.item_id and n.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.events e join public.nodes n on n.id = e.node_id
      where e.id = revisions.event_id and n.owner_id = (select auth.uid())
    )
  );

create policy saved_views_select on public.saved_views for select to authenticated
  using (owner_id = (select auth.uid()));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy saved_views_update on public.saved_views for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Grants ------------------------------------------------------------------------------------------------------------

revoke all on public.events, public.item_events, public.revisions, public.saved_views from anon, authenticated, public;

grant select, insert, update, delete on public.events to authenticated, service_role;
grant select, insert, delete on public.item_events to authenticated, service_role;
-- Versions are written only by their triggers.
grant select on public.revisions to authenticated, service_role;
grant select, insert, update, delete on public.saved_views to authenticated, service_role;

revoke execute on function public.items_check_parent(), public.items_record_revision(), public.events_record_revision(),
  public.delete_item_branch(uuid, public.item_source, text), public.restore_item_branch(uuid, public.item_source, text)
  from public, anon, authenticated;
grant execute on function public.delete_item_branch(uuid, public.item_source, text),
  public.restore_item_branch(uuid, public.item_source, text) to authenticated, service_role;
