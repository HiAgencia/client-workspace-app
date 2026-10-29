-- The daily review is a writer of its own: what it completes says it was the review, as an item says the chat or an
-- agent. A new enum value cannot be used in the transaction that adds it, so it goes alone, before the migrations that
-- name it.
alter type public.item_source add value if not exists 'review';
