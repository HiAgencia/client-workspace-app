"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { post, type TreeNode } from "./client-api";
import { requestFocus } from "./focus-request";
import { useWorkspace } from "./workspace";

// The client → project → subproject tree with open counts, and creation in place: a new node is typed where it
// will live, Enter creates it and opens it, Esc cancels.
export function Tree() {
  const { tree, treeError } = useWorkspace();
  const [adding, setAdding] = useState<string | "root" | null>(null);

  const children = (parentId: string | null) => (tree ?? []).filter((node) => node.parentId === parentId);

  function branch(parentId: string | null) {
    const nodes = children(parentId);
    return (
      <ul className="tree">
        {nodes.map((node) => (
          <li key={node.id}>
            <Row node={node} onAdd={() => setAdding(node.id)} />
            {adding === node.id && (
              <div className="tree-new">
                <NewNode parent={node} onDone={() => setAdding(null)} />
              </div>
            )}
            {children(node.id).length > 0 && branch(node.id)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="side-group" aria-labelledby="projects-title">
      <div className="side-head">
        <h2 id="projects-title" className="t-label">
          Projects
        </h2>
        <Button variant="quiet" size="sm" className="tree-add" onClick={() => setAdding("root")}>
          New client
        </Button>
      </div>
      {adding === "root" && (
        <div className="tree-new">
          <NewNode onDone={() => setAdding(null)} />
        </div>
      )}
      {tree === null ? (
        <TreeSkeleton failed={treeError} />
      ) : tree.length === 0 ? (
        adding !== "root" && (
          <div className="empty">
            <p className="t-help">No clients yet. A client holds its projects.</p>
            <Button size="sm" variant="primary" onClick={() => setAdding("root")}>
              Add the first client
            </Button>
          </div>
        )
      ) : (
        <div className="fade-enter">{branch(null)}</div>
      )}
      {tree !== null && treeError && (
        <p role="alert" className="inline-note" data-tone="alert">
          The projects could not be refreshed: {treeError}. What you see is the last list read.
        </p>
      )}
    </section>
  );
}

function TreeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <p role="alert" className="inline-note" data-tone="alert">
        The projects could not be read: {failed}. Reload the page to try again.
      </p>
    );
  }
  return (
    <div className="stack" role="status" aria-label="Loading projects" aria-busy="true">
      {["62%", "48%", "54%", "40%"].map((width, index) => (
        <span key={index} className="skeleton" style={{ width, marginLeft: index % 2 ? "1.4rem" : "0.6rem" }} />
      ))}
    </div>
  );
}

function Row({ node, onAdd }: { node: TreeNode; onAdd: () => void }) {
  const pathname = usePathname();
  const current = pathname === `/app/node/${node.id}` || pathname.startsWith(`/app/node/${node.id}/`);
  const open = node.openTasks + node.openReviews;
  const child = node.kind === "client" ? "project" : "subproject";
  return (
    <div className="tree-row" data-node={node.id}>
      <Link
        href={`/app/node/${node.id}`}
        className="side-link"
        aria-current={current ? "page" : undefined}
        onClick={() => requestFocus({ kind: "node", nodeId: node.id })}
      >
        <span className="side-link-name">{node.name}</span>
        {open > 0 && (
          <span className="count" aria-label={`${node.openTasks} open tasks, ${node.openReviews} to review`}>
            {open}
          </span>
        )}
      </Link>
      {/* Adding under a node is offered where the person is: the open node carries it on its own line, so every name
          keeps its whole width. */}
      {current && (
        <Button variant="quiet" size="sm" className="tree-add tree-add-child" onClick={onAdd} aria-label={`Add a ${child} under ${node.name}`}>
          Add a {child}
        </Button>
      )}
    </div>
  );
}

function NewNode({ parent, onDone }: { parent?: TreeNode; onDone: () => void }) {
  const { saving } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const what = !parent ? "client" : parent.kind === "client" ? "project" : "subproject";
  // One field, one outcome: Enter creates once, Escape cancels, and the blur that follows either does nothing.
  const settled = useRef(false);

  async function create() {
    if (settled.current) return;
    settled.current = true;
    if (!name.trim()) return onDone();
    const answer = await post<{ node: { id: string } }>("/api/nodes", { name, parent: parent?.id });
    if (await saving(Promise.resolve(answer))) {
      onDone();
      if (answer.ok) {
        requestFocus({ kind: "node", nodeId: answer.node.id });
        router.push(`/app/node/${answer.node.id}`);
      }
    } else settled.current = false;
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void create();
    if (event.key === "Escape") {
      // The field's own Escape: it does not also close the drawer around it.
      event.preventDefault();
      event.stopPropagation();
      settled.current = true;
      onDone();
    }
  }

  return (
    <Field
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
