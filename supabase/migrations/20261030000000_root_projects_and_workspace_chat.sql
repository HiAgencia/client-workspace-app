-- A root is a client or a project of the person's own: whoever has no clients keeps their projects at the root, and an
-- agency keeps its own projects beside its clients. A client is still always a root, a client's child is a project, and
-- a project's or a subproject's child is a subproject (`nodes_check_parent`).
alter table public.nodes drop constraint nodes_root_is_client;
alter table public.nodes add constraint nodes_root_kind check (
  (parent_id is null and kind in ('client', 'project'))
  or (parent_id is not null and kind in ('project', 'subproject'))
);

-- The chat keeps one conversation for the whole workspace beside each node's: a message carries its owner, and its node
-- when it belongs to one. The owner is the signed-in person by default, so every writer stays as it is.
alter table public.chat_messages add column owner_id uuid default auth.uid() references auth.users (id) on delete cascade;
update public.chat_messages c set owner_id = n.owner_id from public.nodes n where n.id = c.node_id;
alter table public.chat_messages
  alter column owner_id set not null,
  alter column node_id drop not null;
create index chat_messages_owner_id_seq_idx on public.chat_messages (owner_id, seq);

drop policy chat_messages_select on public.chat_messages;
drop policy chat_messages_insert on public.chat_messages;
drop policy chat_messages_delete on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (owner_id = (select auth.uid()));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      node_id is null
      or exists (select 1 from public.nodes n where n.id = chat_messages.node_id and n.owner_id = (select auth.uid()))
    )
  );
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (owner_id = (select auth.uid()));
