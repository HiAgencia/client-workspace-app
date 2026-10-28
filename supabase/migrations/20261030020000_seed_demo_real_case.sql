-- The demo reads as a real agency's week. Its names and links read as a team's own (a client's design file, documents,
-- analytics, repositories), not as sample data. Every moment it plants is a number of working minutes —Monday to
-- Friday, 09:00 to 18:00 in the visitor's zone— before the visitor's now, so its activity never shows entries at night
-- or all on one minute. The coding agent that wrote items has its tokens, which nobody holds, and each item the chat
-- wrote has the conversation that wrote it. Still one call, idempotent per owner behind a lock; `src/lib/demo-seed.ts`
-- holds the same tree and a test compares both.

-- The moment that many working minutes before `p_to`, on the wall clock of `p_zone` (an IANA name; an unknown one reads
-- as UTC). From outside working time it first moves to the previous working day's 18:00; then it walks back day by day,
-- and a remainder equal to what is left of a day ends on that day's 09:00. Pure: it reads no table.
-- `src/lib/working-time.ts` holds the same rule.
create function public.working_minutes_before(p_to timestamptz, p_minutes integer, p_zone text default 'UTC')
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_zone text := coalesce(p_zone, 'UTC');
  v_local timestamp;
  v_day timestamp;
  v_left interval := make_interval(mins => greatest(coalesce(p_minutes, 0), 0));
  v_available interval;
begin
  begin
    v_local := p_to at time zone v_zone;
  exception when invalid_parameter_value then
    v_zone := 'UTC';
    v_local := p_to at time zone v_zone;
  end;

  v_day := date_trunc('day', v_local);
  if extract(isodow from v_day) > 5 or v_local < v_day + interval '9 hours' then
    v_day := v_day - interval '1 day';
    while extract(isodow from v_day) > 5 loop
      v_day := v_day - interval '1 day';
    end loop;
    v_local := v_day + interval '18 hours';
  elsif v_local > v_day + interval '18 hours' then
    v_local := v_day + interval '18 hours';
  end if;

  loop
    v_day := date_trunc('day', v_local);
    v_available := v_local - (v_day + interval '9 hours');
    exit when v_left <= v_available;
    v_left := v_left - v_available;
    v_day := v_day - interval '1 day';
    while extract(isodow from v_day) > 5 loop
      v_day := v_day - interval '1 day';
    end loop;
    v_local := v_day + interval '18 hours';
  end loop;

  return (v_local - v_left) at time zone v_zone;
end;
$$;

revoke execute on function public.working_minutes_before(timestamptz, integer, text) from public, anon;
grant execute on function public.working_minutes_before(timestamptz, integer, text) to authenticated, service_role;

drop function public.seed_demo(date);

create function public.seed_demo(p_today date, p_zone text default 'UTC')
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_now timestamptz := now();
  v_zone text := coalesce(p_zone, 'UTC');
  v_setup timestamptz;
  v_larkspur uuid;
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
  v_library uuid;
  v_homepage uuid;
  v_case_study uuid;
  v_logos uuid;
  v_delivery uuid;
  v_chase uuid;
  v_hours uuid;
