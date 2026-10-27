-- The demo seed is idempotent per owner: the lock serializes the empty check and the writes for the same person, so two
-- simultaneous calls plant one tree. The rest of the body is the one from 20261028060000.

create or replace function public.seed_demo(p_today date)
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
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
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
