-- The daily review made safe to call. A run counts as the day's once it finishes (`finished_at`): one that stopped is
-- resumed by the next call of the same day instead of consuming it. Each thing it does is written with its action in one
-- statement, so no task is ever left completed by the review without the row that undoes it. A run read with Meta's model
-- takes a unit of the person's day (`usage_counters`, kind `daily_review`). A person's preferences are written key by
-- key, so two changes at once both stay. The demo's sample accounts are planted only for a demo (anonymous) session. And
-- the composite keys of a node's rows get the index that serves them, so deleting a node does not walk the table.

-- The review's unit of the day.
alter table public.usage_counters drop constraint usage_counters_kind_check;
alter table public.usage_counters add constraint usage_counters_kind_check check (kind in ('chat_message', 'transcription', 'daily_review'));

-- A run counts once it finishes, and says how many of its steps failed.
alter table public.daily_reviews
  add column finished_at timestamptz,
  add column failures integer not null default 0 check (failures >= 0);
-- The runs written before this migration all ran whole.
update public.daily_reviews set finished_at = created_at where finished_at is null;

create policy daily_reviews_update on public.daily_reviews for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
grant update (finished_at, failures) on public.daily_reviews to authenticated;

-- Writing the state of a task's mail and its action, together. Returns the action, or nothing when the task no longer
-- waits for mail. With the caller's rights: the policies keep it to the caller's run and task.
create function public.review_write_mail_status(
  p_review uuid,
  p_item uuid,
  p_status text,
  p_sentence text,
  p_account uuid,
  p_message text
)
returns setof public.review_actions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
begin
  select jsonb_build_object('status', t.status, 'sentence', t.sentence, 'decided_account_id', t.decided_account_id,
      'decided_message_id', t.decided_message_id, 'checked_at', t.checked_at)
  into v_before
  from public.task_mail t where t.item_id = p_item for update;
  if v_before is null then
    return;
  end if;
  update public.task_mail
  set status = p_status, sentence = p_sentence, decided_account_id = p_account, decided_message_id = p_message, checked_at = v_now
  where item_id = p_item;
  v_after := jsonb_build_object('status', p_status, 'sentence', p_sentence, 'decided_account_id', p_account,
    'decided_message_id', p_message, 'checked_at', v_now);
  return query
    insert into public.review_actions (review_id, owner_id, item_id, kind, before, after)
    values (p_review, (select auth.uid()), p_item, 'mail_status', v_before, v_after)
    returning *;
end;
$$;

-- Completing a reviewed task and its action, together. Returns the action, or nothing when the task was no longer open.
create function public.review_complete_task(p_review uuid, p_item uuid)
returns setof public.review_actions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_done timestamptz;
begin
  update public.items
  set status = 'done', completed_at = now(), changed_source = 'review', changed_agent_label = null
  where id = p_item and status = 'open' and deleted_at is null
  returning completed_at into v_done;
  if v_done is null then
    return;
  end if;
  return query
    insert into public.review_actions (review_id, owner_id, item_id, kind, before, after)
    values (p_review, (select auth.uid()), p_item, 'complete', jsonb_build_object('status', 'open', 'completed_at', null),
      jsonb_build_object('status', 'done', 'completed_at', v_done))
    returning *;
end;
$$;

-- A person's preferences, one key at a time: what is not part of this change stays as the database holds it, whatever
-- another change wrote a moment ago. A null page leaves boards and layouts alone; `p_board_clear` and `p_layout_clear`
-- forget a page.
create function public.save_preferences(
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
as $$
  insert into public.preferences as p (owner_id, boards, layouts, daily_review, daily_review_instruction)
  values (
    (select auth.uid()),
    case when p_page is not null and p_board is not null then jsonb_build_object(p_page, p_board) else '{}'::jsonb end,
    case when p_page is not null and p_layout is not null then jsonb_build_object(p_page, to_jsonb(p_layout)) else '{}'::jsonb end,
    coalesce(p_daily_review, true),
    coalesce(p_instruction, 'Review my tasks for today and the mail they wait for.')
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
        else p.layouts end,
      daily_review = coalesce(p_daily_review, p.daily_review),
      daily_review_instruction = coalesce(p_instruction, p.daily_review_instruction)
  returning p.*;
$$;

revoke execute on function public.review_write_mail_status(uuid, uuid, text, text, uuid, text), public.review_complete_task(uuid, uuid),
  public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text) from public, anon;
grant execute on function public.review_write_mail_status(uuid, uuid, text, text, uuid, text), public.review_complete_task(uuid, uuid),
  public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text) to authenticated;

