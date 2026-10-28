-- Moving a task to another event replaces its link in one write (an upsert on the task), so the link is updated in place:
-- the signed-in role gets the update, under the same conditions as the insert —its own task, and its own event or
-- account—.
create policy item_events_update on public.item_events for update to authenticated
  using (exists (
    select 1 from public.items i join public.nodes n on n.id = i.node_id
    where i.id = item_events.item_id and n.owner_id = (select auth.uid())
  ))
  with check (
    exists (
      select 1 from public.items i join public.nodes n on n.id = i.node_id
      where i.id = item_events.item_id and i.type = 'task' and n.owner_id = (select auth.uid())
    )
    and (
      (item_events.event_id is not null and exists (
        select 1 from public.events e join public.nodes n on n.id = e.node_id
        where e.id = item_events.event_id and n.owner_id = (select auth.uid())
      ))
      or (item_events.account_id is not null and exists (
        select 1 from public.google_accounts g
        where g.id = item_events.account_id and g.owner_id = (select auth.uid())
      ))
    )
  );

grant update on public.item_events to authenticated, service_role;
