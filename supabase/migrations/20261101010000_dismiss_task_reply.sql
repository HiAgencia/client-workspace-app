-- Ruling out a possible reply, or taking it back, in one statement: two clicks at once each keep their own, which a read
-- of the list and a write of it in two steps would lose. It runs with the caller's rights, so a signed-in person reaches
-- only their own waits, and the owner it names keeps the server's client, which skips row-level security, to them too.
create function public.dismiss_task_reply(p_owner uuid, p_item uuid, p_reply text, p_dismissed boolean)
returns text[]
language sql
security invoker
set search_path = ''
as $$
  update public.task_mail
  set dismissed = case
    when p_dismissed then array_append(array_remove(dismissed, p_reply), p_reply)
    else array_remove(dismissed, p_reply)
  end
  where item_id = p_item and owner_id = p_owner
  returning dismissed;
$$;

revoke execute on function public.dismiss_task_reply(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.dismiss_task_reply(uuid, uuid, text, boolean) to authenticated, service_role;

-- The verification: closed to the visitor without a session, open to a signed-in person.
do $$
begin
  if has_function_privilege('anon', 'public.dismiss_task_reply(uuid, uuid, text, boolean)', 'execute') then
    raise exception 'ruling out a reply is open to anon';
  end if;
  if not has_function_privilege('authenticated', 'public.dismiss_task_reply(uuid, uuid, text, boolean)', 'execute') then
    raise exception 'a signed-in person cannot rule out a reply';
  end if;
end;
$$;
