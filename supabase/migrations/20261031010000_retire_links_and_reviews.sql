-- Links and items to review stop being kinds of their own. A link becomes a note whose text is the link over its words
-- (`[words](address)`), followed by what was written about it; something to review becomes a task, open or done as it
-- was, with its origin, its address over its title. The enum keeps both values —Postgres cannot drop a value from an enum
-- without rewriting every column that uses it—, so a check refuses them on every write. The `url` column is left empty:
-- the address lives in the text now, and the column goes once no running code reads it.

-- `[words](address)`: brackets inside the words and parentheses inside the address would end the link early, so the words
-- trade their brackets for parentheses and the address writes its parentheses percent-encoded.
create function pg_temp.inline_link(p_words text, p_address text)
returns text
language sql
immutable
as $$
  select '[' || replace(replace(btrim(p_words), '[', '('), ']', ')') || '](' || replace(replace(p_address, '(', '%28'), ')', '%29') || ')';
$$;

create function pg_temp.escape_html(p_text text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(p_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- The conversion is the schema's, not a person's change: it moves neither `updated_at` nor any version.
alter table public.items disable trigger items_set_updated_at;
alter table public.items disable trigger items_record_revision;

-- A note has no status: a link marked done becomes an open note.
update public.items
set type = 'note',
    title = pg_temp.inline_link(title, url),
    body = '<p>' || pg_temp.escape_html(pg_temp.inline_link(title, url)) || '</p>' || coalesce(body, ''),
    url = null,
    status = 'open',
    completed_at = null
where type = 'link';

update public.items
set type = 'task',
    title = case when url is null then title else pg_temp.inline_link(title, url) end,
    url = null,
    priority = coalesce(priority, 4)
where type = 'review';

-- Any other item that carried an address keeps it as a last paragraph of its text.
update public.items
set body = coalesce(body, '') || '<p>' || pg_temp.escape_html(pg_temp.inline_link(url, url)) || '</p>',
    url = null
where url is not null;

alter table public.items enable trigger items_set_updated_at;
alter table public.items enable trigger items_record_revision;

alter table public.items
  drop constraint items_link_has_url,
  add constraint items_live_types check (type in ('task', 'note', 'decision'));

-- The verification: no link or item to review is left, and no address is left outside the text.
do $$
begin
  if exists (select 1 from public.items where type::text in ('link', 'review')) then
    raise exception 'a link or an item to review was left unconverted';
  end if;
  if exists (select 1 from public.items where url is not null) then
    raise exception 'an address was left outside the text';
  end if;
end;
$$;
