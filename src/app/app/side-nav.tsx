"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { usePiece } from "@/components/ui/use-piece";
import { post, type TreeNode } from "./client-api";
import { plainClick, requestFocus } from "./focus-request";
import { useWorkspace } from "./workspace";

// The sidebar: its options never change. Overview on top; Clients and Projects, each a group that folds, with its own
// "New" always in view; each client and each project folds its own children; and at the foot Calendar, Trash and
// Settings. The same content serves the wide sidebar and the phone's drawer, with ONE piece marking where the person is
// in each part.
export function SideNav() {
  const pathname = usePathname();
  const main = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  usePiece(main, '[aria-current="page"]');
  usePiece(foot, '[aria-current="page"]');
  const here = (path: string) => (pathname === path ? "page" : undefined);
  return (
    <nav className="side-nav" aria-label="Workspace">
      <div className="side-scroll">
        <div ref={main} className="side-main side-pieces">
          <Link href="/app" className="side-link" aria-current={here("/app")}>
            <span className="side-link-name">Overview</span>
          </Link>
          <NodeGroup kind="client" />
          <NodeGroup kind="project" />
        </div>
      </div>
      <div ref={foot} className="side-foot side-pieces">
        <Link href="/app/calendar" className="side-link" aria-current={here("/app/calendar")}>
          <span className="side-link-name">Calendar</span>
        </Link>
        <Link href="/app/trash" className="side-link" aria-current={here("/app/trash")}>
          <span className="side-link-name">Trash</span>
        </Link>
        <Link href="/app/settings" className="side-link" aria-current={here("/app/settings")}>
          <span className="side-link-name">Settings</span>
        </Link>
      </div>
    </nav>
  );
}

// What is folded open is kept in the browser: a group or a node stays as the person left it. Groups start open, nodes
// closed; the node being visited and its ancestors open on their own.
const OPEN_KEY = "client-workspace:side-open";
const OPEN_EVENT = "client-workspace:side-open";

function subscribeOpen(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(OPEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(OPEN_EVENT, onChange);
  };
}

