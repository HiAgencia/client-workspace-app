-- The notes that were links carry their link as rich text, an `<a href>` the editor shows as a link, instead of the
-- `[words](address)` text the conversion of 20261031010000 wrote into their bodies; their title, the first line of the body,
-- keeps the link as `[words](address)`, which is what a title holds. And the `url` column goes: the addresses live in the
-- text since that conversion, and nothing reads the column anymore.

-- Fixing the bodies is the schema's change, not a person's: it moves neither `updated_at` nor any version.
alter table public.items disable trigger items_set_updated_at;
alter table public.items disable trigger items_record_revision;

-- Only http and https addresses become links, as the rich text allows; the body's text was already escaped for HTML, so
-- the address is written into the attribute as it stands.
update public.items
set body = regexp_replace(body, '\[([^\]<\n]+)\]\((https?://[^)\s"<]+)\)', '<a href="\2">\1</a>', 'g')
where type = 'note' and body ~ '\[[^\]<\n]+\]\(https?://[^)\s"<]+\)';

alter table public.items enable trigger items_set_updated_at;
alter table public.items enable trigger items_record_revision;

-- The versioned columns without the address. The rest is the rule of 20261031000000.
create or replace function public.items_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.title, old.body, old.status, old.priority, old.due_on, old.due_time, old.parent_item_id, old.deleted_at)
     is not distinct from
     (new.title, new.body, new.status, new.priority, new.due_on, new.due_time, new.parent_item_id, new.deleted_at) then
    return null;
  end if;
  insert into public.revisions (item_id, snapshot, source, agent_label)
  values (
    old.id,
    jsonb_build_object(
      'title', old.title, 'body', old.body, 'status', old.status, 'priority', old.priority,
      'due_on', old.due_on, 'due_time', old.due_time, 'parent_item_id', old.parent_item_id, 'deleted_at', old.deleted_at,
      'completed_at', old.completed_at
    ),
    new.changed_source,
    new.changed_agent_label
  );
  return null;
end;
$$;

alter table public.items drop column url;

-- The verification: no note keeps a link as text in its body, and the column is gone.
do $$
begin
  if exists (select 1 from public.items where type = 'note' and body ~ '\[[^\]<\n]+\]\(https?://[^)\s"<]+\)') then
    raise exception 'a note still keeps a link as text in its body';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'url') then
    raise exception 'the url column is still there';
  end if;
end;
$$;
