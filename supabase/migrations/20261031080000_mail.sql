-- The mail of the connected accounts, to correlate with the work, not to replace the mail client. The messages themselves
-- come from a source the tools are given: Gmail for a real account, and for the demo's sample accounts the rows of
-- `demo_mail`, kept apart from every real datum. What this product keeps of its own is what it adds: a message linked to a
-- task, a client, or a project (`mail_links`); what the person opened here (`mail_opened`), since a read-only access cannot
-- mark a message read in Gmail; and the mail a task waits for (`task_mail`), with the state the daily review wrote.

-- The demo's sample messages, one row per message of a sample account, with the fields Gmail gives a message.
create table public.demo_mail (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.google_accounts (id) on delete cascade,
  -- The message's and its thread's ids, as Gmail names them.
  gmail_id text not null default ('demo-' || replace(gen_random_uuid()::text, '-', '')),
  thread_id text not null default ('demo-' || replace(gen_random_uuid()::text, '-', '')),
  from_name text,
  from_email text not null,
  to_emails text[] not null default '{}',
  subject text not null default '',
  snippet text not null default '',
  html text,
  text_body text,
  received_at timestamptz not null,
  unread boolean not null default true,
  important boolean not null default false,
  created_at timestamptz not null default now(),
  constraint demo_mail_account_message_key unique (account_id, gmail_id)
);

create index demo_mail_owner_id_received_at_idx on public.demo_mail (owner_id, received_at desc);

-- A message linked to a task or to a client or project; each pair once.
create table public.mail_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.google_accounts (id) on delete cascade,
  message_id text not null,
  item_id uuid references public.items (id) on delete cascade,
  node_id uuid references public.nodes (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint mail_links_one_target check ((item_id is null) <> (node_id is null))
);

create index mail_links_owner_id_idx on public.mail_links (owner_id);
create index mail_links_account_message_idx on public.mail_links (account_id, message_id);
create index mail_links_item_id_idx on public.mail_links (item_id);
create index mail_links_node_id_idx on public.mail_links (node_id);
create unique index mail_links_item_key on public.mail_links (account_id, message_id, item_id) where item_id is not null;
create unique index mail_links_node_key on public.mail_links (account_id, message_id, node_id) where node_id is not null;

-- What the person opened here.
create table public.mail_opened (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.google_accounts (id) on delete cascade,
  message_id text not null,
  opened_at timestamptz not null default now(),
  primary key (account_id, message_id)
);

create index mail_opened_owner_id_idx on public.mail_opened (owner_id);

-- The mail a task waits for: in one account, or in every account of its place when none is named, optionally from a
-- sender; and what the daily review wrote about it.
create table public.task_mail (
  item_id uuid primary key references public.items (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid references public.google_accounts (id) on delete set null,
  -- Who the message comes from, as the person or the chat said it: words of the sender's name or address.
  expect_from text check (expect_from is null or length(btrim(expect_from)) between 1 and 200),
  -- waiting: nothing that answers it yet; met: a message did what the task waits for; not_met: one arrived and did not.
  status text not null default 'waiting' check (status in ('waiting', 'met', 'not_met')),
  sentence text check (sentence is null or length(sentence) <= 1000),
  -- The message that decided the state.
  decided_account_id uuid references public.google_accounts (id) on delete set null,
  decided_message_id text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_mail_decided_together check ((decided_account_id is null) = (decided_message_id is null))
);

create index task_mail_owner_id_idx on public.task_mail (owner_id);
create index task_mail_account_id_idx on public.task_mail (account_id);
create index task_mail_decided_account_id_idx on public.task_mail (decided_account_id);

create trigger task_mail_set_updated_at before update on public.task_mail
  for each row execute function public.set_updated_at();

-- Row-level security: one policy per command.
alter table public.demo_mail enable row level security;
alter table public.mail_links enable row level security;
alter table public.mail_opened enable row level security;
alter table public.task_mail enable row level security;

-- The sample messages are read by their owner and written by the seed alone.
create policy demo_mail_select on public.demo_mail for select to authenticated
  using (owner_id = (select auth.uid()));

create policy mail_links_select on public.mail_links for select to authenticated
  using (owner_id = (select auth.uid()));
create policy mail_links_insert on public.mail_links for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.google_accounts g where g.id = mail_links.account_id and g.owner_id = (select auth.uid()))
    and (
      (mail_links.item_id is not null and exists (
        select 1 from public.items i where i.id = mail_links.item_id and i.owner_id = (select auth.uid())
      ))
      or (mail_links.node_id is not null and exists (
        select 1 from public.nodes n where n.id = mail_links.node_id and n.owner_id = (select auth.uid())
      ))
    )
  );
