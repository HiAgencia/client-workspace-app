-- A demo reads as a week of real work. Today holds four tasks, one of each origin, so the first screen shows the day whole; a meeting
-- lands on each working day of this week and the next, so the calendar's week is lived in whichever day the visitor arrives on; each
-- sample account lists the calendar its meetings come from; and the trash holds what the person deleted, with what left with it.
-- The seed stays `security definer`: it takes no text from the caller, and it writes only for `auth.uid()`.

create or replace function public.seed_demo(p_today date, p_zone text default 'UTC')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_now timestamptz := now();
  v_zone text := coalesce(p_zone, 'UTC');
  -- The Monday of the visitor's week: a meeting lands on a working day whatever day the visitor arrives on.
  v_monday date := p_today - (extract(isodow from p_today)::int - 1);
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
  v_invoices uuid;
  v_offsite uuid;
  v_passport uuid;
  v_flights uuid;
  v_contract uuid;
  v_portfolio uuid;
  v_posting uuid;
  v_setup_guide uuid;
  v_gone uuid;
  v_atlas_call uuid;
  v_app_review uuid;
  v_transfer uuid;
  v_accounts jsonb;
  v_mail_larkspur uuid;
  v_mail_atlas uuid;
  v_mail_ops uuid;
begin
  if v_owner is null then
    raise exception 'the demo seed needs a signed-in session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  if exists (select 1 from public.nodes where owner_id = v_owner) then
    return false;
  end if;

  -- The tree: the clients with their projects, then the agency's own projects at the root, all set up before the oldest
  -- item. A few carry the color the person gave them.
  v_setup := public.working_minutes_before(v_now, 8100, v_zone);
  insert into public.nodes (owner_id, parent_id, kind, name, position, color, created_at, updated_at)
  values (v_owner, null, 'client', 'Larkspur Bakery', 0, 'amber', v_setup, v_setup) returning id into v_larkspur;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_larkspur, 'project', 'Website', 0, v_setup, v_setup) returning id into v_website;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_website, 'subproject', 'Ordering flow', 0, v_setup, v_setup) returning id into v_ordering;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_larkspur, 'project', 'Social media', 1, v_setup, v_setup) returning id into v_social;
  insert into public.nodes (owner_id, parent_id, kind, name, position, color, created_at, updated_at)
  values (v_owner, null, 'client', 'Studio Atlas', 1, 'violet', v_setup, v_setup) returning id into v_atlas;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_atlas, 'project', 'Brand refresh', 0, v_setup, v_setup) returning id into v_brand;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'client', 'Lumen Dental', 2, v_setup, v_setup) returning id into v_lumen;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_lumen, 'project', 'Booking page', 0, v_setup, v_setup) returning id into v_booking;
  insert into public.nodes (owner_id, parent_id, kind, name, position, color, created_at, updated_at)
  values (v_owner, null, 'project', 'Agency website', 3, 'blue', v_setup, v_setup) returning id into v_agency_site;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, v_agency_site, 'subproject', 'Blog', 0, v_setup, v_setup) returning id into v_blog;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'project', 'Operations', 4, v_setup, v_setup) returning id into v_operations;
  insert into public.nodes (owner_id, parent_id, kind, name, position, created_at, updated_at)
  values (v_owner, null, 'project', 'Component library', 5, v_setup, v_setup) returning id into v_library;

  -- Larkspur Bakery / Website: a task at an hour with what hangs from it —two open subtasks, a finished one, a note, and a
  -- note that is a link over its words—.
  insert into public.items (node_id, type, title, body, priority, due_on, due_time, created_at, updated_at)
  values (v_website, 'task', 'Send the homepage draft for review', '<p>Use the <strong>approved</strong> photos only.</p>', 1, p_today, '16:00',
    public.working_minutes_before(v_now, 2294, v_zone), public.working_minutes_before(v_now, 2294, v_zone))
  returning id into v_homepage;
  insert into public.items (node_id, parent_item_id, type, title, body, priority, due_on, created_at, updated_at)
  values
    (v_website, v_homepage, 'task', 'Write the hero copy', null, 3, null,
      public.working_minutes_before(v_now, 2292, v_zone), public.working_minutes_before(v_now, 2292, v_zone)),
    (v_website, v_homepage, 'task', 'Pick the three featured products', null, 3, null,
      public.working_minutes_before(v_now, 2291, v_zone), public.working_minutes_before(v_now, 2291, v_zone)),
    (v_website, v_homepage, 'note', 'The client prefers a warm, plain tone.', '<p>The client prefers a warm, plain tone.</p>', null, null,
      public.working_minutes_before(v_now, 1907, v_zone), public.working_minutes_before(v_now, 1907, v_zone)),
    (v_website, v_homepage, 'note', '[Homepage draft](https://www.figma.com/design/q7RkLm2XvT9bWc4NsYp1Ha/Larkspur-homepage)',
      '<p><a href="https://www.figma.com/design/q7RkLm2XvT9bWc4NsYp1Ha/Larkspur-homepage">Homepage draft</a></p>', null, null,
      public.working_minutes_before(v_now, 791, v_zone), public.working_minutes_before(v_now, 791, v_zone));
  insert into public.items (node_id, parent_item_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, v_homepage, 'task', 'Compress the hero photos', 3, 'done', public.working_minutes_before(v_now, 431, v_zone),
    public.working_minutes_before(v_now, 2289, v_zone), public.working_minutes_before(v_now, 431, v_zone));

  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values
    (v_website, 'task', 'Collect product photos from the client', null, 3, p_today - 1,
      public.working_minutes_before(v_now, 3046, v_zone), public.working_minutes_before(v_now, 3046, v_zone)),
    (v_website, 'decision', 'Online orders go through the existing POS', '<p>Avoids a <strong>second inventory</strong>.</p>', null, null,
      public.working_minutes_before(v_now, 2671, v_zone), public.working_minutes_before(v_now, 2671, v_zone)),
    (v_website, 'note', '[Project brief](https://docs.google.com/document/d/1Kx9vRt-Qm3LpZ7wYc2NbH8sJf5Ud0GaEo4TiWq6Vr_M/edit)',
      '<p><a href="https://docs.google.com/document/d/1Kx9vRt-Qm3LpZ7wYc2NbH8sJf5Ud0GaEo4TiWq6Vr_M/edit">Project brief</a></p>', null, null,
      public.working_minutes_before(v_now, 3812, v_zone), public.working_minutes_before(v_now, 3812, v_zone)),
    (v_website, 'note', 'Kickoff notes',
      '<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>',
      null, null, public.working_minutes_before(v_now, 3818, v_zone), public.working_minutes_before(v_now, 3818, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_website, 'task', 'Confirm the delivery date with the client', 3, p_today + 1, 'chat', 'chat',
    public.working_minutes_before(v_now, 41, v_zone), public.working_minutes_before(v_now, 41, v_zone))
  returning id into v_delivery;
  insert into public.items (node_id, type, title, priority, status, completed_at, created_at, updated_at)
  values (v_website, 'task', 'Set up the staging site', 3, 'done', public.working_minutes_before(v_now, 1113, v_zone),
    public.working_minutes_before(v_now, 3427, v_zone), public.working_minutes_before(v_now, 1113, v_zone));

  -- Larkspur Bakery / Website / Ordering flow: a coding agent asked for a review, which is a task of the day it asked.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_ordering, 'task', 'Map the pickup time slots', 3, p_today + 2,
    public.working_minutes_before(v_now, 1534, v_zone), public.working_minutes_before(v_now, 1534, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, source, agent_label, changed_source, changed_agent_label, created_at, updated_at)
  values (v_ordering, 'task', '[Review the checkout pull request](https://github.com/larkspur-bakery/website/pull/48)', 4, p_today,
    'agent', 'Laptop', 'agent', 'Laptop',
    public.working_minutes_before(v_now, 326, v_zone), public.working_minutes_before(v_now, 326, v_zone));

  -- Larkspur Bakery / Social media: no notes at all.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_social, 'task', 'Plan the November posts', 3, p_today + 5,
    public.working_minutes_before(v_now, 1147, v_zone), public.working_minutes_before(v_now, 1147, v_zone));
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (v_social, 'task', 'Draft a posting guide', 4,
    public.working_minutes_before(v_now, 4574, v_zone), public.working_minutes_before(v_now, 4574, v_zone))
  returning id into v_posting;

  -- Studio Atlas / Brand refresh, with an item that already changed: its first title is a version the panel restores.
  insert into public.items (node_id, type, title, body, priority, due_on, created_at, updated_at)
  values
    (v_brand, 'task', 'Send the moodboard', null, 3, p_today + 1,
      public.working_minutes_before(v_now, 1913, v_zone), public.working_minutes_before(v_now, 1913, v_zone)),
    (v_brand, 'task', 'Book the photo session', null, 3, p_today + 3,
      public.working_minutes_before(v_now, 1529, v_zone), public.working_minutes_before(v_now, 1529, v_zone)),
    (v_brand, 'decision', 'Keep the current color palette', '<p>Printed stock is already ordered.</p>', null, null,
      public.working_minutes_before(v_now, 2283, v_zone), public.working_minutes_before(v_now, 2283, v_zone)),
    (v_brand, 'task', 'Read the stakeholder survey results', null, 3, p_today + 1,
      public.working_minutes_before(v_now, 742, v_zone), public.working_minutes_before(v_now, 742, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_brand, 'task', 'Present logo directions', 3, p_today + 1,
    public.working_minutes_before(v_now, 2301, v_zone), public.working_minutes_before(v_now, 2301, v_zone))
  returning id into v_logos;
  -- The rename's own moment is the database's: `items_touch` stamps `updated_at` and the revision trigger stamps the
  -- version with now(), and neither is the caller's to set.
  update public.items set title = 'Present two logo directions' where id = v_logos;

  -- Lumen Dental / Booking page: one project with two tasks, one of them written by the chat.
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_booking, 'task', 'Ask for the clinic''s opening hours', 3, p_today + 1, 'chat', 'chat',
    public.working_minutes_before(v_now, 118, v_zone), public.working_minutes_before(v_now, 118, v_zone))
  returning id into v_hours;
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_booking, 'task', 'Approve the booking form copy', 3, p_today + 2,
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
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (v_agency_site, 'task', 'Update the portfolio page', 4,
    public.working_minutes_before(v_now, 4763, v_zone), public.working_minutes_before(v_now, 4763, v_zone))
  returning id into v_portfolio;
  insert into public.items (node_id, type, title, body, created_at, updated_at)
  values
    (v_agency_site, 'decision', 'Show three case studies, not ten', '<p>Fewer projects, told in depth.</p>',
      public.working_minutes_before(v_now, 4127, v_zone), public.working_minutes_before(v_now, 4127, v_zone)),
    (v_agency_site, 'note', '[Site analytics](https://analytics.google.com/analytics/web/)',
      '<p><a href="https://analytics.google.com/analytics/web/">Site analytics</a></p>',
      public.working_minutes_before(v_now, 6351, v_zone), public.working_minutes_before(v_now, 6351, v_zone)),
    (v_agency_site, 'note', 'Ideas for the about page',
      '<p><strong>Ideas for the about page</strong></p><ul><li>How we work, in four steps</li><li>The team, with real photos</li></ul>',
      public.working_minutes_before(v_now, 1262, v_zone), public.working_minutes_before(v_now, 1262, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_blog, 'task', 'Draft the post on pricing small sites', 3, p_today + 6,
    public.working_minutes_before(v_now, 958, v_zone), public.working_minutes_before(v_now, 958, v_zone));

  -- Operations: the agency's own admin, one late invoice run with a note, a reminder the chat wrote, and a review.
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_operations, 'task', 'Send the October invoices', 2, p_today - 1,
    public.working_minutes_before(v_now, 3171, v_zone), public.working_minutes_before(v_now, 3171, v_zone))
  returning id into v_invoices;
  insert into public.items (node_id, parent_item_id, type, title, body, created_at, updated_at)
  values (v_operations, v_invoices, 'note', 'Larkspur pays by bank transfer, not by card.', '<p>Larkspur pays by bank transfer, not by card.</p>',
    public.working_minutes_before(v_now, 2410, v_zone), public.working_minutes_before(v_now, 2410, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values
    (v_operations, 'task', 'Renew the agency''s domain', 2, p_today + 2,
      public.working_minutes_before(v_now, 2378, v_zone), public.working_minutes_before(v_now, 2378, v_zone)),
    (v_operations, 'task', 'File the quarterly taxes', 2, p_today + 9,
      public.working_minutes_before(v_now, 4769, v_zone), public.working_minutes_before(v_now, 4769, v_zone));
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (v_operations, 'task', '[Review the new contract template](https://docs.google.com/document/d/1Zp4HwQe8TnB2xLv-Ka7RcM5yGs3Df9Uj0Nb6Wt_EoXi/edit)', 3,
    public.working_minutes_before(v_now, 437, v_zone), public.working_minutes_before(v_now, 437, v_zone))
  returning id into v_contract;
  -- Two tasks that wait for a message in the operations account: the app review's approval, which already arrived, and
  -- the client's bank transfer, which has not.
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (v_operations, 'task', 'Wait for the app review approval', 3,
    public.working_minutes_before(v_now, 2880, v_zone), public.working_minutes_before(v_now, 2880, v_zone))
  returning id into v_app_review;
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_operations, 'task', 'Wait for the bank transfer', 3, p_today,
    public.working_minutes_before(v_now, 1490, v_zone), public.working_minutes_before(v_now, 1490, v_zone))
  returning id into v_transfer;
  insert into public.items (node_id, type, title, body, created_at, updated_at)
  values (v_operations, 'note', 'Payment terms',
    '<p><strong>Payment terms</strong></p><p>Half up front, half on delivery; invoices due in 15 days.</p>',
    public.working_minutes_before(v_now, 7942, v_zone), public.working_minutes_before(v_now, 7942, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, source, changed_source, created_at, updated_at)
  values (v_operations, 'task', 'Chase the Studio Atlas payment', 2, p_today, 'chat', 'chat',
    public.working_minutes_before(v_now, 67, v_zone), public.working_minutes_before(v_now, 67, v_zone))
  returning id into v_chase;

  -- Component library: what the agency reuses on client sites, where a coding agent works too.
  insert into public.items (node_id, type, title, priority, due_on, status, completed_at, source, agent_label, changed_source, changed_agent_label,
    created_at, updated_at)
  values
    (v_library, 'task', 'Add the contact form block', 3, p_today + 3, 'open', null, 'agent', 'Laptop', 'agent', 'Laptop',
      public.working_minutes_before(v_now, 352, v_zone), public.working_minutes_before(v_now, 352, v_zone)),
    (v_library, 'task', 'Update the library''s dependencies', 3, null, 'done', public.working_minutes_before(v_now, 466, v_zone),
      'agent', 'Laptop', 'agent', 'Laptop',
      public.working_minutes_before(v_now, 503, v_zone), public.working_minutes_before(v_now, 466, v_zone));
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (v_library, 'task', 'Write the setup guide', 4,
    public.working_minutes_before(v_now, 5402, v_zone), public.working_minutes_before(v_now, 5402, v_zone))
  returning id into v_setup_guide;
  insert into public.items (node_id, type, title, body, created_at, updated_at)
  values
    (v_library, 'decision', 'Keep the library on the same stack as client sites', '<p>One stack to maintain and to debug.</p>',
      public.working_minutes_before(v_now, 5081, v_zone), public.working_minutes_before(v_now, 5081, v_zone)),
    (v_library, 'note', '[Component library repository](https://github.com/harborline-studio/component-library)',
      '<p><a href="https://github.com/harborline-studio/component-library">Component library repository</a></p>',
      public.working_minutes_before(v_now, 5243, v_zone), public.working_minutes_before(v_now, 5243, v_zone));

  -- General work, in no client or project: tasks with and without a date, one at an hour, one with its subtasks and a
  -- note, and loose notes.
  insert into public.items (node_id, type, title, priority, due_on, due_time, created_at, updated_at)
  values
    (null, 'task', 'Call the bank about the card limit', 3, p_today + 1, '11:30',
      public.working_minutes_before(v_now, 212, v_zone), public.working_minutes_before(v_now, 212, v_zone)),
    (null, 'task', 'Book the dentist appointment', 3, p_today + 3, null,
      public.working_minutes_before(v_now, 1388, v_zone), public.working_minutes_before(v_now, 1388, v_zone));
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (null, 'task', 'Renew the passport before the trip', 3,
    public.working_minutes_before(v_now, 2954, v_zone), public.working_minutes_before(v_now, 2954, v_zone))
  returning id into v_passport;
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (null, 'task', 'Check the flight prices to Lisbon', 4,
    public.working_minutes_before(v_now, 1730, v_zone), public.working_minutes_before(v_now, 1730, v_zone))
  returning id into v_flights;
  insert into public.items (node_id, type, title, priority, created_at, updated_at)
  values (null, 'task', 'Plan the team offsite', 3,
    public.working_minutes_before(v_now, 3305, v_zone), public.working_minutes_before(v_now, 3305, v_zone))
  returning id into v_offsite;
  insert into public.items (node_id, parent_item_id, type, title, body, priority, created_at, updated_at)
  values
    (null, v_offsite, 'task', 'Pick three possible dates', null, 3,
      public.working_minutes_before(v_now, 3301, v_zone), public.working_minutes_before(v_now, 3301, v_zone)),
    (null, v_offsite, 'task', 'Ask the team about the budget', null, 4,
      public.working_minutes_before(v_now, 3299, v_zone), public.working_minutes_before(v_now, 3299, v_zone)),
    (null, v_offsite, 'note', 'Somewhere reachable by train.', '<p>Somewhere reachable by train.</p>', null,
      public.working_minutes_before(v_now, 2780, v_zone), public.working_minutes_before(v_now, 2780, v_zone));
  insert into public.items (node_id, type, title, body, created_at, updated_at)
  values
    (null, 'note', 'Ideas for the November newsletter',
      '<p><strong>Ideas for the November newsletter</strong></p><ul><li>The Larkspur launch</li><li>Three tips for a faster site</li></ul>',
      public.working_minutes_before(v_now, 604, v_zone), public.working_minutes_before(v_now, 604, v_zone)),
    (null, 'note', 'Ask the accountant whether the new laptop counts as an expense.',
      '<p>Ask the accountant whether the new laptop counts as an expense.</p>',
      public.working_minutes_before(v_now, 1975, v_zone), public.working_minutes_before(v_now, 1975, v_zone));

  -- What the person deleted over the past days, which the trash shows and restores: a task alone, and one with what hung from it,
  -- which left with it.
  insert into public.items (node_id, type, title, priority, deleted_at, created_at, updated_at)
  values (v_operations, 'task', 'Order new business cards', 3, public.working_minutes_before(v_now, 512, v_zone),
    public.working_minutes_before(v_now, 3560, v_zone), public.working_minutes_before(v_now, 512, v_zone));
  insert into public.items (node_id, type, title, priority, deleted_at, created_at, updated_at)
  values (v_blog, 'task', 'Draft the post on hosting costs', 4, public.working_minutes_before(v_now, 1244, v_zone),
    public.working_minutes_before(v_now, 4021, v_zone), public.working_minutes_before(v_now, 1244, v_zone))
  returning id into v_gone;
  insert into public.items (node_id, parent_item_id, type, title, priority, deleted_at, created_at, updated_at)
  values (v_blog, v_gone, 'task', 'Compare three hosting plans', 4, public.working_minutes_before(v_now, 1244, v_zone),
    public.working_minutes_before(v_now, 4018, v_zone), public.working_minutes_before(v_now, 1244, v_zone));

  -- The tasks without a date, in the order the person set by hand: they keep the places the trigger gave them, dealt out in
  -- that order.
  update public.items i
  set position = slots.position
  from unnest(array[v_passport, v_contract, v_flights, v_portfolio, v_offsite, v_app_review, v_posting, v_setup_guide]) with ordinality as chosen (id, rank)
  join (
    select s.position, row_number() over (order by s.position) as rank
    from public.items s
    where s.id = any (array[v_passport, v_contract, v_flights, v_portfolio, v_offsite, v_app_review, v_posting, v_setup_guide])
  ) slots on slots.rank = chosen.rank
  where i.id = chosen.id;

  -- Events of the workspace's own, each written beside the work it belongs to: a meeting at an hour, a whole day, and one of
  -- no node, linked to the project it is about.
  insert into public.events (node_id, title, all_day, starts_at, ends_at, created_at, updated_at)
  values (v_website, 'Homepage review with the client', false,
    ((p_today + 1) + time '11:00') at time zone v_zone, ((p_today + 1) + time '12:00') at time zone v_zone,
    public.working_minutes_before(v_now, 791, v_zone), public.working_minutes_before(v_now, 791, v_zone));
  insert into public.events (node_id, title, all_day, starts_on, ends_on, created_at, updated_at)
  values (v_brand, 'Photo session', true, p_today + 3, p_today + 3,
    public.working_minutes_before(v_now, 1529, v_zone), public.working_minutes_before(v_now, 1529, v_zone));
  insert into public.events (node_id, title, all_day, starts_at, ends_at, created_at, updated_at)
  values (null, 'Call with Studio Atlas', false,
    ((p_today + 1) + time '15:30') at time zone v_zone, ((p_today + 1) + time '16:00') at time zone v_zone,
    public.working_minutes_before(v_now, 640, v_zone), public.working_minutes_before(v_now, 640, v_zone))
  returning id into v_atlas_call;
  insert into public.node_events (node_id, event_id, created_at)
  values (v_brand, v_atlas_call, public.working_minutes_before(v_now, 640, v_zone));

  -- The sample accounts, each on the client or project it serves, connected before the oldest message.
  select jsonb_object_agg(a.email, a.account_id) into v_accounts
  from public.plant_demo_accounts(jsonb_build_array(
    jsonb_build_object('email', 'hello@larkspur.example', 'node_id', v_larkspur, 'at', v_setup),
    jsonb_build_object('email', 'atlas@harborline.example', 'node_id', v_atlas, 'at', v_setup),
    jsonb_build_object('email', 'ops@harborline.example', 'node_id', v_operations, 'at', v_setup),
    jsonb_build_object('email', 'lumen@harborline.example', 'node_id', v_lumen, 'at', v_setup)
  )) a;
  v_mail_larkspur := (v_accounts ->> 'hello@larkspur.example')::uuid;
  v_mail_atlas := (v_accounts ->> 'atlas@harborline.example')::uuid;
  v_mail_ops := (v_accounts ->> 'ops@harborline.example')::uuid;

  -- Their messages; the Lumen Dental account has none.
  perform public.plant_demo_mail(jsonb_build_array(
    jsonb_build_object('account_id', v_mail_ops, 'from_name', 'Developer Platform', 'from_email', 'noreply@developers.example',
      'to', jsonb_build_array('ops@harborline.example'), 'subject', 'Your app review was approved',
      'snippet', 'Your app review was approved. Your app can now use the permissions it asked for.',
      'text', E'Hello,\n\nYour app review was approved. Your app can now use the permissions it asked for.\n\nThe Developer Platform team',
      'html', '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;background:#eef1f6"><tr><td style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;max-width:100%;background:#ffffff;border-radius:12px"><tr><td style="padding:24px 32px;background:#1b2a4a;border-radius:12px 12px 0 0;color:#ffffff;font-size:15px;font-weight:bold">Developer Platform</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#1b2a4a">Your app review was approved</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3b4a60">Your app can now use the permissions it asked for. Nothing else is needed from you: the change is already live.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%;background:#f4f6fa;border-radius:8px"><tr><td style="padding:14px 16px;font-size:13px;color:#6a768c">Permissions granted</td><td style="padding:14px 16px;font-size:14px;font-weight:bold;color:#1b2a4a;text-align:right">Pages, Messaging</td></tr></table><a href="https://developers.example/apps" style="display:inline-block;padding:12px 22px;background:#1464d2;border-radius:8px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Open your app</a></td></tr><tr><td style="padding:20px 32px;border-top:1px solid #e3e7ee;font-size:12px;color:#6a768c">The Developer Platform team</td></tr></table></td></tr></table>',      'received_at', public.working_minutes_before(v_now, 182, v_zone), 'unread', true, 'important', false),
    jsonb_build_object('account_id', v_mail_ops, 'from_name', 'Developer Platform', 'from_email', 'noreply@developers.example',
      'to', jsonb_build_array('ops@harborline.example'), 'subject', 'API changes coming in November',
      'snippet', 'Two endpoints change on November 15. See what moves before your next release.',
      'text', E'Hello,\n\nTwo endpoints change on November 15. See what moves before your next release.\n\nThe Developer Platform team',
      'html', '<p>Hello,</p><p>Two endpoints change on November 15. See what moves before your next release.</p><p>The Developer Platform team</p>',
      'received_at', public.working_minutes_before(v_now, 1210, v_zone), 'unread', false, 'important', false),
    jsonb_build_object('account_id', v_mail_larkspur, 'from_name', 'Maya Chen', 'from_email', 'maya@larkspur.example',
      'to', jsonb_build_array('hello@larkspur.example'), 'subject', 'New photos for the homepage',
      'snippet', 'Here are the new product photos for the homepage: the croissants and the sourdough came out well.',
      'text', E'Hi!\n\nHere are the new product photos for the homepage: the croissants and the sourdough came out well.\n\nMaya',
      'html', '<div style="font-family:Georgia,serif;font-size:16px;color:#2d2416"><p>Hi!</p><p>Here are the new product photos for the homepage: the croissants and the sourdough came out well.</p><p><img src="https://images.larkspur.example/croissants.jpg" alt="Croissants on a tray" width="480"></p><p>Maya</p></div>',
      'received_at', public.working_minutes_before(v_now, 97, v_zone), 'unread', true, 'important', true),
    jsonb_build_object('account_id', v_mail_larkspur, 'from_name', 'Maya Chen', 'from_email', 'maya@larkspur.example',
      'to', jsonb_build_array('hello@larkspur.example'), 'subject', 'Re: Delivery date',
      'snippet', 'We would like the site live before the holiday orders start.',
      'text', E'We would like the site live before the holiday orders start.\n\nMaya',
      'html', '<p>We would like the site live before the holiday orders start.</p><p>Maya</p>',
      'received_at', public.working_minutes_before(v_now, 1652, v_zone), 'unread', false, 'important', false),
    jsonb_build_object('account_id', v_mail_atlas, 'from_name', 'Ana Ruiz', 'from_email', 'ana@studioatlas.example',
      'to', jsonb_build_array('atlas@harborline.example'), 'subject', 'Survey results',
      'snippet', 'The stakeholder survey closed yesterday: the results are in the attached summary.',
      'text', E'Hello,\n\nThe stakeholder survey closed yesterday: the results are in the attached summary.\n\nAna',
      'html', '<p>Hello,</p><p>The stakeholder survey closed yesterday: the results are in the attached summary.</p><p>Ana</p>',
      'received_at', public.working_minutes_before(v_now, 301, v_zone), 'unread', true, 'important', false),
    jsonb_build_object('account_id', v_mail_ops, 'from_name', 'Coworking Hub', 'from_email', 'billing@coworkinghub.example',
      'to', jsonb_build_array('ops@harborline.example'), 'subject', 'Your October invoice is ready',
      'snippet', 'Your invoice for October is ready to download.',
      'text', E'Your invoice for October is ready to download.\n\nCoworking Hub',
      'html', '<p>Your invoice for October is ready to download.</p><p>Coworking Hub</p>',
      'received_at', public.working_minutes_before(v_now, 2205, v_zone), 'unread', false, 'important', false)
  ));

  -- Their calendars, each event at its hour in the visitor's zone: today's, and a meeting on each working day of this week and the
  -- next, so whichever week the screen opens on, its days hold something; the Lumen Dental account has none.
  perform public.plant_demo_events(jsonb_build_array(
    jsonb_build_object('account_id', v_mail_ops, 'calendar', 'Operations', 'title', 'Weekly planning', 'location', null,
      'starts_at', ((p_today) + time '09:30') at time zone v_zone, 'ends_at', ((p_today) + time '10:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_larkspur, 'calendar', 'Larkspur Bakery', 'title', 'Photo review with Maya', 'location', 'Video call',
      'starts_at', ((p_today) + time '14:00') at time zone v_zone, 'ends_at', ((p_today) + time '14:30') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_atlas, 'calendar', 'Studio Atlas', 'title', 'Logo directions with Ana', 'location', 'Video call',
      'starts_at', ((p_today) + time '17:00') at time zone v_zone, 'ends_at', ((p_today) + time '17:30') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_ops, 'calendar', 'Operations', 'title', 'Accountant call', 'location', 'Video call',
      'starts_at', ((v_monday) + time '15:00') at time zone v_zone, 'ends_at', ((v_monday) + time '15:30') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_larkspur, 'calendar', 'Larkspur Bakery', 'title', 'Holiday menu planning', 'location', 'Larkspur Bakery',
      'starts_at', ((v_monday + 1) + time '10:00') at time zone v_zone, 'ends_at', ((v_monday + 1) + time '11:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_atlas, 'calendar', 'Studio Atlas', 'title', 'Brand workshop', 'location', 'Studio Atlas',
      'starts_at', ((v_monday + 2) + time '11:00') at time zone v_zone, 'ends_at', ((v_monday + 2) + time '13:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_larkspur, 'calendar', 'Larkspur Bakery', 'title', 'Site speed review', 'location', 'Video call',
      'starts_at', ((v_monday + 3) + time '11:30') at time zone v_zone, 'ends_at', ((v_monday + 3) + time '12:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_ops, 'calendar', 'Operations', 'title', 'Invoice run', 'location', null,
      'starts_at', ((v_monday + 4) + time '16:00') at time zone v_zone, 'ends_at', ((v_monday + 4) + time '16:30') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_ops, 'calendar', 'Operations', 'title', 'Team retrospective', 'location', null,
      'starts_at', ((v_monday + 7) + time '16:00') at time zone v_zone, 'ends_at', ((v_monday + 7) + time '16:45') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_larkspur, 'calendar', 'Larkspur Bakery', 'title', 'Copy review with Maya', 'location', 'Video call',
      'starts_at', ((v_monday + 8) + time '11:00') at time zone v_zone, 'ends_at', ((v_monday + 8) + time '11:45') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_atlas, 'calendar', 'Studio Atlas', 'title', 'Logo presentation', 'location', 'Studio Atlas',
      'starts_at', ((v_monday + 9) + time '15:00') at time zone v_zone, 'ends_at', ((v_monday + 9) + time '16:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_ops, 'calendar', 'Operations', 'title', 'Quarterly taxes review', 'location', 'Video call',
      'starts_at', ((v_monday + 10) + time '10:30') at time zone v_zone, 'ends_at', ((v_monday + 10) + time '11:00') at time zone v_zone),
    jsonb_build_object('account_id', v_mail_larkspur, 'calendar', 'Larkspur Bakery', 'title', 'Launch checklist', 'location', 'Video call',
      'starts_at', ((v_monday + 11) + time '14:30') at time zone v_zone, 'ends_at', ((v_monday + 11) + time '15:00') at time zone v_zone)
  ));
  -- Each of them shares one calendar, the one Settings lists.
  insert into public.account_calendars (account_id, calendar_id, summary)
  values
    (v_mail_ops, 'primary', 'Operations'),
    (v_mail_larkspur, 'primary', 'Larkspur Bakery'),
    (v_mail_atlas, 'primary', 'Studio Atlas');

  -- What the two tasks wait for in the operations account, in the person's words: both messages from Developer Platform
  -- are possible replies to the first, and the person picks the approval.
  insert into public.task_mail (item_id, account_id, waits_for, created_at, updated_at)
  values
    (v_app_review, v_mail_ops, 'Developer Platform',
      public.working_minutes_before(v_now, 2880, v_zone), public.working_minutes_before(v_now, 2880, v_zone)),
    (v_transfer, v_mail_ops, 'Bayside Bank',
      public.working_minutes_before(v_now, 1490, v_zone), public.working_minutes_before(v_now, 1490, v_zone));

  -- The coding agent's tokens: the SHA-256 hex of random bytes nobody holds, the shape a real token's hash has, so neither
  -- can be used. Their moments are the database's: the signed-in role writes only a token's node, hash, and label.
  insert into public.agent_tokens (node_id, token_hash, label)
  values
    (v_website, encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex'), 'Laptop'),
    (v_library, encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex'), 'Laptop');

  -- The conversations that wrote the chat's items, stored as a real turn is: the person's text a minute before, then the
  -- answer with the `create_task` call, its input, and its output, the item as the tool returns it. One statement per
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
          'title', i.title, 'body', i.body, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'dueTime', to_char(i.due_time, 'HH24:MI'), 'position', i.position,
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
          'title', i.title, 'body', i.body, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'dueTime', to_char(i.due_time, 'HH24:MI'), 'position', i.position,
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
          'title', i.title, 'body', i.body, 'status', i.status, 'priority', i.priority, 'dueOn', i.due_on,
          'dueTime', to_char(i.due_time, 'HH24:MI'), 'position', i.position,
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

-- The verification: planted as a demo session, the seed leaves four tasks for today with few of them high, a meeting on every working day
-- of both weeks at its hour in the visitor's zone, the three calendars, and the trash with its two branches, and a reset takes it all. Its
-- rows leave with the block's own failure.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_trash integer;
begin
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.seed_demo(date, text)'::regprocedure) then
    raise exception 'the seed does not run with its owner''s rights over a fixed search path';
  end if;
  begin
    insert into auth.users (id, aud, role, is_anonymous) values (v_owner, 'authenticated', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'is_anonymous', true)::text, true);
    set local role authenticated;
    if public.seed_demo(date '2026-11-04', 'America/Argentina/Buenos_Aires') is not true then
      raise exception 'the demo was not planted';
    end if;
    if (select count(*) from public.items where type = 'task' and status = 'open' and deleted_at is null and parent_item_id is null and due_on = date '2026-11-04') <> 4 then
      raise exception 'today does not hold four tasks';
    end if;
    if (select count(*) filter (where priority <= 2)::float / count(*) from public.items
        where type = 'task' and status = 'open' and deleted_at is null and due_on = date '2026-11-04') > 0.5 then
      raise exception 'most of the day is marked high';
    end if;
    if (select count(*) from public.demo_events) <> 13 or (select count(distinct account_id) from public.demo_events) <> 3 then
      raise exception 'the demo did not plant its meetings of three accounts';
    end if;
    if (select count(distinct (starts_at at time zone 'America/Argentina/Buenos_Aires')::date) from public.demo_events
        where (starts_at at time zone 'America/Argentina/Buenos_Aires')::date between date '2026-11-02' and date '2026-11-06') <> 5
      or (select count(distinct (starts_at at time zone 'America/Argentina/Buenos_Aires')::date) from public.demo_events
        where (starts_at at time zone 'America/Argentina/Buenos_Aires')::date between date '2026-11-09' and date '2026-11-13') <> 5 then
      raise exception 'a working day of the visitor''s weeks holds no meeting';
    end if;
    if (select starts_at from public.demo_events where title = 'Weekly planning') <> timestamptz '2026-11-04 12:30:00+00' then
      raise exception 'a demo event is not at its hour in the visitor''s zone';
    end if;
    if (select count(*) from public.account_calendars) <> 3
      or exists (select 1 from public.demo_events e where not exists (
        select 1 from public.account_calendars c where c.account_id = e.account_id and c.summary = e.calendar_name and c.selected)) then
      raise exception 'a sample account does not list the calendar its meetings come from';
    end if;
    select count(*) into v_trash from public.items where deleted_at is not null;
    if v_trash <> 3 then
      raise exception 'the trash does not hold what the demo deleted';
    end if;
    if public.reset_demo() is not true then
      raise exception 'the demo reset refused';
    end if;
    if exists (select 1 from public.demo_events) or exists (select 1 from public.account_calendars) or exists (select 1 from public.items) then
      raise exception 'the reset left part of the demo';
    end if;
    raise exception 'the rows of this check leave' using errcode = 'CW001';
  exception when sqlstate 'CW001' then
    null;
  end;
end;
$$;
