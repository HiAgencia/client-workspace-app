-- Every item belongs to its person, and a task or a note may live in no node at all: a general task, a loose note.
-- Items keep a manual order (`position`) and a task may carry the hour of its due day (`due_time`). The tree of items
-- keeps its rule —a parent is a live task of the same place, a node or none—, checked once the whole statement is done so
-- a branch moves in one write. Row-level security reads the item's own owner.

alter table public.items
  -- The signed-in person by default; a writer with the server's key names it, or the node it writes into gives it.
  add column owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  -- The manual order: a new item enters after every other item of its owner, so it is last in any group it joins.
  add column position numeric,
  -- The hour of the due day, on the person's own clock; only with a due day.
  add column due_time time;

-- The rows written so far belong to their node's owner and keep the order they were written in. Filling the new columns
-- is the schema's, not a person's change: it moves neither `updated_at` (what is new reads it) nor any version.
alter table public.items disable trigger items_set_updated_at;
update public.items i set owner_id = n.owner_id from public.nodes n where n.id = i.node_id;
update public.items i
set position = ranked.rank
from (select r.id, row_number() over (partition by r.owner_id order by r.created_at, r.id) as rank from public.items r) ranked
where ranked.id = i.id;
alter table public.items enable trigger items_set_updated_at;

alter table public.items
  alter column owner_id set not null,
  alter column position set not null,
  alter column node_id drop not null,
  -- A node's items are its owner's: the node and the owner are referenced together, so a row never mixes owners.
  drop constraint items_node_id_fkey,
  add constraint items_node_same_owner foreign key (node_id, owner_id) references public.nodes (id, owner_id) on delete cascade,
  add constraint items_time_needs_day check (due_time is null or due_on is not null);

create index items_owner_id_node_id_idx on public.items (owner_id, node_id);
create index items_owner_id_position_idx on public.items (owner_id, position);

-- What a writer leaves out: the owner of the node it writes into (the server's key has no signed-in person), and the
-- next place in the owner's manual order. Rows of one statement see the rows before them, so a seed keeps its order.
create function public.items_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is null and new.node_id is not null then
    select n.owner_id into new.owner_id from public.nodes n where n.id = new.node_id;
  end if;
  if new.position is null then
    select coalesce(max(i.position), 0) + 1 into new.position from public.items i where i.owner_id = new.owner_id;
  end if;
  return new;
end;
$$;

create trigger items_fill_defaults before insert on public.items
  for each row execute function public.items_fill_defaults();

-- Ordering by hand is not a change of the item: what is new and the activity read `updated_at`, and a reorder moves only
-- `position`.
create function public.items_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'position' - 'updated_at') = (to_jsonb(old) - 'position' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items
  for each row execute function public.items_touch();

-- Before the write: the parent is a live task (a deleted row may stay under a deleted one), there is no cycle, and only a
-- task keeps children. Where the parent lives is checked after the statement (`items_check_place`). The rest is the rule
-- of 20261029010000.
create or replace function public.items_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_type public.item_type;
  v_parent_deleted timestamptz;
begin
  if tg_op = 'UPDATE' and new.type <> 'task' and exists (select 1 from public.items c where c.parent_item_id = new.id) then
    raise exception 'only a task keeps children' using errcode = '23514';
  end if;

  if new.parent_item_id is null then
    return new;
  end if;

  select p.type, p.deleted_at into v_parent_type, v_parent_deleted from public.items p where p.id = new.parent_item_id;
  if not found then
    raise exception 'parent item % not found', new.parent_item_id using errcode = '23503';
  end if;
  if v_parent_type <> 'task' then
    raise exception 'only a task can have children' using errcode = '23514';
  end if;
  if v_parent_deleted is not null and new.deleted_at is null then
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

-- After the statement: an item lives where its parent task lives —the same node, or none— and with the same owner, and a
-- task's children live where it lives. Row triggers after the write run once the whole statement is done, so a branch
-- that moves in one update is read moved.
create function public.items_check_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_item_id is not null and not exists (
    select 1 from public.items p
    where p.id = new.parent_item_id and p.owner_id = new.owner_id and p.node_id is not distinct from new.node_id
  ) then
    raise exception 'an item lives where its parent task lives' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.items c
    where c.parent_item_id = new.id and (c.node_id is distinct from new.node_id or c.owner_id <> new.owner_id)
  ) then
    raise exception 'a task''s subtasks and notes live where it lives' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger items_check_place after insert or update of parent_item_id, node_id, owner_id on public.items
  for each row execute function public.items_check_place();

