"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, ViewTransition, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { firstWeekday, today } from "@/lib/dates";
import { NODE_COLORS } from "@/lib/node-colors";
import { get, post, type TreeNode } from "./client-api";
import {
  CalendarBoxContent,
  MailBoxContent,
  NoDateBoxContent,
  NotesBoxContent,
  SubprojectsBoxContent,
  TasksBoxContent,
  tasksCount,
  useMailRead,
  useNotesRead,
  useTasksRead,
  type Place,
} from "./box-kinds";
import { BoxBoard, customizeEntries, savePreference, SPLIT, useBoardLayout, useBoxRead, type BoardLayout, type BoxSpec } from "./boxes";
import type { ConnectBlocked } from "./connect-blocked";
import { land, onFocusRequest, takeFocusRequest } from "./focus-request";
import { allTasks, BoardShell } from "./overview";
import { PageHeader, type PageLayout } from "./page-header";
import { useAddress } from "./page-filters";
import { count } from "./task-row";
import { useChatScope, useWorkspace } from "./workspace";

// A client's or a project's boxes, in their first order: its tasks and what has no date on the left, its week, its mail,
// its notes and what hangs from it on the right.
export const NODE_BOXES = ["tasks", "no_date", SPLIT, "calendar", "mail", "notes", "subprojects"];

type Account = { id: string; email: string; status: string; nodeIds: string[] };
type Accounts = { accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked };

const COLOR_NAMES: Record<(typeof NODE_COLORS)[number], string> = {
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  pink: "Pink",
  gray: "Gray",
};

function chainOf(tree: TreeNode[], id: string): TreeNode[] {
  const chain: TreeNode[] = [];
  for (let cursor = tree.find((node) => node.id === id); cursor; cursor = tree.find((node) => node.id === cursor!.parentId)) chain.unshift(cursor);
  return chain;
}

const noSubscription = () => () => {};

