-- A client or a project may carry a color the person gives it, from the product's closed palette (role names the theme
-- paints, never values); a node without one shows its nearest ancestor's when it is read. Each person keeps one row of
-- preferences: the order of the boxes on each page, list or board on each page, and the daily review with its
-- instruction. The saved views go: with one place filter and one account filter on top, a page needs no named views.

alter table public.nodes
  add column color text,
  add constraint nodes_color_palette check (
    color is null or color in ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'gray')
  );

create table public.preferences (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Per page ("overview", "tasks", "node:<id>"): the order of its boxes and the ones hidden.
  boards jsonb not null default '{}'::jsonb check (jsonb_typeof(boards) = 'object'),
  -- Per page: "list" or "board".
  layouts jsonb not null default '{}'::jsonb check (jsonb_typeof(layouts) = 'object'),
  daily_review boolean not null default true,
  daily_review_instruction text not null default 'Review my tasks for today and the mail they wait for.'
    check (length(btrim(daily_review_instruction)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger preferences_set_updated_at before update on public.preferences
  for each row execute function public.set_updated_at();

alter table public.preferences enable row level security;

create policy preferences_select on public.preferences for select to authenticated
  using (owner_id = (select auth.uid()));
create policy preferences_insert on public.preferences for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy preferences_update on public.preferences for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy preferences_delete on public.preferences for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.preferences from anon, authenticated, public;
grant select, insert, update, delete on public.preferences to authenticated, service_role;

drop table public.saved_views;

-- The verification: the palette refuses a value outside it, and the saved views are gone.
do $$
begin
  if to_regclass('public.saved_views') is not null then
    raise exception 'the saved views are still there';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'nodes_color_palette' and conrelid = 'public.nodes'::regclass
  ) then
    raise exception 'the palette check is missing';
  end if;
end;
$$;