-- The hour joins the versioned columns. The rest is the rule of 20261029010000.
create or replace function public.items_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.body, old.url, old.status, old.priority, old.due_on, old.due_time, old.parent_item_id, old.deleted_at)
     is not distinct from
     (new.title, new.body, new.url, new.status, new.priority, new.due_on, new.due_time, new.parent_item_id, new.deleted_at) then
    return null;
  end if;
  insert into public.revisions (item_id, snapshot, source, agent_label)
  values (
    old.id,
    jsonb_build_object(
      'title', old.title, 'body', old.body, 'url', old.url, 'status', old.status, 'priority', old.priority,
      'due_on', old.due_on, 'due_time', old.due_time, 'parent_item_id', old.parent_item_id, 'deleted_at', old.deleted_at,
      'completed_at', old.completed_at
    ),
    new.changed_source,
    new.changed_agent_label
  );
  return null;
end;
$$;

-- Moving an item and its branch: the item takes its new place and parent, and everything below it the same place, in one
-- statement, so the tree is never read half moved. A deleted descendant moves too, so restoring it later finds it where
-- its parent lives. With the caller's rights.
create function public.move_item_branch(
  p_item uuid,
  p_node uuid,
  p_parent uuid,
  p_source public.item_source,
  p_agent_label text
)
returns setof public.items
language sql
security invoker
set search_path = ''
as $$
  with recursive branch as (
    select i.id from public.items i where i.id = p_item and i.deleted_at is null
    union all
    select c.id from public.items c join branch b on c.parent_item_id = b.id
  )
  update public.items i
  set node_id = p_node,
      parent_item_id = case when i.id = p_item then p_parent else i.parent_item_id end,
      changed_source = p_source,
      changed_agent_label = p_agent_label
  where i.id in (select branch.id from branch)
  returning i.*;
$$;

-- The manual order of a group, written in one statement: each live item takes the position it is given.
create function public.set_item_positions(p_items uuid[], p_positions numeric[])
returns setof public.items
language sql
security invoker
set search_path = ''
as $$
  update public.items i
  set position = wanted.position
  from unnest(p_items, p_positions) as wanted (id, position)
  where i.id = wanted.id and i.deleted_at is null
  returning i.*;
$$;

-- Row-level security reads the item's owner; a write into a node also needs that node to be the person's own, so a write
-- into another person's node is refused by the policy (42501) before the foreign key sees it.
drop policy items_select on public.items;
drop policy items_insert on public.items;
drop policy items_update on public.items;
drop policy items_delete on public.items;

create policy items_select on public.items for select to authenticated
  using (owner_id = (select auth.uid()));
create policy items_insert on public.items for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (node_id is null or exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())))
  );
create policy items_update on public.items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (node_id is null or exists (select 1 from public.nodes n where n.id = items.node_id and n.owner_id = (select auth.uid())))
  );
create policy items_delete on public.items for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke execute on function public.items_fill_defaults(), public.items_touch(), public.items_check_place(),
  public.move_item_branch(uuid, uuid, uuid, public.item_source, text), public.set_item_positions(uuid[], numeric[])
  from public, anon, authenticated;
grant execute on function public.move_item_branch(uuid, uuid, uuid, public.item_source, text),
  public.set_item_positions(uuid[], numeric[]) to authenticated, service_role;

-- The verification: every row has its owner and its place in the order, a node's items are its owner's, and no two
-- items of one owner share a place.
do $$
begin
  if exists (select 1 from public.items where owner_id is null or position is null) then
    raise exception 'an item was left without its owner or its position';
  end if;
  if exists (select 1 from public.items i join public.nodes n on n.id = i.node_id where n.owner_id <> i.owner_id) then
    raise exception 'an item belongs to someone other than its node''s owner';
  end if;
  if exists (select 1 from public.items group by owner_id, position having count(*) > 1) then
    raise exception 'two items of one owner share a position';
  end if;
end;
$$;
