-- What the daily review left in the database goes, now that no build reads it: its tables and functions, its columns on the
-- wait of a task and on a person's preferences, and its unit of usage. What a wait keeps is the person's words, which become
-- required. `save_preferences` is left with a form that takes only a page's boxes and layout, beside the one that also takes
-- the review's two arguments and now ignores them, because PostgREST picks a function by the names of its arguments and a
-- build already running still sends them; that form leaves in a later migration. The demo's seed and reset stop naming what
-- went.

set local lock_timeout = '10s';

-- A wait written by an older build without words keeps its sender, or its task's title.
update public.task_mail t
set waits_for = coalesce(nullif(btrim(t.expect_from), ''), left(btrim(i.title), 200))
from public.items i
where i.id = t.item_id and t.waits_for is null;

alter table public.task_mail alter column waits_for set not null;
alter table public.task_mail drop constraint task_mail_waits_for_check;
alter table public.task_mail add constraint task_mail_waits_for_check check (length(btrim(waits_for)) between 1 and 200);

-- The policy that names a column going is written again without it.
drop policy task_mail_update on public.task_mail;
create policy task_mail_update on public.task_mail for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (task_mail.account_id is null or exists (
      select 1 from public.google_accounts g where g.id = task_mail.account_id and g.owner_id = (select auth.uid())
    ))
  );

drop index public.task_mail_decided_account_id_idx;
alter table public.task_mail
  drop constraint task_mail_decided_together,
  drop column expect_from,
  drop column status,
  drop column sentence,
  drop column decided_account_id,
  drop column decided_message_id,
  drop column checked_at;

drop function public.review_write_mail_status(uuid, uuid, text, text, uuid, text);
drop function public.review_complete_task(uuid, uuid);
drop table public.review_actions;
drop table public.daily_reviews;

delete from public.usage_counters where kind = 'daily_review';
alter table public.usage_counters drop constraint usage_counters_kind_check;
alter table public.usage_counters add constraint usage_counters_kind_check check (kind in ('chat_message', 'transcription'));

-- A person's preferences, one key at a time: what is not part of this change stays as the database holds it, whatever
-- another change wrote a moment ago. `p_board_clear` and `p_layout_clear` forget a page's.
create function public.save_preferences(
  p_page text,
  p_board jsonb,
  p_board_clear boolean,
  p_layout text,
  p_layout_clear boolean
)
returns setof public.preferences
language sql
security invoker
set search_path = ''
as $fn$
  insert into public.preferences as p (owner_id, boards, layouts)
  values (
    (select auth.uid()),
    case when p_page is not null and p_board is not null then jsonb_build_object(p_page, p_board) else '{}'::jsonb end,
    case when p_page is not null and p_layout is not null then jsonb_build_object(p_page, to_jsonb(p_layout)) else '{}'::jsonb end
  )
  on conflict (owner_id) do update
  set boards = case
        when p_page is null then p.boards
        when p_board_clear then p.boards - p_page
        when p_board is not null then jsonb_set(p.boards, array[p_page], p_board, true)
        else p.boards end,
      layouts = case
        when p_page is null then p.layouts
        when p_layout_clear then p.layouts - p_page
        when p_layout is not null then jsonb_set(p.layouts, array[p_page], to_jsonb(p_layout), true)
        else p.layouts end
  returning p.*;
$fn$;

revoke execute on function public.save_preferences(text, jsonb, boolean, text, boolean) from public, anon;
grant execute on function public.save_preferences(text, jsonb, boolean, text, boolean) to authenticated;

-- The form a running build still calls: its last two arguments no longer do anything.
create or replace function public.save_preferences(
  p_page text,
  p_board jsonb,
  p_board_clear boolean,
  p_layout text,
  p_layout_clear boolean,
  p_daily_review boolean,
  p_instruction text
)
returns setof public.preferences
language sql
security invoker
set search_path = ''
as $fn$
  select * from public.save_preferences(p_page, p_board, p_board_clear, p_layout, p_layout_clear);
$fn$;

alter table public.preferences
  drop column daily_review,
  drop column daily_review_instruction;

create or replace function public.reset_demo()
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise exception 'the demo reset needs a signed-in session' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_owner and u.is_anonymous) then
    raise exception 'only a demo session starts over' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  -- What hangs from a node goes with it: its items and their versions, its events, the accounts hung on it, the calendars
  -- and links of those accounts, and the agent tokens of the node. What lives outside a node —General's work, the loose
  -- notes and events, the workspace's conversation— is deleted by its owner. The usage counters stay.
  delete from public.task_mail where owner_id = v_owner;
  delete from public.mail_links where owner_id = v_owner;
  delete from public.mail_opened where owner_id = v_owner;
  delete from public.demo_mail where owner_id = v_owner;
  delete from public.chat_messages where owner_id = v_owner;
  delete from public.preferences where owner_id = v_owner;
  delete from public.items where owner_id = v_owner;
  delete from public.events where owner_id = v_owner;
  delete from public.nodes where owner_id = v_owner;
  delete from public.google_accounts where owner_id = v_owner;
  return true;
end;
$fn$;

