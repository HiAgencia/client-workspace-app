-- The node side of a connect link gets its own index, so deleting a node does not scan the links table.

create index google_connect_links_node on public.google_connect_links (node_id);
