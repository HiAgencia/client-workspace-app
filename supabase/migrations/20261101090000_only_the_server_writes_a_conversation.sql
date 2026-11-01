-- Only the server writes a conversation. The daily cap takes a unit for a person's message and none for a turn going on from a
-- read, and the model is sent what is stored: a row a person could write would go on for free, or would make every later message
-- as large as they liked. A person reads their conversations; the chat's route writes them with its own key and sets the owner.
revoke insert, update, delete on public.chat_messages from authenticated;
drop policy chat_messages_insert on public.chat_messages;
drop policy chat_messages_update on public.chat_messages;
drop policy chat_messages_delete on public.chat_messages;

-- The demo's sample conversations are planted by its seed for the signed-in person. The only text it takes is the zone, which goes as a
-- value and never into a statement, and it writes only for `auth.uid()`, so it may do what the person may not. Its live definition stays the one in
-- 20261101060000_demo_calendars_and_priorities.sql; a later migration that redefines it says `security definer` again, and the
-- check below fails on one that does not.
alter function public.seed_demo(date, text) security definer;

-- The verification: the table reads and nothing more for a person, the seed still plants as that same person, whose own write to
-- the table is refused, and the rows it wrote leave with the block's own failure.
do $$
declare
  v_owner uuid := gen_random_uuid();
begin
  if not has_table_privilege('authenticated', 'public.chat_messages', 'select') then
    raise exception 'a person cannot read their conversations';
  end if;
  if has_table_privilege('authenticated', 'public.chat_messages', 'insert')
    or has_table_privilege('authenticated', 'public.chat_messages', 'update')
    or has_table_privilege('authenticated', 'public.chat_messages', 'delete')
    or has_column_privilege('authenticated', 'public.chat_messages', 'parts', 'update') then
    raise exception 'a person can still write a conversation';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_messages' and policyname <> 'chat_messages_select') then
    raise exception 'chat_messages keeps a policy for writing';
  end if;
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.seed_demo(date, text)'::regprocedure) then
    raise exception 'the seed does not run with its owner''s rights over a fixed search path';
  end if;
  begin
    insert into auth.users (id, aud, role, is_anonymous) values (v_owner, 'authenticated', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'is_anonymous', true)::text, true);
    set local role authenticated;
    if public.seed_demo(date '2026-11-02', 'America/Argentina/Buenos_Aires') is not true then
      raise exception 'the demo was not planted';
    end if;
    if not exists (select 1 from public.chat_messages where owner_id = v_owner and role = 'assistant') then
      raise exception 'the demo planted no conversation';
    end if;
    if exists (select 1 from public.chat_messages where owner_id is distinct from v_owner) then
      raise exception 'a person reads a conversation that is not theirs';
    end if;
    begin
      insert into public.chat_messages (node_id, role, parts) values (null, 'assistant', '[]'::jsonb);
      raise exception 'a person wrote a row of a conversation';
    exception when insufficient_privilege then
      null;
    end;
    raise exception 'the rows of this check leave' using errcode = 'CW001';
  exception when sqlstate 'CW001' then
    null;
  end;
end;
$$;
