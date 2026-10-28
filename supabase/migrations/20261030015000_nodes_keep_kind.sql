-- A node keeps the kind it was created with. A root may be a client or a project, and the parent check returns early for
-- a root, so flipping a root project with subprojects to a client would leave subprojects under a client; the app never
-- changes a kind, and the database refuses it before anything else. The rest is the rule of 20261027000238.
create or replace function public.nodes_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_kind public.node_kind;
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'a node keeps its kind: % cannot become %', old.kind, new.kind using errcode = '23514';
  end if;

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

revoke execute on function public.nodes_check_parent() from public, anon, authenticated;
