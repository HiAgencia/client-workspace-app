-- A turn that stopped at a read the browser makes goes on over its own row: taking it writes the read's answers there, so a
-- turn cut short keeps what it already did, and it keeps its place in the conversation. Only the parts of a person's own
-- messages change.
grant update (parts) on public.chat_messages to authenticated;
create policy chat_messages_update on public.chat_messages for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

do $$
begin
  if not has_column_privilege('authenticated', 'public.chat_messages', 'parts', 'UPDATE') then
    raise exception 'authenticated cannot update the parts of a message';
  end if;
  if has_column_privilege('authenticated', 'public.chat_messages', 'owner_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.chat_messages', 'node_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.chat_messages', 'role', 'UPDATE') then
    raise exception 'authenticated can update more of a message than its parts';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'chat_messages_update') then
    raise exception 'chat_messages has no update policy';
  end if;
end $$;
