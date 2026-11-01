-- Closing a task with its result, and taking that closing back, each in one transaction: the task, the decision that holds
-- its result, and the message that answered it change together or not at all. Both run with the caller's rights, so a
-- signed-in person reaches only their own rows, and the owner each names keeps the server's client, which skips row-level
-- security, to them too. `completed_at` stays empty on the write: the database stamps a completion with its own clock.

create function public.complete_task(
  p_owner uuid,
  p_item uuid,
  p_outcome text,
  p_body text,
  p_account uuid,
  p_message text,
  p_source public.item_source,
  p_agent_label text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.items;
  v_decision public.items;
  v_rows integer := 0;
begin
  update public.items
  set status = 'done', completed_at = null, changed_source = p_source, changed_agent_label = p_agent_label
  where id = p_item and owner_id = p_owner and type = 'task' and status = 'open' and deleted_at is null
  returning * into v_task;
  if v_task.id is null then
    return null;
  end if;
  insert into public.items (owner_id, node_id, parent_item_id, type, title, body, source, agent_label, changed_source, changed_agent_label)
  values (p_owner, v_task.node_id, v_task.id, 'decision', p_outcome, p_body, p_source, p_agent_label, p_source, p_agent_label)
  returning * into v_decision;
  if p_account is not null then
    insert into public.mail_links (owner_id, account_id, message_id, item_id)
    values (p_owner, p_account, p_message, v_task.id)
    on conflict (account_id, message_id, item_id) where item_id is not null do nothing;
    get diagnostics v_rows = row_count;
  end if;
  return jsonb_build_object('item', to_jsonb(v_task), 'decision', to_jsonb(v_decision), 'linked', v_rows > 0);
end;
$$;

-- The task opens again, the decision goes with the task's own deletion mark, and the message comes off when the closing
-- linked it. A decision that no longer hangs from the task is left where it is. Returns the task, or nothing when it is gone.
create function public.reopen_task(
  p_owner uuid,
  p_item uuid,
  p_decision uuid,
  p_account uuid,
  p_message text,
  p_source public.item_source,
  p_agent_label text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.items;
begin
  update public.items
  set status = 'open', completed_at = null, changed_source = p_source, changed_agent_label = p_agent_label
  where id = p_item and owner_id = p_owner and type = 'task' and deleted_at is null
  returning * into v_task;
  if v_task.id is null then
    return null;
  end if;
  if exists (select 1 from public.items d where d.id = p_decision and d.parent_item_id = p_item and d.owner_id = p_owner and d.type = 'decision') then
    perform public.delete_item_branch(p_decision, p_source, p_agent_label);
  end if;
  if p_account is not null then
    delete from public.mail_links
    where owner_id = p_owner and account_id = p_account and message_id = p_message and item_id = p_item;
  end if;
  return to_jsonb(v_task);
end;
$$;

revoke execute on function public.complete_task(uuid, uuid, text, text, uuid, text, public.item_source, text),
  public.reopen_task(uuid, uuid, uuid, uuid, text, public.item_source, text) from public, anon;
grant execute on function public.complete_task(uuid, uuid, text, text, uuid, text, public.item_source, text),
  public.reopen_task(uuid, uuid, uuid, uuid, text, public.item_source, text) to authenticated, service_role;

-- The verification: closed to the visitor without a session, and both functions called for real on a person made for it,
-- whose rows leave with the block's own failure.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_task uuid;
  v_closed jsonb;
  v_status text;
begin
  if has_function_privilege('anon', 'public.complete_task(uuid, uuid, text, text, uuid, text, public.item_source, text)', 'execute')
    or has_function_privilege('anon', 'public.reopen_task(uuid, uuid, uuid, uuid, text, public.item_source, text)', 'execute') then
    raise exception 'closing a task is open to anon';
  end if;
  begin
    insert into auth.users (id, aud, role) values (v_owner, 'authenticated', 'authenticated');
    insert into public.items (owner_id, type, title) values (v_owner, 'task', 'A task to close') returning id into v_task;
    v_closed := public.complete_task(v_owner, v_task, 'Approved', null, null, null, 'manual', null);
    if v_closed -> 'item' ->> 'status' is distinct from 'done' or v_closed -> 'item' ->> 'completed_at' is null
      or v_closed -> 'decision' ->> 'title' is distinct from 'Approved' then
      raise exception 'closing a task did not close it: %', v_closed;
    end if;
    if public.complete_task(v_owner, v_task, 'Approved', null, null, null, 'manual', null) is not null then
      raise exception 'a task already done was closed again';
    end if;
    perform public.reopen_task(v_owner, v_task, (v_closed -> 'decision' ->> 'id')::uuid, null, null, 'manual', null);
    select status into v_status from public.items where id = v_task;
    if v_status is distinct from 'open' then
      raise exception 'taking a closing back did not open the task';
    end if;
    if exists (select 1 from public.items where parent_item_id = v_task and deleted_at is null) then
      raise exception 'taking a closing back left its result';
    end if;
    raise exception 'the rows of this check leave' using errcode = 'CW001';
  exception when sqlstate 'CW001' then
    null;
  end;
end;
$$;
