-- A new item's place in the manual order is the moment it is written, in seconds with their fraction: it is after every
-- item written before it, so it is last in any group it joins, with no read of the other rows and the same for every
-- writer. The positions given so far (1, 2, 3… per owner) all sit before it. Filling the owner from the node stays a
-- trigger; the position is the column's own default. The rest is the rule of 20261031000000.

alter table public.items alter column position set default extract(epoch from clock_timestamp());

create or replace function public.items_fill_defaults()
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

-- The verification: a new row takes a position after every other one of its owner.
do $$
begin
  if (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.items'::regclass and a.attname = 'position') is null then
    raise exception 'the position has no default';
  end if;
end;
$$;