-- The demo plants its waits with their words alone.
create or replace function public.seed_demo(p_today date, p_zone text default 'UTC')
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
  v_invoices uuid;
  v_offsite uuid;
  v_passport uuid;
  v_flights uuid;
  v_contract uuid;
  v_portfolio uuid;
  v_posting uuid;
  v_setup_guide uuid;
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
    (v_website, v_homepage, 'task', 'Write the hero copy', null, 2, p_today,
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
    (v_website, 'task', 'Collect product photos from the client', null, 2, p_today - 1,
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
    (v_brand, 'task', 'Send the moodboard', null, 2, p_today,
      public.working_minutes_before(v_now, 1913, v_zone), public.working_minutes_before(v_now, 1913, v_zone)),
    (v_brand, 'task', 'Book the photo session', null, 3, p_today + 3,
      public.working_minutes_before(v_now, 1529, v_zone), public.working_minutes_before(v_now, 1529, v_zone)),
    (v_brand, 'decision', 'Keep the current color palette', '<p>Printed stock is already ordered.</p>', null, null,
      public.working_minutes_before(v_now, 2283, v_zone), public.working_minutes_before(v_now, 2283, v_zone)),
    (v_brand, 'task', 'Read the stakeholder survey results', null, 3, p_today + 1,
      public.working_minutes_before(v_now, 742, v_zone), public.working_minutes_before(v_now, 742, v_zone));
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_brand, 'task', 'Present logo directions', 2, p_today,
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
  values (v_operations, 'task', 'Send the October invoices', 1, p_today - 1,
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
  values (v_operations, 'task', 'Wait for the app review approval', 2,
    public.working_minutes_before(v_now, 2880, v_zone), public.working_minutes_before(v_now, 2880, v_zone))
  returning id into v_app_review;
  insert into public.items (node_id, type, title, priority, due_on, created_at, updated_at)
  values (v_operations, 'task', 'Wait for the bank transfer', 2, p_today,
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
    (null, 'task', 'Call the bank about the card limit', 2, p_today, '11:30',
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

  -- Events of the workspace's own, whole days around today, each written beside the work it belongs to; one of no node,
  -- linked to the project it is about.
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
  insert into public.events (node_id, title, all_day, starts_on, ends_on, created_at, updated_at)
  values (null, 'Call with Studio Atlas', true, p_today + 1, p_today + 1,
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
      'html', '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;background:#f4f6f8"><tr><td style="padding:32px"><table role="presentation" width="560" style="margin:0 auto;background:#ffffff;border-radius:8px"><tr><td style="padding:32px"><h1 style="font-size:22px;color:#1c2b39;margin:0 0 16px">Your app review was approved</h1><p style="font-size:15px;color:#3b4a58;line-height:1.5">Your app can now use the permissions it asked for.</p><p style="font-size:13px;color:#6b7a88">The Developer Platform team</p></td></tr></table></td></tr></table>',
      'received_at', public.working_minutes_before(v_now, 182, v_zone), 'unread', true, 'important', false),
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

revoke execute on function public.seed_demo(date, text) from public, anon;
grant execute on function public.seed_demo(date, text) to authenticated;

-- The verification: nothing of the review is left, no function names it, and the demo's seed, its reset and both forms of the
-- preferences are called for real as a demo session made for it, whose rows leave with the block's own failure.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_named text;
begin
  if to_regclass('public.daily_reviews') is not null or to_regclass('public.review_actions') is not null then
    raise exception 'the review''s tables are still there';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'task_mail' and column_name in ('expect_from', 'status', 'sentence', 'decided_account_id', 'decided_message_id', 'checked_at'))
      or (table_name = 'preferences' and column_name in ('daily_review', 'daily_review_instruction')))
  ) then
    raise exception 'a column of the review is still there';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_named
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~ '(daily_reviews?\M|review_actions|expect_from|decided_account_id|decided_message_id|checked_at|\msentence\M)'
    and p.oid <> 'public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text)'::regprocedure;
  if v_named is not null then
    raise exception 'still named by: %', v_named;
  end if;
  if exists (select 1 from public.task_mail where waits_for is null) then
    raise exception 'a wait has no words';
  end if;
  if not has_column_privilege('authenticated', 'public.task_mail', 'waits_for', 'update')
    or not has_column_privilege('authenticated', 'public.task_mail', 'dismissed', 'update')
    or not has_column_privilege('authenticated', 'public.task_mail', 'account_id', 'update') then
    raise exception 'the person cannot change what a task waits for';
  end if;
  if has_function_privilege('anon', 'public.save_preferences(text, jsonb, boolean, text, boolean)', 'execute')
    or not has_function_privilege('authenticated', 'public.save_preferences(text, jsonb, boolean, text, boolean)', 'execute')
    or not has_function_privilege('authenticated', 'public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text)', 'execute') then
    raise exception 'the preferences are not open to whom they should be';
  end if;
  begin
    insert into auth.users (id, aud, role, is_anonymous) values (v_owner, 'authenticated', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'is_anonymous', true)::text, true);
    if public.seed_demo(current_date, 'UTC') is not true then
      raise exception 'the demo was not planted';
    end if;
    if (select count(*) from public.task_mail where owner_id = v_owner and waits_for in ('Developer Platform', 'Bayside Bank')) <> 2 then
      raise exception 'the demo did not plant its two waits';
    end if;
    perform public.save_preferences('tasks', null, false, 'board', false);
    perform public.save_preferences('overview', null, false, 'board', false, null, null);
    if (select layouts from public.preferences where owner_id = v_owner) is distinct from '{"tasks": "board", "overview": "board"}'::jsonb then
      raise exception 'the preferences were not saved by both forms';
    end if;
    if public.reset_demo() is not true then
      raise exception 'the demo reset refused';
    end if;
    if exists (select 1 from public.items where owner_id = v_owner) or exists (select 1 from public.task_mail where owner_id = v_owner) then
      raise exception 'the demo did not start over';
    end if;
    raise exception 'the rows of this check leave' using errcode = 'CW001';
  exception when sqlstate 'CW001' then
    null;
  end;
end;
$$;