-- The demo's sample accounts and messages: only for a demo session. The rest is the rule of 20261031080000.
create or replace function public.plant_demo_accounts(p_accounts jsonb)
returns table (account_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_entry jsonb;
  v_account uuid;
  v_node uuid;
begin
  if v_owner is null or not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'the demo accounts are planted only for a demo session' using errcode = '42501';
  end if;
  if exists (select 1 from public.google_accounts g where g.owner_id = v_owner and g.is_demo) then
    return;
  end if;
  for v_entry in select * from jsonb_array_elements(p_accounts) loop
    v_node := (v_entry ->> 'node_id')::uuid;
    if not exists (select 1 from public.nodes n where n.id = v_node and n.owner_id = v_owner) then
      raise exception 'node % is not the signed-in person''s', v_node using errcode = '42501';
    end if;
    insert into public.google_accounts (owner_id, email, scopes, is_demo, created_at, updated_at)
    values (v_owner, v_entry ->> 'email', array['https://www.googleapis.com/auth/gmail.readonly'], true,
      coalesce((v_entry ->> 'at')::timestamptz, now()), coalesce((v_entry ->> 'at')::timestamptz, now()))
    returning id into v_account;
    insert into public.node_accounts (node_id, account_id) values (v_node, v_account);
    account_id := v_account;
    email := v_entry ->> 'email';
    return next;
  end loop;
end;
$$;

create or replace function public.plant_demo_mail(p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
begin
  if v_owner is null or not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'the demo mail is planted only for a demo session' using errcode = '42501';
  end if;
  insert into public.demo_mail (owner_id, account_id, from_name, from_email, to_emails, subject, snippet, html, text_body,
    received_at, unread, important)
  select v_owner, g.id, m ->> 'from_name', m ->> 'from_email',
    array(select jsonb_array_elements_text(coalesce(m -> 'to', '[]'::jsonb))),
    coalesce(m ->> 'subject', ''), coalesce(m ->> 'snippet', ''), m ->> 'html', m ->> 'text',
    (m ->> 'received_at')::timestamptz, coalesce((m ->> 'unread')::boolean, true), coalesce((m ->> 'important')::boolean, false)
  from jsonb_array_elements(p_messages) m
  join public.google_accounts g on g.id = (m ->> 'account_id')::uuid and g.owner_id = v_owner and g.is_demo;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The manual order of a group, dealt out by the database: the places the group already holds, lowest first, go to its
-- items in the order given. The positions never travel through a client's numbers, which hold fewer digits than a
-- position written by the clock, so nothing is rounded and nothing outside the group moves.
create function public.reorder_item_positions(p_items uuid[])
returns setof public.items
language sql
security invoker
set search_path = ''
as $$
  with wanted as (
    select w.id, w.ord from unnest(p_items) with ordinality as w (id, ord)
  ), held as (
    select i.id, i.position from public.items i join wanted w on w.id = i.id where i.deleted_at is null
  ), slots as (
    select h.position, row_number() over (order by h.position, h.id) as ord from held h
  ), placed as (
    select w.id, s.position
    from (select wanted.id, row_number() over (order by wanted.ord) as ord from wanted join held on held.id = wanted.id) w
    join slots s on s.ord = w.ord
  )
  update public.items i
  set position = placed.position
  from placed
  where i.id = placed.id
  returning i.*;
$$;

revoke execute on function public.reorder_item_positions(uuid[]) from public, anon;
grant execute on function public.reorder_item_positions(uuid[]) to authenticated, service_role;

-- The composite keys of a node's rows, served by an index that leads with them.
create index items_node_id_owner_id_idx on public.items (node_id, owner_id);
create index events_node_id_owner_id_idx on public.events (node_id, owner_id);

do $$
begin
  if exists (select 1 from public.daily_reviews where finished_at is null) then
    raise exception 'a run written before was left unfinished';
  end if;
  if has_function_privilege('anon', 'public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text)', 'execute') then
    raise exception 'the preferences are open to anon';
  end if;
end;
$$;
