-- The demo seed carries what the product does: notes, a task with its subtasks, a note and a link, links of a project,
-- events of the workspace's own, an undated task, and an item that already left a version. Bodies are the closed list's
-- HTML. Still one call, idempotent per owner behind a lock; `src/lib/demo-seed.ts` holds the same tree and a test
-- compares both.

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
  v_homepage uuid;
  v_logos uuid;
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

  -- A task with what hangs from it: two subtasks, a note, and a link.
  insert into public.items (node_id, type, title, body, priority, due_on)
  values (v_website, 'task', 'Send the homepage draft for review', '<p>Use the <strong>approved</strong> photos only.</p>', 1, p_today)
  returning id into v_homepage;
  insert into public.items (node_id, parent_item_id, type, title, body, url, priority, due_on)
  values
    (v_website, v_homepage, 'task', 'Write the hero copy', null, null, 2, p_today),
    (v_website, v_homepage, 'task', 'Pick the three featured products', null, null, 3, null),
    (v_website, v_homepage, 'note', 'The client prefers a warm, plain tone.', '<p>The client prefers a warm, plain tone.</p>', null, null, null),
    (v_website, v_homepage, 'link', 'Homepage draft', null, 'https://example.com/northwind/homepage-draft', null, null);

  insert into public.items (node_id, type, title, body, url, priority, due_on)
  values
    (v_website, 'task', 'Collect product photos from the client', null, null, 2, p_today - 1),
    (v_website, 'decision', 'Online orders go through the existing POS', '<p>Avoids a <strong>second inventory</strong>.</p>', null, null, null),
    (v_website, 'link', 'Project brief', null, 'https://example.com/northwind/brief', null, null),
    (v_website, 'note', 'Kickoff notes', '<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>', null, null, null),
    (v_ordering, 'task', 'Map the pickup time slots', null, null, 3, p_today + 2),
    (v_ordering, 'review', 'Client feedback on the checkout mockup', null, 'https://example.com/northwind/checkout', null, null),
    (v_social, 'task', 'Plan the November posts', null, null, 3, p_today + 5),
    (v_social, 'task', 'Draft a posting guide', null, null, 4, null),
    (v_brand, 'task', 'Send the moodboard', null, null, 2, p_today),
    (v_brand, 'task', 'Book the photo session', null, null, 3, p_today + 3),
    (v_brand, 'decision', 'Keep the current color palette', '<p>Printed stock is already ordered.</p>', null, null, null),
    (v_brand, 'review', 'Read the stakeholder survey results', null, null, null, null);

  -- An item that already changed: its first title is a version the panel can restore.
  insert into public.items (node_id, type, title, priority, due_on)
  values (v_brand, 'task', 'Present logo directions', 2, p_today)
  returning id into v_logos;
  update public.items set title = 'Present two logo directions' where id = v_logos;

  -- Events of the workspace's own, whole days around today.
  insert into public.events (node_id, title, all_day, starts_on, ends_on)
  values
    (v_website, 'Homepage review with the client', true, p_today + 1, p_today + 1),
    (v_brand, 'Photo session', true, p_today + 3, p_today + 3);

  return true;
end;
$$;
