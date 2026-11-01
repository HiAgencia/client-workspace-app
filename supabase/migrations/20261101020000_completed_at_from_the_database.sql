-- A completion carries the database's clock, like `updated_at`: "what changed since" compares it with a moment the database
-- wrote, so a writer whose clock runs behind would read a completion as a plain change. The writer says the item is done and
-- leaves the moment empty; a moment it does give, as a restored version does, stays.
create function public.items_stamp_completed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger items_stamp_completed before update of status, completed_at on public.items
  for each row execute function public.items_stamp_completed();

revoke execute on function public.items_stamp_completed() from public, anon, authenticated, service_role;

-- The verification: the trigger is in place and enabled, and no API role calls the function directly.
do $$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgname = 'items_stamp_completed' and t.tgrelid = 'public.items'::regclass and t.tgenabled = 'O'
  ) then
    raise exception 'a completion would not get the database''s clock: items_stamp_completed is missing or disabled';
  end if;
  if has_function_privilege('anon', 'public.items_stamp_completed()', 'execute')
    or has_function_privilege('authenticated', 'public.items_stamp_completed()', 'execute')
    or has_function_privilege('service_role', 'public.items_stamp_completed()', 'execute') then
    raise exception 'items_stamp_completed is open to an API role';
  end if;
end;
$$;
