-- The demo is a small agency's workspace: three clients with their projects, and projects of its own at the root beside
-- them, with the work such a team carries in a normal week —tasks due around today and some late, subtasks, notes,
-- decisions, links, things to review, events of the workspace's own— written over the past days by hand, by the chat,
-- and by a coding agent, so the Overview and its activity read as a week in progress. It also carries a real
-- workspace's gaps: a client with one project, a project without notes or links, tasks without a date. Still one call,
-- idempotent per owner behind a lock; `src/lib/demo-seed.ts` holds the same tree and a test compares both.

create or replace function public.seed_demo(p_today date)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_now timestamptz := now();
  v_northwind uuid;
  v_website uuid;
  v_ordering uuid;
  v_social uuid;
  v_atlas uuid;
  v_brand uuid;
  v_lumen uuid;
  v_booking uuid;
  v_agency_site uuid;
  v_blog uuid;
  v_operations uuid;
  v_starter uuid;
  v_homepage uuid;
  v_case_study uuid;
  v_logos uuid;
begin
  if v_owner is null then
    raise exception 'the demo seed needs a signed-in session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.nodes where owner_id = v_owner) then
    return false;
  end if;

  -- The tree: the clients with their projects, then the agency's own projects at the root.
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'client', 'Northwind Bakery', 0) returning id into v_northwind;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_northwind, 'project', 'Website', 0) returning id into v_website;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_website, 'subproject', 'Ordering flow', 0) returning id into v_ordering;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_northwind, 'project', 'Social media', 1) returning id into v_social;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'client', 'Studio Atlas', 1) returning id into v_atlas;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_atlas, 'project', 'Brand refresh', 0) returning id into v_brand;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'client', 'Lumen Dental', 2) returning id into v_lumen;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_lumen, 'project', 'Booking page', 0) returning id into v_booking;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'project', 'Agency website', 3) returning id into v_agency_site;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, v_agency_site, 'subproject', 'Blog', 0) returning id into v_blog;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'project', 'Operations', 4) returning id into v_operations;
  insert into public.nodes (owner_id, parent_id, kind, name, position)
  values (v_owner, null, 'project', 'Starter kit', 5) returning id into v_starter;

  -- Northwind Bakery / Website: a task with what hangs from it —two open subtasks, a finished one, a note, and a link—.
  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values (v_website, 'task', 'Send the homepage draft for review', '<p>Use the <strong>approved</strong> photos only.</p>', 1, p_today,
    v_now - interval '144 hours', v_now - interval '144 hours')
  returning id into v_homepage;
  insert into public.items (node_id, parent_item_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_website, v_homepage, 'task', 'Write the hero copy', null, null, 2, p_today, v_now - interval '144 hours', v_now - interval '144 hours'),
    (v_website, v_homepage, 'task', 'Pick the three featured products', null, null, 3, null, v_now - interval '144 hours', v_now - interval '144 hours'),
    (v_website, v_homepage, 'note', 'The client prefers a warm, plain tone.', '<p>The client prefers a warm, plain tone.</p>', null, null, null,
      v_now - interval '120 hours', v_now - interval '120 hours'),
    (v_website, v_homepage, 'link', 'Homepage draft', null, 'https://example.com/northwind/homepage-draft', null, null,
      v_now - interval '50 hours', v_now - interval '50 hours');
  insert into public.items (node_id, parent_item_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, v_homepage, 'task', 'Compress the hero photos', 3, 'done', v_now - interval '26 hours',
    v_now - interval '144 hours', v_now - interval '26 hours');

  insert into public.items (node_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_website, 'task', 'Collect product photos from the client', null, null, 2, p_today - 1, v_now - interval '192 hours', v_now - interval '192 hours'),
    (v_website, 'decision', 'Online orders go through the existing POS', '<p>Avoids a <strong>second inventory</strong>.</p>', null, null, null,
      v_now - interval '168 hours', v_now - interval '168 hours'),
    (v_website, 'link', 'Project brief', null, 'https://example.com/northwind/brief', null, null, v_now - interval '240 hours', v_now - interval '240 hours'),
    (v_website, 'note', 'Kickoff notes',
      '<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>',
      null, null, null, v_now - interval '240 hours', v_now - interval '240 hours');
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_website, 'task', 'Confirm the delivery date with the client', 3, p_today + 1, 'chat', 'chat',
    v_now - interval '2 hours', v_now - interval '2 hours');
  insert into public.items (node_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, 'task', 'Set up the staging site', 3, 'done', v_now - interval '70 hours', v_now - interval '216 hours', v_now - interval '70 hours');

  -- Northwind Bakery / Website / Ordering flow: a coding agent left something to review.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_ordering, 'task', 'Map the pickup time slots', 3, p_today + 2, v_now - interval '96 hours', v_now - interval '96 hours');
  insert into public.items (node_id, type, title, url, source, agent_label, changed_source, changed_agent_label, created_at, updated_at)
  values (v_ordering, 'review', 'Review the checkout pull request', 'https://example.com/northwind/checkout-pr', 'agent', 'laptop', 'agent', 'laptop',
    v_now - interval '20 hours', v_now - interval '20 hours');

  -- Northwind Bakery / Social media
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values
    (v_social, 'task', 'Plan the November posts', 3, p_today + 5, v_now - interval '72 hours', v_now - interval '72 hours'),
    (v_social, 'task', 'Draft a posting guide', 4, null, v_now - interval '288 hours', v_now - interval '288 hours');

  -- Studio Atlas / Brand refresh, with an item that already changed: its first title is a version the panel restores.
  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values
    (v_brand, 'task', 'Send the moodboard', null, 2, p_today, v_now - interval '120 hours', v_now - interval '120 hours'),
    (v_brand, 'task', 'Book the photo session', null, 3, p_today + 3, v_now - interval '96 hours', v_now - interval '96 hours'),
    (v_brand, 'decision', 'Keep the current color palette', '<p>Printed stock is already ordered.</p>', null, null,
      v_now - interval '144 hours', v_now - interval '144 hours'),
    (v_brand, 'review', 'Read the stakeholder survey results', null, null, null, v_now - interval '48 hours', v_now - interval '48 hours');
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_brand, 'task', 'Present logo directions', 2, p_today, v_now - interval '144 hours', v_now - interval '144 hours')
  returning id into v_logos;
  update public.items set title = 'Present two logo directions' where id = v_logos;

  -- Lumen Dental / Booking page: one project with two items, one of them written by the chat.
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_booking, 'task', 'Ask for the clinic''s opening hours', 3, p_today + 1, 'chat', 'chat', v_now - interval '5 hours', v_now - interval '5 hours');
  insert into public.items (node_id, type, title, created_at, updated_at)
  values (v_booking, 'review', 'Approve the booking form copy', v_now - interval '30 hours', v_now - interval '30 hours');

  -- Agency website, a project of the agency's own, with a task and its subtasks, and its Blog below.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_agency_site, 'task', 'Write the Northwind case study', 3, p_today + 4, v_now - interval '100 hours', v_now - interval '100 hours')
  returning id into v_case_study;
  insert into public.items (node_id, parent_item_id, type, title, priority, created_at, updated_at)
  values
    (v_agency_site, v_case_study, 'task', 'Ask Northwind for a short quote', 3, v_now - interval '100 hours', v_now - interval '100 hours'),
    (v_agency_site, v_case_study, 'task', 'Choose the before-and-after shots', 4, v_now - interval '100 hours', v_now - interval '100 hours');
  insert into public.items (node_id, type, title, body, url, priority, created_at, updated_at)
  values
    (v_agency_site, 'task', 'Update the portfolio page', null, null, 4, v_now - interval '300 hours', v_now - interval '300 hours'),
    (v_agency_site, 'decision', 'Show three case studies, not ten', '<p>Fewer projects, told in depth.</p>', null, null,
      v_now - interval '260 hours', v_now - interval '260 hours'),
    (v_agency_site, 'link', 'Site analytics', null, 'https://example.com/agency/analytics', null, v_now - interval '400 hours', v_now - interval '400 hours'),
    (v_agency_site, 'note', 'Ideas for the about page',
      '<p><strong>Ideas for the about page</strong></p><ul><li>How we work, in four steps</li><li>The team, with real photos</li></ul>',
      null, null, v_now - interval '80 hours', v_now - interval '80 hours');
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_blog, 'task', 'Draft the post on pricing small sites', 3, p_today + 6, v_now - interval '60 hours', v_now - interval '60 hours');

  -- Operations: the agency's own admin, one late invoice run and a reminder the chat wrote.
  insert into public.items (node_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_operations, 'task', 'Send the October invoices', null, null, 1, p_today - 1, v_now - interval '200 hours', v_now - interval '200 hours'),
    (v_operations, 'task', 'Renew the agency''s domain', null, null, 2, p_today + 2, v_now - interval '150 hours', v_now - interval '150 hours'),
    (v_operations, 'task', 'File the quarterly taxes', null, null, 2, p_today + 9, v_now - interval '300 hours', v_now - interval '300 hours'),
    (v_operations, 'review', 'Review the new contract template', null, 'https://example.com/agency/contract-template', null, null,
      v_now - interval '26 hours', v_now - interval '26 hours'),
    (v_operations, 'note', 'Payment terms',
      '<p><strong>Payment terms</strong></p><p>Half up front, half on delivery; invoices due in 15 days.</p>', null, null, null,
      v_now - interval '500 hours', v_now - interval '500 hours');
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_operations, 'task', 'Chase the Studio Atlas payment', 2, p_today, 'chat', 'chat', v_now - interval '3 hours', v_now - interval '3 hours');

  -- Starter kit: what the agency reuses on client sites, where a coding agent works too.
  insert into public.items (node_id, type, title, priority, due_on, status, completed_at, source, agent_label, changed_source, changed_agent_label,
    created_at, updated_at)
  values
    (v_starter, 'task', 'Add the contact form block', 3, p_today + 3, 'open', null, 'agent', 'laptop', 'agent', 'laptop',
      v_now - interval '22 hours', v_now - interval '22 hours'),
    (v_starter, 'task', 'Upgrade the starter''s dependencies', 3, null, 'done', v_now - interval '28 hours', 'agent', 'laptop', 'agent', 'laptop',
      v_now - interval '30 hours', v_now - interval '28 hours');
  insert into public.items (node_id, type, title, body, url, priority, created_at, updated_at)
  values
    (v_starter, 'task', 'Write the setup guide', null, null, 4, v_now - interval '340 hours', v_now - interval '340 hours'),
    (v_starter, 'decision', 'Keep the starter on the same stack as client sites', '<p>One stack to maintain and to debug.</p>', null, null,
      v_now - interval '320 hours', v_now - interval '320 hours'),
    (v_starter, 'link', 'Starter kit repository', null, 'https://example.com/agency/starter-kit', null, v_now - interval '330 hours', v_now - interval '330 hours');

  -- Events of the workspace's own, whole days around today.
  insert into public.events (node_id, title, all_day, starts_on, ends_on)
  values
    (v_website, 'Homepage review with the client', true, p_today + 1, p_today + 1),
    (v_brand, 'Photo session', true, p_today + 3, p_today + 3),
    (v_operations, 'Weekly planning', true, p_today, p_today),
    (v_operations, 'Accountant call', true, p_today + 2, p_today + 2);

  return true;
end;
$$;
