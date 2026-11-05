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
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { Tick } from "@/components/ui/tick";
import { AddIcon, CalendarIcon, GuideIcon, HelpIcon, MailIcon, OverviewIcon, SearchIcon, SettingsIcon, SignOutIcon, TasksIcon, TrashIcon, type Icon } from "@/components/ui/icons";
import { usePiece } from "@/components/ui/use-piece";
import { PRODUCT_NAME } from "@/lib/product";
import { useStrings } from "@/lib/strings";
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
  const { t } = useStrings();
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
    <nav className="side-nav" aria-label={t("nav.workspace")}>
      {!inDrawer && (
        <div className="side-top">
          <Link href="/app" className="brand side-brand" aria-label={t("workspace.overviewBrand", { product: PRODUCT_NAME })}>
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
          <span className="btn-label side-link-name">{t("common.addTask")}</span>
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
          <span className="side-link-name">{t("nav.search")}</span>
          <kbd className="kbd side-key" aria-hidden="true">
            {mac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      </div>
      <div className="side-scroll">
        <div ref={main} className="side-main side-pieces">
          <ul className="side-list" aria-label={t("nav.views")}>
            <li>
              <Link href="/app" className="side-link side-view" aria-current={here("/app")}>
                <ViewName icon={OverviewIcon} name={t("nav.overview")} detail={t("nav.overviewDetail")} />
              </Link>
            </li>
            <li>
              <Link href="/app/tasks" className="side-link side-view" aria-current={here("/app/tasks")}>
                <ViewName icon={TasksIcon} name={t("nav.tasks")} detail={t("nav.tasksDetail")} />
                {due > 0 && <Count value={due} unit={t("nav.dueUnit")} spoken={t("nav.dueSpoken", { n: due })} />}
              </Link>
            </li>
            <li>
              <Link href="/app/calendar" className="side-link side-view" aria-current={here("/app/calendar")}>
                <ViewName icon={CalendarIcon} name={t("nav.calendar")} detail={t("nav.calendarDetail")} />
              </Link>
            </li>
            <li>
              <Link href="/app/mail" className="side-link side-view" aria-current={here("/app/mail")}>
                <ViewName icon={MailIcon} name={t("nav.mail")} detail={t("nav.mailDetail")} />
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
          <span className="side-link-name">{t("nav.guide")}</span>
        </button>
        <Link href="/help" className="side-link" onClick={() => onLeave?.()}>
          <HelpIcon className="side-icon" />
          <span className="side-link-name">{t("nav.help")}</span>
        </Link>
        <Link href="/app/trash" className="side-link" aria-current={here("/app/trash")}>
          <TrashIcon className="side-icon" />
          <span className="side-link-name">{t("nav.trash")}</span>
        </Link>
        <Link href="/app/settings" className="side-link" aria-current={here("/app/settings")}>
          <SettingsIcon className="side-icon" />
          <span className="side-link-name">{t("nav.settings")}</span>
        </Link>
        <div className="side-theme">
          <ThemeSwitch />
        </div>
        <div className="side-account" data-session={person ? (person.isAnonymous ? "anonymous" : "google") : undefined}>
          {person && !person.isAnonymous ? (
            <Link href="/app/profile" className="side-link side-profile" aria-current={here("/app/profile")} title={person.email ?? undefined} data-side-profile>
              <Avatar className="side-avatar" src={person.avatarUrl} name={person.name} email={person.email} />
              <span className="t-name side-who">{person.name ?? person.email}</span>
              <span className="sr-only">{t("nav.yourProfile")}</span>
            </Link>
          ) : (
            person && (
              <>
                <Avatar className="side-avatar" src={null} name={t("nav.demoSession")} email={null} />
                <span className="t-meta side-who">{t("nav.demoSession")}</span>
                <Button size="sm" variant="quiet" className="btn-icon side-sign-out" onClick={onSignOut} title={t("nav.signOut")}>
                  <SignOutIcon />
                  <span className="sr-only">{t("nav.signOut")}</span>
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

function NodeGroup({ kind, current, ids }: { kind: "client" | "project"; current: string | null; ids: string }) {
  const { tree, treeError } = useWorkspace();
  const { t } = useStrings();
  const GROUP = {
    client: { title: t("nav.clients"), add: t("nav.addClient"), empty: t("nav.noClients") },
    project: { title: t("nav.projects"), add: t("nav.addProject"), empty: t("nav.noProjects") },
  } as const;
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
              {t("nav.listNotRefreshed", { reason: sentence(treeError) })}
            </p>
          )}
        </div>
      </Fold>
    </section>
  );
}

const CHILDREN: Record<TreeNode["kind"], "nav.projectsOf" | "nav.subprojectsOf"> = { client: "nav.projectsOf", project: "nav.subprojectsOf", subproject: "nav.subprojectsOf" };

function Branch({ node, tree, openState, current, ids, depth = 1 }: { node: TreeNode; tree: TreeNode[]; openState: Record<string, boolean>; current: string | null; ids: string; depth?: number }) {
  const { t, counted } = useStrings();
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
            aria-label={t(CHILDREN[node.kind], { name: node.name })}
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
          {node.openTasks > 0 && <Count value={node.openTasks} spoken={counted(node.openTasks, "counted.openTask", "counted.openTasks")} />}
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
  const { t } = useStrings();
  if (failed) {
    return (
      <p role="alert" className="inline-note" data-tone="alert">
        {t("nav.listNotLoaded", { reason: sentence(failed) })}
      </p>
    );
  }
  return (
    <div className="stack side-skeleton" role="status" aria-label={t("nav.loadingList")} aria-busy="true">
      {["62%", "48%", "54%"].map((width, index) => (
        <span key={index} className="skeleton" style={{ width }} />
      ))}
    </div>
  );
}

export function NewNode({ parent, kind, idPrefix = "new-node", onDone }: { parent?: TreeNode; kind?: "client" | "project"; idPrefix?: string; onDone: () => void }) {
  const { saving } = useWorkspace();
  const { t } = useStrings();
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
          {t("nav.inPlace")} <span className="t-name">{parent.path}</span>
        </p>
      )}
      <Field
        autoFocus
        id={`${idPrefix}-${parent?.id ?? kind ?? "root"}`}
        name="node-name"
        aria-label={t("nav.newName", { what: t(`kindWord.${what}` as "kindWord.client") })}
        placeholder={t("nav.newName", { what: t(`kindWord.${what}` as "kindWord.client") })}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={onKey}
        onBlur={() => void create()}
      />
    </>
  );
}
