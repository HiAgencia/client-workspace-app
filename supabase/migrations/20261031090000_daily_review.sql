-- The daily review: each run with its instruction, the person's day it ran for, and the tasks it looked at; and each
-- thing it did with what was there before, so every action has its undo. A run is once per person and day unless it is
-- asked for again on purpose (the chat's "Review my day").

create table public.daily_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  instruction text not null check (length(btrim(instruction)) between 1 and 2000),
  -- Asked for on purpose, beside the day's own run.
  requested boolean not null default false,
  task_ids uuid[] not null default '{}',
  -- Which judge read the mail: the simulated rules or the model.
  provider text not null check (provider in ('simulated', 'meta')),
  created_at timestamptz not null default now()
);

create index daily_reviews_owner_id_day_idx on public.daily_reviews (owner_id, day);
-- The day's own run happens once; a run asked for on purpose is a row of its own.
create unique index daily_reviews_one_per_day on public.daily_reviews (owner_id, day) where not requested;

create table public.review_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.daily_reviews (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  -- mail_status: the state of the mail a task waits for; complete: the task was completed.
  kind text not null check (kind in ('mail_status', 'complete')),
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create index review_actions_review_id_idx on public.review_actions (review_id);
create index review_actions_owner_id_created_at_idx on public.review_actions (owner_id, created_at desc);
create index review_actions_item_id_idx on public.review_actions (item_id);

alter table public.daily_reviews enable row level security;
alter table public.review_actions enable row level security;

create policy daily_reviews_select on public.daily_reviews for select to authenticated
  using (owner_id = (select auth.uid()));
create policy daily_reviews_insert on public.daily_reviews for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy review_actions_select on public.review_actions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy review_actions_insert on public.review_actions for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.daily_reviews r where r.id = review_actions.review_id and r.owner_id = (select auth.uid()))
    and exists (select 1 from public.items i where i.id = review_actions.item_id and i.owner_id = (select auth.uid()))
  );
create policy review_actions_update on public.review_actions for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.daily_reviews, public.review_actions from anon, authenticated, public;
grant select, insert on public.daily_reviews to authenticated;
grant select, insert on public.review_actions to authenticated;
-- An action is only ever marked undone.
grant update (undone_at) on public.review_actions to authenticated;
grant select, insert, update, delete on public.daily_reviews, public.review_actions to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.daily_reviews', 'select') or has_table_privilege('anon', 'public.review_actions', 'select') then
    raise exception 'the review tables are open to anon';
  end if;
end;
$$;