// The page of a client or a project: the Overview's logic over that node and what hangs from it, its boxes in the order
// its person gave this page, its tasks as a list or a board.
export function NodeView({ nodeId, saved, savedLayout }: { nodeId: string; saved: BoardLayout | null; savedLayout: PageLayout | null }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree, notify, saving, refreshTree } = useWorkspace();
  const router = useRouter();
  useChatScope(nodeId);
  const page = `node:${nodeId}`;
  const params = useSearchParams();
  const { set } = useAddress();
  const layoutParam = params.get("layout");
  const layout: PageLayout = layoutParam === "board" || layoutParam === "list" ? layoutParam : (savedLayout ?? "list");
  const board = useBoardLayout(page, NODE_BOXES, saved, layout === "board" ? "tasks" : null);
  const [weekStart] = useState(() => (typeof window === "undefined" ? 1 : firstWeekday()));
  const now = mounted ? today() : null;
  const place: Place = { kind: "node", id: nodeId };
  const tasks = useTasksRead(place, now, { upcomingDays: 3 });
  const notes = useNotesRead(place);
  const mail = useMailRead(place, null);
  const accounts = useBoxRead<Accounts>(() => get<Accounts>("/api/accounts"), "accounts");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const google = params.get("google");

  const node = tree?.find((entry) => entry.id === nodeId);
  const chain = tree && node ? chainOf(tree, nodeId) : [];
  const children = (tree ?? []).filter((entry) => entry.parentId === nodeId);
  const ready = Boolean(node) && tasks.settled;

  // The palette, the sidebar or a row's path may have asked to land somewhere on this page: once it painted, the view
  // goes there.
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const request = takeFocusRequest(nodeId);
      if (!request) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const landing = land(request.target, { acted: request.acted });
          if (landing === "missing" && request.target.kind === "item") notify({ text: `“${request.target.title}” is not on this page.`, tone: "status" });
        }),
      );
    };
    apply();
    return onFocusRequest(apply);
  }, [ready, nodeId, notify]);

  if (tree && !node) return <NotHere />;
  if (!node || !now) return <BoardShell />;

  const root = chain[0];
  const trail = [{ label: root.kind === "client" ? "Clients" : "Projects" }, ...chain.slice(0, -1).map((entry) => ({ label: entry.name, href: `/app/node/${entry.id}` }))];
  const ids = new Set(chain.map((entry) => entry.id));
  const seen = (accounts.data?.accounts ?? []).filter((account) => account.nodeIds.some((id) => ids.has(id)));
  const connectHref = accounts.data?.canConnect ? `/api/google/connect?node=${nodeId}` : "/app/settings#google-accounts";
  const one = node.kind === "client" ? "project" : "subproject";
  const childName = node.kind === "client" ? "Projects" : "Subprojects";
  const names: Record<string, string> = { tasks: "Tasks", no_date: "No date", calendar: "Calendar", mail: "Mail", notes: "Notes", subprojects: childName };
  // Inside its own page a task's place goes without saying; one of a project below says its path from here.
  const view = tasks.data;
  const tasksRead = tasks;

  function chooseLayout(value: PageLayout) {
    set({ layout: value });
    void savePreference({ page, layout: value }).then((answer) => {
      if (!answer.ok) notify({ text: `The layout could not be remembered: ${answer.message}`, tone: "error" });
    });
  }

  async function setColor(color: string | null) {
    if (await saving(post(`/api/nodes/${nodeId}`, { color }, "PATCH"))) void refreshTree();
  }

  async function remove() {
    const answer = await post(`/api/nodes/${nodeId}`, { archived: true }, "PATCH");
    if (!(await saving(Promise.resolve(answer)))) return;
    router.push("/app");
    notify({
      text: `Deleted “${node!.name}”`,
      tone: "status",
      undo: () => void saving(post(`/api/nodes/${nodeId}`, { archived: false }, "PATCH")).then((ok) => ok && router.push(`/app/node/${nodeId}`)),
    });
  }

  function addChild() {
    if (board.layout.hidden.includes("subprojects")) board.show("subprojects", childName);
    setAdding(true);
    requestAnimationFrame(() => document.querySelector("[data-box='subprojects']")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
  }

  const more: MenuEntry[] = [
    { kind: "action", label: "Rename…", onSelect: () => setRenaming(true) },
    { kind: "action", label: `New ${one}`, onSelect: addChild },
    { kind: "action", label: "Agent token…", onSelect: () => router.push(`/app/settings?node=${nodeId}#agent-tokens`) },
    {
      kind: "submenu",
      label: "Google accounts",
      detail: seen.length ? String(seen.length) : undefined,
      entries: [
        ...seen.map((account): MenuEntry => ({ kind: "action", label: account.email, detail: account.nodeIds.includes(nodeId) ? "Connected here" : "From a place above", disabled: true, onSelect: () => {} })),
        ...(seen.length ? [{ kind: "separator" } as const] : []),
        accounts.data?.canConnect
          ? { kind: "action", label: "Connect a Google account here", onSelect: () => window.location.assign(new URL(`/api/google/connect?node=${nodeId}`, window.location.origin).toString()) }
          : { kind: "action", label: "Connect a Google account here", disabled: true, detail: accounts.data?.connectBlocked === "demo" ? "Needs a Google sign-in" : "Not set up on this server", onSelect: () => {} },
        { kind: "action", label: "Manage them in Settings", onSelect: () => router.push("/app/settings#google-accounts") },
      ],
    },
    {
      kind: "choice",
      label: "Color",
      value: node.ownColor ?? "none",
      options: [{ value: "none", label: node.color && !node.ownColor ? "None (the one above)" : "None" }, ...NODE_COLORS.map((color) => ({ value: color, label: COLOR_NAMES[color] }))],
      onChoose: (value) => void setColor(value === "none" ? null : value),
    },
    ...customizeEntries(board, names),
    { kind: "separator" },
    { kind: "action", label: `Delete ${node.kind === "client" ? "this client" : `this ${node.kind}`}`, tone: "danger", onSelect: () => void remove() },
  ];

  const tasksBox: BoxSpec = {
    id: "tasks",
    title: "Tasks",
    count: tasksCount(view),
    content: <TasksBoxContent read={tasksRead} now={now} place={place} placeId={nodeId} showPlace pageNode={nodeId} layout={layout} allHref={`/app/tasks?place=${nodeId}`} />,
  };
  const boxes: Record<string, BoxSpec> = {
    tasks: tasksBox,
    no_date: { id: "no_date", title: "No date", count: view?.groups.noDate.count, content: <NoDateBoxContent read={tasksRead} placeId={nodeId} showPlace pageNode={nodeId} /> },
    calendar: { id: "calendar", title: "Calendar", content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(view)} calendarHref={`/app/calendar?scope=${nodeId}`} /> },
    mail: { id: "mail", title: "Mail", count: mail.data ? `${mail.data.unread} unread` : undefined, content: <MailBoxContent read={mail} now={now} place={place} connectHref={connectHref} /> },
    notes: { id: "notes", title: "Notes", count: notes.data?.total, content: <NotesBoxContent read={notes} place={place} /> },
    subprojects: { id: "subprojects", title: childName, count: children.length, content: <SubprojectsBoxContent node={node} adding={adding} setAdding={setAdding} /> },
  };

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
    <div className="page page-boxes" data-node-view={nodeId} data-node-kind={node.kind}>
      <PageHeader
        trail={trail}
        title={node.name}
        titleProps={{ "data-node-title": "" }}
        count={
          <span className="node-facts">
            <span data-node-count={node.openTasks}>{node.openTasks === 0 ? "No open tasks" : count(node.openTasks, "open task", "open tasks")}</span>
            {seen.map((account) => (
              <span key={account.id} className="t-name node-account">
                {account.email}
              </span>
            ))}
          </span>
        }
        layout={{ value: layout, onChange: chooseLayout }}
        chat
        more={<Menu label="More" about={`for ${node.name}`} entries={more} />}
      />
      {google && <GoogleOutcome outcome={google} />}
      <BoxBoard board={board} boxes={boxes} label={`The boxes of ${node.name}`} wide={layout === "board" ? tasksBox : null} />
      <RenameDialog open={renaming} name={node.name} nodeId={nodeId} onClose={() => setRenaming(false)} />
    </div>
    </ViewTransition>
  );
}