function readOpen(raw: string | null): Record<string, boolean> {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpen(change: Record<string, boolean>) {
  const next = { ...readOpen(localStorage.getItem(OPEN_KEY)), ...change };
  localStorage.setItem(OPEN_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function useOpenState(): Record<string, boolean> {
  const raw = useSyncExternalStore(subscribeOpen, () => localStorage.getItem(OPEN_KEY), () => null);
  return useMemo(() => readOpen(raw), [raw]);
}

function useCurrentNode(): string | null {
  return usePathname().match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
}

function NodeGroup({ kind }: { kind: "client" | "project" }) {
  const { tree, treeError } = useWorkspace();
  const openState = useOpenState();
  const current = useCurrentNode();
  const [adding, setAdding] = useState(false);
  const key = `group:${kind}`;
  const open = openState[key] ?? true;
  const roots = (tree ?? []).filter((node) => node.parentId === null && node.kind === kind);
  const title = kind === "client" ? "Clients" : "Projects";
  const add = kind === "client" ? "New client" : "New project";

  // Visiting a node opens the way to it, so where the person is always shows in the sidebar. Once per visit: a re-read of
  // the tree after a change does not reopen what the person folded meanwhile.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    // Leaving every node ends the visit: coming back to the same one opens its way again.
    if (!current) {
      opened.current = null;
      return;
    }
    if (!tree || opened.current === current) return;
    const chain: Record<string, boolean> = {};
    for (let cursor = tree.find((n) => n.id === current); cursor; cursor = tree.find((n) => n.id === cursor!.parentId)) chain[cursor.id] = true;
    if (Object.keys(chain).length === 0) return;
    opened.current = current;
    const root = Object.keys(chain).map((id) => tree.find((n) => n.id === id)!).find((n) => n.parentId === null);
    if (root?.kind !== kind) return;
    // Only what is still folded is written: the node itself opens too, so its children are in view.
    const state = readOpen(localStorage.getItem(OPEN_KEY));
    const change = Object.fromEntries(Object.keys(chain).filter((id) => state[id] !== true).map((id) => [id, true]));
    if (state[key] === false) change[key] = true;
    if (Object.keys(change).length > 0) writeOpen(change);
  }, [current, tree, kind, key]);

  return (
    <section className="side-group" aria-labelledby={`side-${kind}`} data-side-group={kind}>
      <div className="side-head">
        <button
          type="button"
          id={`side-${kind}`}
          className="side-toggle"
          aria-expanded={open}
          aria-controls={`side-${kind}-list`}
          onClick={() => writeOpen({ [key]: !open })}
        >
          <span className="side-toggle-name">{title}</span>
        </button>
        <Button
          variant="quiet"
          size="sm"
          className="tree-add"
          data-side-add={kind}
          onClick={() => {
            if (!open) writeOpen({ [key]: true });
            setAdding(true);
          }}
        >
          {add}
        </Button>
      </div>
      {adding && (
        <div className="tree-new">
          <NewNode kind={kind} onDone={() => setAdding(false)} />
        </div>
      )}
      <Fold open={open} id={`side-${kind}-list`}>
        {tree === null ? (
          <TreeSkeleton failed={treeError} />
        ) : roots.length === 0 ? (
          !adding && (
            <div className="side-empty">
              <p className="t-help">{kind === "client" ? "No clients yet. A client holds its projects." : "No projects of your own yet."}</p>
              <Button size="sm" onClick={() => setAdding(true)}>
                {kind === "client" ? "Add the first client" : "Add the first project"}
              </Button>
            </div>
          )
        ) : (
          <ul className="tree">
            {roots.map((node) => (
              <Branch key={node.id} node={node} tree={tree} openState={openState} current={current} />
            ))}
          </ul>
        )}
        {tree !== null && treeError && (
          <p role="alert" className="inline-note" data-tone="alert">
            The list could not be refreshed: {treeError}. What you see is the last one read.
          </p>
        )}
      </Fold>
    </section>
  );
}

const CHILD: Record<TreeNode["kind"], { one: string; many: string }> = {
  client: { one: "project", many: "Projects" },
  project: { one: "subproject", many: "Subprojects" },
  subproject: { one: "subproject", many: "Subprojects" },
};

// One client or project: its fold, its link with its open tasks —the same number its card and its page show—, and below
// it its children and their "New".
function Branch({ node, tree, openState, current, depth = 1 }: { node: TreeNode; tree: TreeNode[]; openState: Record<string, boolean>; current: string | null; depth?: number }) {
  const [adding, setAdding] = useState(false);
  const open = openState[node.id] ?? false;
  const children = tree.filter((child) => child.parentId === node.id);
  const child = CHILD[node.kind];
  return (
    <li>
      <div className="tree-row" data-node={node.id}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={open}
          aria-controls={`branch-${node.id}`}
          aria-label={`${child.many} of ${node.name}`}
          onClick={() => writeOpen({ [node.id]: !open })}
        />
        <Link
          href={`/app/node/${node.id}`}
          className="side-link"
          data-kind={node.kind}
          // A root reads the same in both groups, a client or a project of one's own; each level below reads quieter.
          data-depth={Math.min(depth, 3)}
          aria-current={node.id === current ? "page" : undefined}
          onClick={(event) => plainClick(event) && requestFocus({ kind: "node", nodeId: node.id })}
        >
          <span className="side-link-name">{node.name}</span>
          {node.openTasks > 0 && (
            <span className="count" aria-label={node.openTasks === 1 ? "1 open task" : `${node.openTasks} open tasks`} title={node.openTasks === 1 ? "1 open task" : `${node.openTasks} open tasks`}>
              {node.openTasks}
            </span>
          )}
        </Link>
      </div>
      <Fold open={open} id={`branch-${node.id}`}>
        <div className="tree-below">
          {children.length > 0 && (
            <ul className="tree">
              {children.map((entry) => (
                <Branch key={entry.id} node={entry} tree={tree} openState={openState} current={current} depth={depth + 1} />
              ))}
            </ul>
          )}
          {adding ? (
            <div className="tree-new">
              <NewNode parent={node} onDone={() => setAdding(false)} />
            </div>
          ) : (
            <Button variant="quiet" size="sm" className="tree-add tree-add-child" onClick={() => setAdding(true)} aria-label={`New ${child.one} in ${node.name}`} data-tree-add-child={node.id}>
              {`New ${child.one}`}
            </Button>
          )}
        </div>
      </Fold>
    </li>
  );
}

// A block that folds: it travels its height, and only once open and still does what overflows it (a focus ring) show.
export function Fold({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const [settled, setSettled] = useState(open);
  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    setSettled(false);
  }
  return (
    <div
      className="fold"
      id={id}
      data-open={open}
      data-settled={(open && settled) || undefined}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") setSettled(open);
      }}
    >
      <div>{children}</div>
    </div>
  );
}

function TreeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <p role="alert" className="inline-note" data-tone="alert">
        The list could not be read: {failed}. Reload the page to try again.
      </p>
    );
  }
  return (
    <div className="stack" role="status" aria-label="Loading the list" aria-busy="true">
      {["62%", "48%", "54%"].map((width, index) => (
        <span key={index} className="skeleton" style={{ width, marginLeft: index % 2 ? "1.4rem" : "0.6rem" }} />
      ))}
    </div>
  );
}

// Creating in place: Enter creates the node and opens it, Escape cancels, and the blur that follows does nothing more.
export function NewNode({ parent, kind, onDone }: { parent?: TreeNode; kind?: "client" | "project"; onDone: () => void }) {
  const { saving } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const what = parent ? CHILD[parent.kind].one : (kind ?? "client");
  const settled = useRef(false);

  async function create() {
    if (settled.current) return;
    settled.current = true;
    if (!name.trim()) return onDone();
    const answer = await post<{ node: { id: string } }>("/api/nodes", parent ? { name, parent: parent.id } : { name, kind });
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
    <>
      {parent && (
        <p className="t-meta tree-new-where">
          In <span className="t-name">{parent.path}</span>
        </p>
      )}
      <Field
        autoFocus
        id={`new-node-${parent?.id ?? kind ?? "root"}`}
        name="node-name"
        aria-label={`New ${what} name`}
        placeholder={`New ${what} name`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={onKey}
        onBlur={() => void create()}
      />
    </>
  );
}
