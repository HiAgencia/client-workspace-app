"use client";

import { Link } from "@/components/ui/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { BrandMark } from "@/components/brand-mark";
import { NodeGlyph } from "@/components/node-glyph";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FlipList } from "@/components/ui/flip-list";
import { Fold } from "@/components/ui/fold";
import { Tick } from "@/components/ui/tick";
import { AddIcon, CalendarIcon, GuideIcon, HelpIcon, MailIcon, OverviewIcon, SearchIcon, SettingsIcon, SignOutIcon, TasksIcon, TrashIcon, type Icon } from "@/components/ui/icons";
import { usePiece } from "@/components/ui/use-piece";
import { count } from "@/lib/count";
import { PRODUCT_NAME } from "@/lib/product";
import { post, type TreeNode } from "./client-api";
import { plainClick, requestFocus } from "./focus-request";
import { figureText } from "./mail-store";
import { requestGuide } from "./guide";
import { openQuickAdd } from "./quick-add-bus";
import { useWorkspace } from "./workspace";

export function SideNav({ inDrawer = false, onLeave, onSignOut }: { inDrawer?: boolean; onLeave?: () => void; onSignOut: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { taskCounts, mailFigure, openPalette, person } = useWorkspace();
  const mailNumber = mailFigure ? figureText(mailFigure) : null;
  const current = useCurrentNode();
  const mac = useMac();
  const main = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  usePiece(main, '[aria-current="page"]');
  usePiece(foot, '[aria-current="page"]');
  const here = (path: string) => (path === "/app" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)) ? "page" : undefined;
  const due = taskCounts ? taskCounts.overdue + taskCounts.today : 0;
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
        <Button
          variant="primary"
          className="side-add-task"
          data-side-action="add-task"
          aria-keyshortcuts="Q"
          onClick={() => {
            onLeave?.();
            startTask(current);
          }}
        >
          <AddIcon />
          <span className="btn-label side-link-name">Add task</span>
          <kbd className="kbd side-key" aria-hidden="true">
            Q
          </kbd>
        </Button>
        <button
          type="button"
          className="field side-search"
          data-side-action="search"
          aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
          onClick={() => {
            onLeave?.();
            openPalette();
          }}
        >
          <SearchIcon />
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
              <Link href="/app" className="side-link side-view" aria-current={here("/app")}>
                <ViewName icon={OverviewIcon} name="Overview" detail="Your day on one page" />
              </Link>
            </li>
            <li>
              <Link href="/app/tasks" className="side-link side-view" aria-current={here("/app/tasks")}>
                <ViewName icon={TasksIcon} name="Tasks" detail="All your tasks, by date" />
                {due > 0 && <Count value={due} unit="due" spoken={`${due} overdue or due today`} />}
              </Link>
            </li>
            <li>
              <Link href="/app/calendar" className="side-link side-view" aria-current={here("/app/calendar")}>
                <ViewName icon={CalendarIcon} name="Calendar" detail="Events and dated tasks" />
              </Link>
            </li>
            <li>
              <Link href="/app/mail" className="side-link side-view" aria-current={here("/app/mail")}>
                <ViewName icon={MailIcon} name="Mail" detail="For your tasks, then unread" />
                {mailNumber && <Count value={mailNumber.shown} spoken={mailNumber.spoken} />}
              </Link>
              {mailFigure?.note && (
                <p className="t-meta" data-mail-partial title={mailFigure.why ?? undefined}>
                  {mailFigure.note}
                </p>
              )}
            </li>
          </ul>
          <div className="side-places">
            <NodeGroup kind="client" current={current} ids={ids} />
            <NodeGroup kind="project" current={current} ids={ids} />
          </div>
        </div>
      </div>
      <div ref={foot} className="side-foot side-pieces">
        <button
          type="button"
          className="side-link"
          onClick={() => {
            onLeave?.();
            requestGuide();
            if (pathname !== "/app") router.push("/app");
          }}
        >
          <GuideIcon className="side-icon" />
          <span className="side-link-name">Guide</span>
        </button>
        <Link href="/help" className="side-link" onClick={() => onLeave?.()}>
          <HelpIcon className="side-icon" />
          <span className="side-link-name">Help</span>
        </Link>
        <Link href="/app/trash" className="side-link" aria-current={here("/app/trash")}>
          <TrashIcon className="side-icon" />
          <span className="side-link-name">Trash</span>
        </Link>
        <Link href="/app/settings" className="side-link" aria-current={here("/app/settings")}>
          <SettingsIcon className="side-icon" />
          <span className="side-link-name">Settings</span>
        </Link>
        <div className="side-account" data-session={person ? (person.isAnonymous ? "anonymous" : "google") : undefined}>
          {person && !person.isAnonymous ? (
            <Link href="/app/profile" className="side-link side-profile" aria-current={here("/app/profile")} title={person.email ?? undefined} data-side-profile>
              <Avatar className="side-avatar" src={person.avatarUrl} name={person.name} email={person.email} />
              <span className="t-name side-who">{person.name ?? person.email}</span>
              <span className="sr-only">, Your profile</span>
            </Link>
          ) : (
            person && (
              <>
                <Avatar className="side-avatar" src={null} name="Demo session" email={null} />
                <span className="t-meta side-who">Demo session</span>
                <Button size="sm" variant="quiet" className="btn-icon side-sign-out" onClick={onSignOut} title="Sign out">
                  <SignOutIcon />
                  <span className="sr-only">Sign out</span>
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </nav>
  );
}

export function startTask(nodeId: string | null): void {
  openQuickAdd(nodeId ? { placeId: nodeId } : {});
}

export function useCurrentNode(): string | null {
  return usePathname().match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
}

const noSubscription = () => () => {};

export function useMac(): boolean {
  return useSyncExternalStore(noSubscription, () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent), () => false);
}

function ViewName({ icon: Glyph, name, detail }: { icon: Icon; name: string; detail: string }) {
  return (
    <>
      <Glyph className="side-icon" />
      <span className="side-view-text">
        <span className="side-link-name">{name}</span>
        <span className="sr-only">, {detail}</span>
      </span>
    </>
  );
}

function Count({ value, unit, spoken }: { value: number | string; unit?: string; spoken: string }) {
  return (
    <span className="side-count">
      <span aria-hidden="true">
        <Tick value={value} />
        {unit ? ` ${unit}` : ""}
      </span>
      <span className="sr-only">, {spoken}</span>
    </span>
  );
}

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

  const opened = useRef<string | null>(null);
  useEffect(() => {
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
                <FlipList className="tree">
                  {roots.map((node) => (
                    <Branch key={node.id} node={node} tree={tree} openState={openState} current={current} ids={ids} />
                  ))}
                </FlipList>
              ) : (
                !adding && <p className="t-help side-empty">{words.empty}</p>
              )}
              {adding ? (
                <div className="tree-new">
                  <NewNode kind={kind} idPrefix={ids} onDone={() => setAdding(false)} />
                </div>
              ) : (
                <button type="button" className="side-link side-add" data-side-add={kind} onClick={() => setAdding(true)}>
                  <AddIcon className="side-icon" />
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

function Branch({ node, tree, openState, current, ids, depth = 1 }: { node: TreeNode; tree: TreeNode[]; openState: Record<string, boolean>; current: string | null; ids: string; depth?: number }) {
  const open = openState[node.id] ?? false;
  const children = tree.filter((child) => child.parentId === node.id);
  return (
    <li data-flip-key={node.id}>
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
          data-color={node.color ?? undefined}
          data-depth={Math.min(depth, 3)}
          aria-current={node.id === current ? "page" : undefined}
          onClick={(event) => plainClick(event) && requestFocus({ kind: "node", nodeId: node.id })}
        >
          <NodeGlyph className="side-icon" kind={node.kind} icon={node.icon} />
          <span className="side-link-name">{node.name}</span>
          {node.openTasks > 0 && <Count value={node.openTasks} spoken={count(node.openTasks, "open task", "open tasks")} />}
        </Link>
      </div>
      {children.length > 0 && (
        <Fold open={open} id={`${ids}-branch-${node.id}`}>
          <FlipList className="tree tree-below">
            {children.map((entry) => (
              <Branch key={entry.id} node={entry} tree={tree} openState={openState} current={current} ids={ids} depth={depth + 1} />
            ))}
          </FlipList>
        </Fold>
      )}
    </li>
  );
}

function sentence(reason: string): string {
  return /[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`;
}

function TreeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <p role="alert" className="inline-note" data-tone="alert">
        The list could not be loaded: {sentence(failed)} Reload the page to try again.
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