// Renaming: one field with the current name, Enter keeps the new one, Escape leaves it as it was.
function RenameDialog({ open, name, nodeId, onClose }: { open: boolean; name: string; nodeId: string; onClose: () => void }) {
  const { saving } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setValue(name);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (!next || next === name) return onClose();
    if (await saving(post(`/api/nodes/${nodeId}`, { name: next[0].toUpperCase() + next.slice(1) }, "PATCH"))) onClose();
  }

  return (
    <dialog ref={dialog} className="dialog rename-dialog" aria-labelledby="rename-title" onClose={onClose}>
      <form className="rename-form" onSubmit={(event) => void submit(event)}>
        <h2 id="rename-title" className="t-title">
          Rename
        </h2>
        <Field autoFocus aria-label="Name" value={value} onChange={(event) => setValue(event.target.value)} />
        <div className="rename-actions">
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!value.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function NotHere() {
  return (
    <section className="card not-here" aria-labelledby="missing">
      <h1 id="missing" className="t-h1" tabIndex={-1} data-page-title>
        This client or project is not here
      </h1>
      <p className="t-help">It was deleted, or it belongs to another account. Pick one in the sidebar, or go back to the Overview.</p>
      <div>
        <Link className={buttonClass({ variant: "primary" })} href="/app">
          <span className="btn-label">Go to the Overview</span>
        </Link>
      </div>
    </section>
  );
}

const outcomes: Record<string, string> = {
  connected: "The Google account is connected here.",
  cancelled: "Connecting the Google account was cancelled.",
  failed: "The Google account could not be connected. Try again.",
  "invalid-state": "That connection link expired or was started elsewhere. Start again from here.",
  "not-configured": "Connecting Google accounts is not configured on this server.",
};

export function GoogleOutcome({ outcome }: { outcome: string }) {
  const text = outcomes[outcome];
  if (!text) return null;
  return (
    <p role={outcome === "connected" ? "status" : "alert"} className="inline-note page-note" data-tone={outcome === "connected" ? "accent" : "alert"}>
      {text}
    </p>
  );
}
