"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { post, type TreeNode } from "./client-api";
import { useWorkspace } from "./workspace";

// The client → project → subproject tree with open counts, and creation in place: a new node is typed where it
// will live, Enter creates it and opens it, Esc cancels.
export function Tree() {
  const { tree, treeError } = useWorkspace();
  const [adding, setAdding] = useState<string | "root" | null>(null);

  if (tree === null) {
    return <p aria-busy="true">{treeError ? `The projects could not be read: ${treeError}` : "Loading projects…"}</p>;
  }

  const children = (parentId: string | null) => tree.filter((node) => node.parentId === parentId);

  function branch(parentId: string | null) {
    const nodes = children(parentId);
    return (
      <ul className="flex flex-col gap-1 pl-3">
        {nodes.map((node) => (
          <li key={node.id}>
            <Row node={node} onAdd={() => setAdding(node.id)} />
            {adding === node.id && <NewNode parent={node} onDone={() => setAdding(null)} />}
            {children(node.id).length > 0 && branch(node.id)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Projects">
      {tree.length === 0 ? (
        <p>No clients yet. Add the first one to start.</p>
      ) : (
        branch(null)
      )}
      {treeError && <p role="alert">The projects could not be refreshed: {treeError}</p>}
      {adding === "root" ? (
        <NewNode onDone={() => setAdding(null)} />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding("root")}>
          New client
        </Button>
      )}
    </section>
  );
}

function Row({ node, onAdd }: { node: TreeNode; onAdd: () => void }) {
  const pathname = usePathname();
  const current = pathname.startsWith(`/app/node/${node.id}`);
  const open = node.openTasks + node.openReviews;
  return (
    <div className="flex items-center gap-2" data-node={node.id}>
      <Link href={`/app/node/${node.id}`} aria-current={current ? "page" : undefined} className={current ? "font-semibold" : undefined}>
        {node.name}
      </Link>
      {open > 0 && <span aria-label={`${node.openTasks} open tasks, ${node.openReviews} to review`}>{open}</span>}
      <Button variant="ghost" size="xs" onClick={onAdd} aria-label={`Add a ${node.kind === "client" ? "project" : "subproject"} under ${node.name}`}>
        Add
      </Button>
    </div>
  );
}

function NewNode({ parent, onDone }: { parent?: TreeNode; onDone: () => void }) {
  const { saving } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const what = !parent ? "client" : parent.kind === "client" ? "project" : "subproject";

  async function create() {
    if (!name.trim()) return onDone();
    const request = post<{ node: { id: string } }>("/api/nodes", { name, parent: parent?.id });
    const answer = await request;
    if (await saving(Promise.resolve(answer))) {
      onDone();
      if (answer.ok) router.push(`/app/node/${answer.node.id}`);
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void create();
    if (event.key === "Escape") onDone();
  }

  return (
    <Input
      autoFocus
      aria-label={`New ${what} name`}
      placeholder={`New ${what} name`}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={onKey}
      onBlur={() => void create()}
    />
  );
}
