-- A client or a project may carry an icon the person gives it, from the product's closed set of drawings.
-- A node without one shows its nearest ancestor's when it is read. The column is nullable, so a row written
-- before this change stays valid.

set lock_timeout = '2s';

alter table public.nodes
  add column if not exists icon text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nodes_icon_palette' and conrelid = 'public.nodes'::regclass
  ) then
    alter table public.nodes
      add constraint nodes_icon_palette check (
        icon is null or icon in ('client', 'project', 'place', 'task', 'calendar', 'mail', 'note', 'account')
      );
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'nodes' and column_name = 'icon'
  ) then
    raise exception 'the icon column is missing';
  end if;
end;
$$;