begin
  if v_owner is null then
    raise exception 'the demo seed needs a signed-in session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.nodes where owner_id = v_owner) then
    return false;
  end if;

  -- The tree: the clients with their projects, then the agency's own projects at the root, all set up before the oldest
  -- item.
  v_setup := public.working_minutes_before(v_now, 8100, v_zone);
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'client', 'Larkspur Bakery', 0, v_setup, v_setup) returning id into v_larkspur;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_larkspur, 'project', 'Website', 0, v_setup, v_setup) returning id into v_website;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_website, 'subproject', 'Ordering flow', 0, v_setup, v_setup) returning id into v_ordering;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_larkspur, 'project', 'Social media', 1, v_setup, v_setup) returning id into v_social;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'client', 'Studio Atlas', 1, v_setup, v_setup) returning id into v_atlas;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_atlas, 'project', 'Brand refresh', 0, v_setup, v_setup) returning id into v_brand;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'client', 'Lumen Dental', 2, v_setup, v_setup) returning id into v_lumen;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_lumen, 'project', 'Booking page', 0, v_setup, v_setup) returning id into v_booking;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'project', 'Agency website', 3, v_setup, v_setup) returning id into v_agency_site;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_agency_site, 'subproject', 'Blog', 0, v_setup, v_setup) returning id into v_blog;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'project', 'Operations', 4, v_setup, v_setup) returning id into v_operations;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'project', 'Component library', 5, v_setup, v_setup) returning id into v_library;

  -- Larkspur Bakery / Website: a task with what hangs from it —two open subtasks, a finished one, a note, and a link—.
  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values (v_website, 'task', 'Send the homepage draft for review', '<p>Use the <strong>approved</strong> photos only.</p>', 1, p_today,
    public.working_minutes_before(v_now, 2294, v_zone), public.working_minutes_before(v_now, 2294, v_zone))
  returning id into v_homepage;
  insert into public.items (node_id, parent_item_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_website, v_homepage, 'task', 'Write the hero copy', null, null, 2, p_today,
      public.working_minutes_before(v_now, 2292, v_zone), public.working_minutes_before(v_now, 2292, v_zone)),
    (v_website, v_homepage, 'task', 'Pick the three featured products', null, null, 3, null,
      public.working_minutes_before(v_now, 2291, v_zone), public.working_minutes_before(v_now, 2291, v_zone)),
    (v_website, v_homepage, 'note', 'The client prefers a warm, plain tone.', '<p>The client prefers a warm, plain tone.</p>', null, null, null,
      public.working_minutes_before(v_now, 1907, v_zone), public.working_minutes_before(v_now, 1907, v_zone)),
    (v_website, v_homepage, 'link', 'Homepage draft', null, 'https://www.figma.com/design/q7RkLm2XvT9bWc4NsYp1Ha/Larkspur-homepage', null, null,
      public.working_minutes_before(v_now, 791, v_zone), public.working_minutes_before(v_now, 791, v_zone));
  insert into public.items (node_id, parent_item_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, v_homepage, 'task', 'Compress the hero photos', 3, 'done', public.working_minutes_before(v_now, 431, v_zone),
    public.working_minutes_before(v_now, 2289, v_zone), public.working_minutes_before(v_now, 431, v_zone));

  insert into public.items (node_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_website, 'task', 'Collect product photos from the client', null, null, 2, p_today - 1,
      public.working_minutes_before(v_now, 3046, v_zone), public.working_minutes_before(v_now, 3046, v_zone)),
    (v_website, 'decision', 'Online orders go through the existing POS', '<p>Avoids a <strong>second inventory</strong>.</p>', null, null, null,
      public.working_minutes_before(v_now, 2671, v_zone), public.working_minutes_before(v_now, 2671, v_zone)),
    (v_website, 'link', 'Project brief', null, 'https://docs.google.com/document/d/1Kx9vRt-Qm3LpZ7wYc2NbH8sJf5Ud0GaEo4TiWq6Vr_M/edit', null, null,
      public.working_minutes_before(v_now, 3812, v_zone), public.working_minutes_before(v_now, 3812, v_zone)),
    (v_website, 'note', 'Kickoff notes',
      '<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>',
      null, null, null, public.working_minutes_before(v_now, 3818, v_zone), public.working_minutes_before(v_now, 3818, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_website, 'task', 'Confirm the delivery date with the client', 3, p_today + 1, 'chat', 'chat',
    public.working_minutes_before(v_now, 41, v_zone), public.working_minutes_before(v_now, 41, v_zone))
  returning id into v_delivery;
  insert into public.items (node_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, 'task', 'Set up the staging site', 3, 'done', public.working_minutes_before(v_now, 1113, v_zone),
    public.working_minutes_before(v_now, 3427, v_zone), public.working_minutes_before(v_now, 1113, v_zone));

  -- Larkspur Bakery / Website / Ordering flow: a coding agent left something to review.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_ordering, 'task', 'Map the pickup time slots', 3, p_today + 2,
    public.working_minutes_before(v_now, 1534, v_zone), public.working_minutes_before(v_now, 1534, v_zone));
  insert into public.items (node_id, type, title, url, source, agent_label, changed_source, changed_agent_label, created_at, updated_at)
  values (v_ordering, 'review', 'Review the checkout pull request', 'https://github.com/larkspur-bakery/website/pull/48',
    'agent', 'laptop', 'agent', 'laptop',
    public.working_minutes_before(v_now, 326, v_zone), public.working_minutes_before(v_now, 326, v_zone));

  -- Larkspur Bakery / Social media
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values
    (v_social, 'task', 'Plan the November posts', 3, p_today + 5,
      public.working_minutes_before(v_now, 1147, v_zone), public.working_minutes_before(v_now, 1147, v_zone)),
    (v_social, 'task', 'Draft a posting guide', 4, null,
      public.working_minutes_before(v_now, 4574, v_zone), public.working_minutes_before(v_now, 4574, v_zone));

  -- Studio Atlas / Brand refresh, with an item that already changed: its first title is a version the panel restores.
  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values
    (v_brand, 'task', 'Send the moodboard', null, 2, p_today,
      public.working_minutes_before(v_now, 1913, v_zone), public.working_minutes_before(v_now, 1913, v_zone)),
    (v_brand, 'task', 'Book the photo session', null, 3, p_today + 3,
      public.working_minutes_before(v_now, 1529, v_zone), public.working_minutes_before(v_now, 1529, v_zone)),
    (v_brand, 'decision', 'Keep the current color palette', '<p>Printed stock is already ordered.</p>', null, null,
      public.working_minutes_before(v_now, 2283, v_zone), public.working_minutes_before(v_now, 2283, v_zone)),
    (v_brand, 'review', 'Read the stakeholder survey results', null, null, null,
      public.working_minutes_before(v_now, 742, v_zone), public.working_minutes_before(v_now, 742, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_brand, 'task', 'Present logo directions', 2, p_today,
    public.working_minutes_before(v_now, 2301, v_zone), public.working_minutes_before(v_now, 2301, v_zone))
  returning id into v_logos;
  -- The rename's own moment is the database's: `set_updated_at` stamps `updated_at` and the revision trigger stamps the
  -- version with now(), and neither is the caller's to set.
  update public.items set title = 'Present two logo directions' where id = v_logos;

  -- Lumen Dental / Booking page: one project with two items, one of them written by the chat.
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_booking, 'task', 'Ask for the clinic''s opening hours', 3, p_today + 1, 'chat', 'chat',
    public.working_minutes_before(v_now, 118, v_zone), public.working_minutes_before(v_now, 118, v_zone))
  returning id into v_hours;
  insert into public.items (node_id, type, title, created_at, updated_at)
  values (v_booking, 'review', 'Approve the booking form copy',
    public.working_minutes_before(v_now, 509, v_zone), public.working_minutes_before(v_now, 509, v_zone));

  -- Agency website, a project of the agency's own, with a task and its subtasks, and its Blog below.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_agency_site, 'task', 'Write the Larkspur case study', 3, p_today + 4,
    public.working_minutes_before(v_now, 1601, v_zone), public.working_minutes_before(v_now, 1601, v_zone))
  returning id into v_case_study;
  insert into public.items (node_id, parent_item_id, type, title, priority, created_at, updated_at)
  values
    (v_agency_site, v_case_study, 'task', 'Ask Larkspur for a short quote', 3,
      public.working_minutes_before(v_now, 1598, v_zone), public.working_minutes_before(v_now, 1598, v_zone)),
    (v_agency_site, v_case_study, 'task', 'Choose the before-and-after shots', 4,
      public.working_minutes_before(v_now, 1596, v_zone), public.working_minutes_before(v_now, 1596, v_zone));
  insert into public.items (node_id, type, title, body, url, priority, created_at, updated_at)
  values
    (v_agency_site, 'task', 'Update the portfolio page', null, null, 4,
      public.working_minutes_before(v_now, 4763, v_zone), public.working_minutes_before(v_now, 4763, v_zone)),
    (v_agency_site, 'decision', 'Show three case studies, not ten', '<p>Fewer projects, told in depth.</p>', null, null,
      public.working_minutes_before(v_now, 4127, v_zone), public.working_minutes_before(v_now, 4127, v_zone)),
    (v_agency_site, 'link', 'Site analytics', null, 'https://analytics.google.com/analytics/web/', null,
      public.working_minutes_before(v_now, 6351, v_zone), public.working_minutes_before(v_now, 6351, v_zone)),
    (v_agency_site, 'note', 'Ideas for the about page',
      '<p><strong>Ideas for the about page</strong></p><ul><li>How we work, in four steps</li><li>The team, with real photos</li></ul>',
      null, null, public.working_minutes_before(v_now, 1262, v_zone), public.working_minutes_before(v_now, 1262, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_blog, 'task', 'Draft the post on pricing small sites', 3, p_today + 6,
    public.working_minutes_before(v_now, 958, v_zone), public.working_minutes_before(v_now, 958, v_zone));

  -- Operations: the agency's own admin, one late invoice run and a reminder the chat wrote.
  insert into public.items (node_id, type, title, body, url, priority, due_on, created_at, updated_at)
  values
    (v_operations, 'task', 'Send the October invoices', null, null, 1, p_today - 1,
      public.working_minutes_before(v_now, 3171, v_zone), public.working_minutes_before(v_now, 3171, v_zone)),
    (v_operations, 'task', 'Renew the agency''s domain', null, null, 2, p_today + 2,
      public.working_minutes_before(v_now, 2378, v_zone), public.working_minutes_before(v_now, 2378, v_zone)),
    (v_operations, 'task', 'File the quarterly taxes', null, null, 2, p_today + 9,
      public.working_minutes_before(v_now, 4769, v_zone), public.working_minutes_before(v_now, 4769, v_zone)),
    (v_operations, 'review', 'Review the new contract template', null,
      'https://docs.google.com/document/d/1Zp4HwQe8TnB2xLv-Ka7RcM5yGs3Df9Uj0Nb6Wt_EoXi/edit', null, null,
      public.working_minutes_before(v_now, 437, v_zone), public.working_minutes_before(v_now, 437, v_zone)),
    (v_operations, 'note', 'Payment terms',
      '<p><strong>Payment terms</strong></p><p>Half up front, half on delivery; invoices due in 15 days.</p>', null, null, null,
      public.working_minutes_before(v_now, 7942, v_zone), public.working_minutes_before(v_now, 7942, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_operations, 'task', 'Chase the Studio Atlas payment', 2, p_today, 'chat', 'chat',
    public.working_minutes_before(v_now, 67, v_zone), public.working_minutes_before(v_now, 67, v_zone))
  returning id into v_chase;

  -- Component library: what the agency reuses on client sites, where a coding agent works too.
  insert into public.items (node_id, type, title, priority, due_on, status, completed_at, source, agent_label, changed_source, changed_agent_label,
    created_at, updated_at)
  values
    (v_library, 'task', 'Add the contact form block', 3, p_today + 3, 'open', null, 'agent', 'laptop', 'agent', 'laptop',
      public.working_minutes_before(v_now, 352, v_zone), public.working_minutes_before(v_now, 352, v_zone)),
    (v_library, 'task', 'Update the library''s dependencies', 3, null, 'done', public.working_minutes_before(v_now, 466, v_zone),
      'agent', 'laptop', 'agent', 'laptop',
      public.working_minutes_before(v_now, 503, v_zone), public.working_minutes_before(v_now, 466, v_zone));
  insert into public.items (node_id, type, title, body, url, priority, created_at, updated_at)
  values
    (v_library, 'task', 'Write the setup guide', null, null, 4,
      public.working_minutes_before(v_now, 5402, v_zone), public.working_minutes_before(v_now, 5402, v_zone)),
    (v_library, 'decision', 'Keep the library on the same stack as client sites', '<p>One stack to maintain and to debug.</p>', null, null,
      public.working_minutes_before(v_now, 5081, v_zone), public.working_minutes_before(v_now, 5081, v_zone)),
    (v_library, 'link', 'Component library repository', null, 'https://github.com/harborline-studio/component-library', null,
      public.working_minutes_before(v_now, 5243, v_zone), public.working_minutes_before(v_now, 5243, v_zone));

  -- Events of the workspace's own, whole days around today, each written beside the work it belongs to.
  insert into public.events (node_id, title, all_day, starts_on, ends_on, created_at, updated_at)
  values
    (v_website, 'Homepage review with the client', true, p_today + 1, p_today + 1,
      public.working_minutes_before(v_now, 791, v_zone), public.working_minutes_before(v_now, 791, v_zone)),
    (v_brand, 'Photo session', true, p_today + 3, p_today + 3,
      public.working_minutes_before(v_now, 1529, v_zone), public.working_minutes_before(v_now, 1529, v_zone)),
    (v_operations, 'Weekly planning', true, p_today, p_today,
      public.working_minutes_before(v_now, 7942, v_zone), public.working_minutes_before(v_now, 7942, v_zone)),
    (v_operations, 'Accountant call', true, p_today + 2, p_today + 2,
      public.working_minutes_before(v_now, 4769, v_zone), public.working_minutes_before(v_now, 4769, v_zone));

  -- The coding agent's tokens: the SHA-256 hex of random bytes nobody holds, the shape a real token's hash has, so neither
  -- can be used. Their moments are the database's: the signed-in role writes only a token's node, hash, and label.
  insert into public.agent_tokens (node_id, token_hash, label)
  values
    (v_website, encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex'), 'laptop'),
    (v_library, encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex'), 'laptop');

  -- The conversations that wrote the chat's items, stored as a real turn is: the person's text a minute before, then the
  -- answer with the `create_task` call, its input, and its output, the item as the tool returned it. One statement per
  -- message keeps their order (`seq`).
  insert into public.chat_messages (node_id, role, parts, created_at)
  values (v_website, 'user', jsonb_build_array(jsonb_build_object('type', 'text',
    'text', 'Add a task to confirm the delivery date with the client, for tomorrow.')),
    public.working_minutes_before(v_now, 42, v_zone));
  insert into public.chat_messages (node_id, role, parts, created_at)
  select v_website, 'assistant', jsonb_build_array(
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'tool-create_task', 'toolCallId', 'call_' || replace(gen_random_uuid()::text, '-', ''),
        'state', 'output-available',
        'input', jsonb_build_object('title', i.title, 'priority', i.priority, 'dueOn', i.due_on),
        'output', jsonb_build_object('ok', true, 'item', jsonb_build_object(
          'id', i.id, 'nodeId', i.node_id, 'nodePath', 'Larkspur Bakery / Website', 'parentId', i.parent_item_id, 'type', i.type,
          'title', i.title, 'body', i.body, 'url', i.url, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'source', i.source, 'agentLabel', i.agent_label, 'changedSource', i.changed_source,
          'changedAgentLabel', i.changed_agent_label, 'createdAt', i.created_at, 'updatedAt', i.updated_at,
          'completedAt', i.completed_at, 'deletedAt', i.deleted_at))),
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'text', 'text', 'Added it to Larkspur Bakery / Website, due tomorrow.', 'state', 'done')),
    public.working_minutes_before(v_now, 41, v_zone)
  from public.items i where i.id = v_delivery;

  insert into public.chat_messages (node_id, role, parts, created_at)
  values (null, 'user', jsonb_build_array(jsonb_build_object('type', 'text',
    'text', 'Remind me to chase the Studio Atlas payment today.')),
    public.working_minutes_before(v_now, 68, v_zone));
  insert into public.chat_messages (node_id, role, parts, created_at)
  select null, 'assistant', jsonb_build_array(
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'tool-create_task', 'toolCallId', 'call_' || replace(gen_random_uuid()::text, '-', ''),
        'state', 'output-available',
        'input', jsonb_build_object('node', 'Operations', 'title', i.title, 'priority', i.priority, 'dueOn', i.due_on),
        'output', jsonb_build_object('ok', true, 'item', jsonb_build_object(
          'id', i.id, 'nodeId', i.node_id, 'nodePath', 'Operations', 'parentId', i.parent_item_id, 'type', i.type,
          'title', i.title, 'body', i.body, 'url', i.url, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'source', i.source, 'agentLabel', i.agent_label, 'changedSource', i.changed_source,
          'changedAgentLabel', i.changed_agent_label, 'createdAt', i.created_at, 'updatedAt', i.updated_at,
          'completedAt', i.completed_at, 'deletedAt', i.deleted_at))),
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'text', 'text', 'Added it to Operations, due today, with high priority.', 'state', 'done')),
    public.working_minutes_before(v_now, 67, v_zone)
  from public.items i where i.id = v_chase;

  insert into public.chat_messages (node_id, role, parts, created_at)
  values (v_booking, 'user', jsonb_build_array(jsonb_build_object('type', 'text',
    'text', 'We need the clinic''s opening hours for the booking form. Add a task for tomorrow.')),
    public.working_minutes_before(v_now, 119, v_zone));
  insert into public.chat_messages (node_id, role, parts, created_at)
  select v_booking, 'assistant', jsonb_build_array(
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'tool-create_task', 'toolCallId', 'call_' || replace(gen_random_uuid()::text, '-', ''),
        'state', 'output-available',
        'input', jsonb_build_object('title', i.title, 'priority', i.priority, 'dueOn', i.due_on),
        'output', jsonb_build_object('ok', true, 'item', jsonb_build_object(
          'id', i.id, 'nodeId', i.node_id, 'nodePath', 'Lumen Dental / Booking page', 'parentId', i.parent_item_id, 'type', i.type,
          'title', i.title, 'body', i.body, 'url', i.url, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'source', i.source, 'agentLabel', i.agent_label, 'changedSource', i.changed_source,
          'changedAgentLabel', i.changed_agent_label, 'createdAt', i.created_at, 'updatedAt', i.updated_at,
          'completedAt', i.completed_at, 'deletedAt', i.deleted_at))),
      jsonb_build_object('type', 'step-start'),
      jsonb_build_object('type', 'text', 'text', 'Added it to Lumen Dental / Booking page, due tomorrow.', 'state', 'done')),
    public.working_minutes_before(v_now, 118, v_zone)
  from public.items i where i.id = v_hours;

  return true;
end;
$$;

revoke execute on function public.seed_demo(date, text) from public, anon;
grant execute on function public.seed_demo(date, text) to authenticated;