create policy mail_links_delete on public.mail_links for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy mail_opened_select on public.mail_opened for select to authenticated
  using (owner_id = (select auth.uid()));
create policy mail_opened_insert on public.mail_opened for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.google_accounts g where g.id = mail_opened.account_id and g.owner_id = (select auth.uid()))
  );
create policy mail_opened_delete on public.mail_opened for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy task_mail_select on public.task_mail for select to authenticated
  using (owner_id = (select auth.uid()));
create policy task_mail_insert on public.task_mail for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = task_mail.item_id and i.type = 'task' and i.owner_id = (select auth.uid()))
    and (task_mail.account_id is null or exists (
      select 1 from public.google_accounts g where g.id = task_mail.account_id and g.owner_id = (select auth.uid())
    ))
  );
create policy task_mail_update on public.task_mail for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (task_mail.account_id is null or exists (
      select 1 from public.google_accounts g where g.id = task_mail.account_id and g.owner_id = (select auth.uid())
    ))
    and (task_mail.decided_account_id is null or exists (
      select 1 from public.google_accounts g where g.id = task_mail.decided_account_id and g.owner_id = (select auth.uid())
    ))
  );
create policy task_mail_delete on public.task_mail for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.demo_mail, public.mail_links, public.mail_opened, public.task_mail from anon, authenticated, public;
grant select on public.demo_mail to authenticated;
grant select, insert, delete on public.mail_links to authenticated;
grant select, insert, delete on public.mail_opened to authenticated;
-- The task, the owner, and the moments are not the person's to rewrite; what the task waits for and its state are.
grant select, insert, delete on public.task_mail to authenticated;
grant update (account_id, expect_from, status, sentence, decided_account_id, decided_message_id, checked_at) on public.task_mail
  to authenticated;
grant select, insert, update, delete on public.demo_mail, public.mail_links, public.mail_opened, public.task_mail to service_role;

-- The demo's sample accounts and their messages. The signed-in role writes no account —the server does, holding the
-- tokens—, so the seed plants the sample ones through this function, which writes only for the signed-in person, only
-- accounts marked as the demo's and without tokens, and only once per person. It returns each account's id by its address.
create function public.plant_demo_accounts(p_accounts jsonb)
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
  if v_owner is null then
    raise exception 'the demo accounts need a signed-in session' using errcode = '42501';
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

-- The sample messages of the signed-in person's sample accounts, written by the seed.
create function public.plant_demo_mail(p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
begin
  if v_owner is null then
    raise exception 'the demo mail needs a signed-in session' using errcode = '42501';
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

revoke execute on function public.plant_demo_accounts(jsonb), public.plant_demo_mail(jsonb) from public, anon;
grant execute on function public.plant_demo_accounts(jsonb), public.plant_demo_mail(jsonb) to authenticated;

-- The verification: the four tables are closed to the visitor without a session, and the demo's functions to anon.
do $$
begin
  if has_table_privilege('anon', 'public.demo_mail', 'select') or has_table_privilege('anon', 'public.task_mail', 'select') then
    raise exception 'the mail tables are open to anon';
  end if;
  if has_function_privilege('anon', 'public.plant_demo_accounts(jsonb)', 'execute') then
    raise exception 'the demo accounts are open to anon';
  end if;
end;
$$;
