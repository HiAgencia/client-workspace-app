-- The demo workspace in one transaction and one round trip: the same tree and items as `demoSeedTree`, planted for the
-- signed-in person only when they have no nodes yet. A test compares the result with the TypeScript tree, so the two
-- cannot drift. The due days count from the person's calendar day, the one the Today screen uses.

create function public.seed_demo(p_today date)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_northwind uuid;
  v_atlas uuid;
  v_website uuid;
  v_ordering uuid;
  v_social uuid;
  v_brand uuid;
begin
  if v_owner is null then
    raise exception 'the demo seed needs a signed-in session' using errcode = '42501';
  end if;
  if exists (select 1 from public.nodes where owner_id = v_owner) then
    return false;
  end if;

  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'client', 'Northwind Bakery', 0)
  returning id into v_northwind;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_northwind, 'project', 'Website', 0)
  returning id into v_website;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_website, 'subproject', 'Ordering flow', 0)
  returning id into v_ordering;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_northwind, 'project', 'Social media', 1)
  returning id into v_social;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'client', 'Studio Atlas', 1)
  returning id into v_atlas;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_atlas, 'project', 'Brand refresh', 0)
  returning id into v_brand;

  insert into public.items (node_id, type, title, body, url, priority, due_on)
  values
    (v_website, 'task', 'Send the homepage draft for review', null, null, 1, p_today),
    (v_website, 'task', 'Collect product photos from the client', null, null, 2, p_today - 1),
    (v_website, 'decision', 'Online orders go through the existing POS', 'Avoids a second inventory.', null, null, null),
    (v_website, 'link', 'Project brief', null, 'https://example.com/northwind/brief', null, null),
    (v_ordering, 'task', 'Map the pickup time slots', null, null, 3, p_today + 2),
    (v_ordering, 'review', 'Client feedback on the checkout mockup', null, 'https://example.com/northwind/checkout', null, null),
    (v_social, 'task', 'Plan the November posts', null, null, 3, p_today + 5),
    (v_brand, 'task', 'Present two logo directions', null, null, 2, p_today),
    (v_brand, 'task', 'Book the photo session', null, null, 3, p_today + 3),
    (v_brand, 'decision', 'Keep the current color palette', 'Printed stock is already ordered.', null, null, null),
    (v_brand, 'review', 'Read the stakeholder survey results', null, null, null, null);

  return true;
end;
$$;

revoke execute on function public.seed_demo(date) from public, anon;
grant execute on function public.seed_demo(date) to authenticated;
