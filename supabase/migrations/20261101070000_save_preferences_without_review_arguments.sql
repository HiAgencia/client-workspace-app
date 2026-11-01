-- The second step of `save_preferences`: once no served build sends the two arguments the daily review left, the function
-- that takes them goes, and the one that takes a page's boxes and layout stays. PostgREST picks a function by the names of
-- its arguments, which is why both lived side by side until now.
drop function public.save_preferences(text, jsonb, boolean, text, boolean, boolean, text);

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_preferences') <> 1 then
    raise exception 'save_preferences is not left with its one form';
  end if;
  if not has_function_privilege('authenticated', 'public.save_preferences(text, jsonb, boolean, text, boolean)', 'execute') then
    raise exception 'a signed-in person cannot save their preferences';
  end if;
end;
$$;
