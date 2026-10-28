-- The note is an item of its own. A new enum value cannot be used in the transaction that adds it, so it goes alone,
-- before the migration whose constraints and functions name it.
alter type public.item_type add value if not exists 'note';
