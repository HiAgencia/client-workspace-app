"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { usePiece } from "@/components/ui/use-piece";
import { PRODUCT_NAME } from "@/lib/product";
import { post, type TreeNode } from "./client-api";
import { plainClick, requestFocus } from "./focus-request";
import { openQuickAdd } from "./quick-add-bus";
import { useWorkspace } from "./workspace";

// The sidebar: navigation only, the same on every screen. On top, «Add task» and «Search»; then Overview, Tasks, Calendar
// and Mail; Clients and Projects, each a group that folds by its name, every client folding its projects, each place
// with its number and its color; and at the foot Trash, Settings and who is signed in. A node's own actions live in its
// page's «More», so nothing here changes from one page to another. The same content serves the computer's sidebar and
// the phone's drawer, with ONE piece marking where the person is in each part.
export function SideNav({ inDrawer = false, onLeave, onSignOut }: { inDrawer?: boolean; onLeave?: () => void; onSignOut: () => void }) {
  const pathname = usePathname();
  const { taskCounts, mailUnread, openPalette, who } = useWorkspace();
  const current = useCurrentNode();
  const mac = useMac();
  const main = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  usePiece(main, '[aria-current="page"]');
  usePiece(foot, '[aria-current="page"]');
  const here = (path: string) => (path === "/app" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)) ? "page" : undefined;
  const due = taskCounts ? taskCounts.overdue + taskCounts.today : 0;
  // The sidebar and the drawer are both in the page: each names its own parts.
  const ids = inDrawer ? "drawer" : "side";

  return (
    <nav className="side-nav" aria-label="Workspace">
      {!inDrawer && (
        <div className="side-top">
          <Link href="/app" className="brand side-brand" aria-label={`${PRODUCT_NAME}, Overview`}>
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </Link>
        </div>
      )}
      <div className="side-actions">
        <button
          type="button"
          className="side-link side-action"
          data-side-action="add-task"
          aria-keyshortcuts="Q"
          onClick={() => {
            onLeave?.();
            startTask(current);
          }}
        >
          <span className="side-link-name">Add task</span>
          <kbd className="kbd side-key" aria-hidden="true">
            Q
          </kbd>
        </button>
        <button
          type="button"
          className="side-link side-action"
          data-side-action="search"
          aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
          onClick={() => {
            onLeave?.();
            openPalette();
          }}
        >
          <span className="side-link-name">Search</span>
          <kbd className="kbd side-key" aria-hidden="true">
            {mac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </div>
      <div className="side-scroll">
        <div ref={main} className="side-main side-pieces">
          <ul className="side-list" aria-label="Views">
            <li>
              <Link href="/app" className="side-link" aria-current={here("/app")}>
                <span className="side-link-name">Overview</span>
              </Link>
            </li>
            <li>
              <Link href="/app/tasks" className="side-link" aria-current={here("/app/tasks")}>
                <span className="side-link-name">Tasks</span>
                {due > 0 && <Count value={due} unit="due" spoken={`${due} overdue or due today`} />}
              </Link>
            </li>
            <li>
              <Link href="/app/calendar" className="side-link" aria-current={here("/app/calendar")}>
                <span className="side-link-name">Calendar</span>
              </Link>
            </li>
            <li>
              {/* Its number is the unread mail of every account in reach, the same the Mail page says. */}
              <Link href="/app/mail" className="side-link" aria-current={here("/app/mail")}>
                <span className="side-link-name">Mail</span>
                {mailUnread !== null && mailUnread > 0 && <Count value={mailUnread} spoken={`${mailUnread} unread`} />}
              </Link>
            </li>
          </ul>
          <NodeGroup kind="client" current={current} ids={ids} />
          <NodeGroup kind="project" current={current} ids={ids} />
        </div>
      </div>
      <div ref={foot} className="side-foot side-pieces">
        <Link href="/app/trash" className="side-link" aria-current={here("/app/trash")}>
          <span className="side-link-name">Trash</span>
        </Link>
        <Link href="/app/settings" className="side-link" aria-current={here("/app/settings")}>
          <span className="side-link-name">Settings</span>
        </Link>
        {/* Who is signed in sits over Trash and «Sign out» over Settings, so the foot is two columns of two and nothing
            hangs at the end of a row. A demo session has no address: it says it is one. */}
        {who && (
          <span className="t-meta side-who" title={who}>
            {who}
          </span>
        )}
        <Button size="sm" variant="quiet" className="side-sign-out" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}

// «Add task» starts the task where the person is: in the open client or project, or where the dialog decides (General).
export function startTask(nodeId: string | null): void {
  openQuickAdd(nodeId ? { placeId: nodeId } : {});
}

export function useCurrentNode(): string | null {
  return usePathname().match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
}

const noSubscription = () => () => {};

// Read once mounted: the server does not know the person's keyboard.
export function useMac(): boolean {
  return useSyncExternalStore(noSubscription, () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent), () => false);
}

// A place's number: what it counts is said in words to a screen reader, and the word beside it says which number it is
// —Tasks' is what is due, a place's is its open tasks— so two figures never read alike.
function Count({ value, unit, spoken }: { value: number; unit?: string; spoken: string }) {
  return (
    <span className="side-count">
      <span aria-hidden="true">
        {value}
        {unit ? ` ${unit}` : ""}
      </span>
      <span className="sr-only">, {spoken}</span>
    </span>
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

const GROUP = {
  client: { title: "Clients", add: "Add client", empty: "No clients yet. A client holds its projects." },
  project: { title: "Projects", add: "Add project", empty: "No projects of your own yet." },
} as const;

function NodeGroup({ kind, current, ids }: { kind: "client" | "project"; current: string | null; ids: string }) {
  const { tree, treeError } = useWorkspace();
  const openState = useOpenState();
  const [adding, setAdding] = useState(false);
  const key = `group:${kind}`;
  const open = openState[key] ?? true;
  const roots = (tree ?? []).filter((node) => node.parentId === null && node.kind === kind);
  const words = GROUP[kind];

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
    <section className="side-group" aria-labelledby={`${ids}-${kind}`} data-side-group={kind}>
      <button
        type="button"
        id={`${ids}-${kind}`}
        className="side-toggle"
        aria-expanded={open}
        aria-controls={`${ids}-${kind}-list`}
        onClick={() => writeOpen({ [key]: !open })}
      >
        <span className="side-toggle-name">{words.title}</span>
      </button>
      <Fold open={open} id={`${ids}-${kind}-list`}>
        <div className="side-group-body">
          {tree === null ? (
            <TreeSkeleton failed={treeError} />
          ) : (
            <>
              {roots.length > 0 ? (
                <ul className="tree">
                  {roots.map((node) => (
                    <Branch key={node.id} node={node} tree={tree} openState={openState} current={current} ids={ids} />
                  ))}
                </ul>
              ) : (
                !adding && <p className="t-help side-empty">{words.empty}</p>
              )}
              {adding ? (
                <div className="tree-new">
                  <NewNode kind={kind} idPrefix={ids} onDone={() => setAdding(false)} />
                </div>
              ) : (
                <button type="button" className="side-link side-add" data-side-add={kind} onClick={() => setAdding(true)}>
                  <span className="side-link-name">{words.add}</span>
                </button>
              )}
            </>
          )}
          {tree !== null && treeError && (
            <p role="alert" className="inline-note" data-tone="alert">
              The list could not be refreshed: {sentence(treeError)} What you see is the last one read.
            </p>
          )}
        </div>
      </Fold>
    </section>
  );
}

const CHILDREN: Record<TreeNode["kind"], string> = { client: "Projects", project: "Subprojects", subproject: "Subprojects" };

// One client or project: its link with its color and its open tasks —the same number its page shows—, and, when it holds
// others, the control that folds them.
function Branch({ node, tree, openState, current, ids, depth = 1 }: { node: TreeNode; tree: TreeNode[]; openState: Record<string, boolean>; current: string | null; ids: string; depth?: number }) {
  const open = openState[node.id] ?? false;
  const children = tree.filter((child) => child.parentId === node.id);
  return (
    <li>
      <div className="tree-row" data-node={node.id}>
        {children.length > 0 ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={open}
            aria-controls={`${ids}-branch-${node.id}`}
            aria-label={`${CHILDREN[node.kind]} of ${node.name}`}
            onClick={() => writeOpen({ [node.id]: !open })}
          />
        ) : (
          <span className="tree-toggle-slot" aria-hidden="true" />
        )}
        <Link
          href={`/app/node/${node.id}`}
          className="side-link"
          data-kind={node.kind}
          // A root reads the same in both groups, a client or a project of one's own; each level below reads quieter.
          data-depth={Math.min(depth, 3)}
          aria-current={node.id === current ? "page" : undefined}
          onClick={(event) => plainClick(event) && requestFocus({ kind: "node", nodeId: node.id })}
        >
          <span className="side-mark" data-color={node.color ?? undefined} aria-hidden="true" />
          <span className="side-link-name">{node.name}</span>
          {node.openTasks > 0 && <Count value={node.openTasks} spoken={node.openTasks === 1 ? "1 open task" : `${node.openTasks} open tasks`} />}
        </Link>
      </div>
      {children.length > 0 && (
        <Fold open={open} id={`${ids}-branch-${node.id}`}>
          <ul className="tree tree-below">
            {children.map((entry) => (
              <Branch key={entry.id} node={entry} tree={tree} openState={openState} current={current} ids={ids} depth={depth + 1} />
            ))}
          </ul>
        </Fold>
      )}
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

// A reason the server gave, closed as one sentence whether or not it brought its own period.
function sentence(reason: string): string {
  return /[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`;
}

function TreeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <p role="alert" className="inline-note" data-tone="alert">
        The list could not be read: {sentence(failed)} Reload the page to try again.
      </p>
    );
  }
  return (
    <div className="stack side-skeleton" role="status" aria-label="Loading the list" aria-busy="true">
      {["62%", "48%", "54%"].map((width, index) => (
        <span key={index} className="skeleton" style={{ width }} />
      ))}
    </div>
  );
}

// Creating in place: Enter creates the node and opens it, Escape cancels, and the blur that follows does nothing more.
export function NewNode({ parent, kind, idPrefix = "new-node", onDone }: { parent?: TreeNode; kind?: "client" | "project"; idPrefix?: string; onDone: () => void }) {
  const { saving } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const what = parent ? (parent.kind === "client" ? "project" : "subproject") : (kind ?? "client");
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
        id={`${idPrefix}-${parent?.id ?? kind ?? "root"}`}
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
