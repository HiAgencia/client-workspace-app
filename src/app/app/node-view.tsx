"use client";

import { Link } from "@/components/ui/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, ViewTransition, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { count } from "@/lib/count";
import { firstWeekday, today } from "@/lib/dates";
import { NODE_COLORS } from "@/lib/node-colors";
import { cx } from "@/lib/utils";
import { get, post, type TreeNode } from "./client-api";
import {
  ActivityBoxContent,
  allTasks,
  CalendarBoxContent,
  HeadLink,
  MailBoxContent,
  NoDateBoxContent,
  noDateCount,
  NotesBoxContent,
  notesCount,
  TasksBoxContent,
  tasksCountLabel,
  useAddNote,
  useMailCount,
  useMailRead,
  useNotesRead,
  useTasksRead,
  type Place,
} from "./box-kinds";
import { FOOT, SPLIT, type BoardLayout } from "./board-layout";
import { BoxBoard, customizeEntries, savePreference, useBoardLayout, useBoxRead, type BoxSpec } from "./boxes";
import type { ConnectBlocked } from "./connect-blocked";
import { land, onFocusRequest, takeFocusRequest } from "./focus-request";
import { accountsSeenFrom, figureWords, lostWords } from "./mail-store";
import { BoardShell } from "./overview";
import { PageHeader, type PageLayout } from "./page-header";
import { useAddress } from "./page-filters";
import { useQuickAddInline } from "./quick-add";
import { NewNode } from "./side-nav";
import { useTaskReplies } from "./task-replies";
import { useChatScope, useWorkspace } from "./workspace";



export const NODE_BOXES = ["tasks", SPLIT, "calendar", "mail", FOOT, "no_date", "notes", "activity"];

type Account = { id: string; email: string; status: string; nodeIds: string[]; calendars: Array<{ selected: boolean }> };
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
  const mailCount = useMailCount(mail);
  const replies = useTaskReplies({ node: nodeId }, now, tree, 5);
  const accounts = useBoxRead<Accounts>(() => get<Accounts>("/api/accounts"), "accounts");
  const noDateAdd = useQuickAddInline({ day: null, placeId: nodeId });
  const noteAdd = useAddNote(nodeId);
  const [adding, setAdding] = useState(false);
  
  const [addRound, setAddRound] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const google = params.get("google");

  const node = tree?.find((entry) => entry.id === nodeId);
  const chain = tree && node ? chainOf(tree, nodeId) : [];
  const children = (tree ?? []).filter((entry) => entry.parentId === nodeId);
  const ready = Boolean(node) && tasks.settled;

  
  
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const request = takeFocusRequest(nodeId);
      if (!request) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void land(request.target, { acted: request.acted }).then((landing) => {
            if (request.target.kind !== "item") return;
            if (landing === "missing") notify({ text: `“${request.target.title}” is not on this page.`, tone: "status" });
            if (landing === "hidden") notify({ text: `“${request.target.title}” could not be shown on this page.`, tone: "status" });
          });
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
  const names: Record<string, string> = { tasks: "Tasks", no_date: "No date", calendar: "Calendar", mail: "Mail", notes: "Notes", activity: "Activity" };
  
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
    setAddRound((value) => value + 1);
    setAdding(true);
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
    purpose: "Overdue, today and the days ahead",
    count: tasksCountLabel(view),
    content: <TasksBoxContent read={tasksRead} now={now} place={place} placeId={nodeId} showPlace pageNode={nodeId} layout={layout} allHref={`/app/tasks?place=${nodeId}`} />,
  };
  const boxes: Record<string, BoxSpec> = {
    tasks: tasksBox,
    no_date: {
      id: "no_date",
      title: "No date",
      purpose: "Tasks you can do whenever",
      surface: "rest",
      count: noDateCount(view),
      action: noDateAdd.trigger,
      unfold: noDateAdd.editor,
      content: <NoDateBoxContent read={tasksRead} showPlace pageNode={nodeId} />,
    },
    calendar: {
      id: "calendar",
      title: "Calendar",
      purpose: "This week in the calendars it sees",
      action: (
        <HeadLink href={`/app/calendar?place=${nodeId}`} name="Open the calendar">
          Open
        </HeadLink>
      ),
      content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(view)} calendarHref={`/app/calendar?place=${nodeId}`} />,
    },
    mail: {
      id: "mail",
      title: "Mail",
      purpose: "What may answer its tasks, then what is unread",
      count: mailCount,
      action: (
        <HeadLink href="/app/mail" name="Open all mail">
          Open
        </HeadLink>
      ),
      content: <MailBoxContent read={mail} replies={replies} account={null} now={now} place={place} connectHref={connectHref} />,
    },
    notes: {
      id: "notes",
      title: "Notes",
      purpose: "What to keep in view, apart from the tasks",
      surface: "rest",
      count: notesCount(notes.data?.total),
      action: noteAdd.trigger,
      unfold: noteAdd.editor,
      content: <NotesBoxContent read={notes} place={place} />,
    },
    activity: {
      id: "activity",
      title: "Activity",
      purpose: "What the chat and your agents did here",
      surface: "rest",
      content: <ActivityBoxContent place={place} />,
    },
  };

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
    <div className="page page-boxes" data-node-view={nodeId} data-node-kind={node.kind}>
      <PageHeader
        trail={trail}
        title={node.name}
        mark={<NodeMark node={node} />}
        titleProps={{ "data-node-title": "" }}
        count={<span data-node-count={node.openTasks}>{node.openTasks === 0 ? "No open tasks" : count(node.openTasks, "open task", "open tasks")}</span>}
        layout={{ value: layout, onChange: chooseLayout }}
        chat
        more={<Menu label="More" about={`for ${node.name}`} entries={more} />}
      />
      {google && <GoogleOutcome outcome={google} />}
      <NodeStrip
        node={node}
        below={children}
        name={childName}
        one={one}
        connectHref={connectHref}
        calendars={accounts.data?.accounts ?? null}
        adding={adding}
        addRound={addRound}
        onAdd={addChild}
        onAddDone={() => setAdding(false)}
      />
      <BoxBoard board={board} boxes={boxes} label={`The boxes of ${node.name}`} wide={layout === "board" ? tasksBox : null} />
      <RenameDialog open={renaming} name={node.name} nodeId={nodeId} onClose={() => setRenaming(false)} />
    </div>
    </ViewTransition>
  );
}


function NodeMark({ node }: { node: TreeNode }) {
  return (
    <span className="page-mark" data-color={node.color ?? undefined} aria-hidden="true">
      <span>{Array.from(node.name.trim())[0]?.toUpperCase()}</span>
    </span>
  );
}


function accountFacts(unread: string | null, calendars: number | null): string {
  const shown = calendars === null ? null : calendars === 0 ? "no calendars" : count(calendars, "calendar", "calendars");
  const words = [unread, shown].filter(Boolean).join(", ");
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Reading…";
}



function NodeStrip({
  node,
  below,
  name,
  one,
  connectHref,
  calendars,
  adding,
  addRound,
  onAdd,
  onAddDone,
}: {
  node: TreeNode;
  below: TreeNode[];
  name: string;
  one: string;
  connectHref: string;
  calendars: Account[] | null;
  adding: boolean;
  addRound: number;
  onAdd: () => void;
  onAddDone: () => void;
}) {
  const { tree, mailAccounts, mailStore } = useWorkspace();
  const addButton = useRef<HTMLButtonElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const id = useId();
  const seen = new Set(accountsSeenFrom(tree, mailAccounts ?? [], node.id));
  const accounts = (mailAccounts ?? []).filter((account) => seen.has(account.id));
  return (
    <div className="node-strip">
      <section className="node-strip-group" aria-labelledby={`${id}below`}>
        <h2 id={`${id}below`} className="t-label named-label">
          {name}
        </h2>
        <ul className="node-chips">
          {below.map((child) => (
            <li key={child.id}>
              <Link className={cx(buttonClass({}), "node-chip")} href={`/app/node/${child.id}`}>
                <span className="node-chip-name task-place-name" data-color={child.color ?? undefined}>
                  {child.name}
                </span>
                <span className="node-chip-detail">{child.openTasks === 0 ? "No open tasks" : count(child.openTasks, "open task", "open tasks")}</span>
              </Link>
            </li>
          ))}
          <li>
            <Button ref={addButton} data-add-child aria-expanded={adding} aria-controls={`${id}new`} onClick={onAdd}>
              {`Add ${one}`}
            </Button>
          </li>
        </ul>
        <div ref={fold}>
          <Fold open={adding} id={`${id}new`}>
            {addRound > 0 && (
              <div key={addRound} className="node-new">
                <NewNode
                  parent={node}
                  idPrefix="strip-new"
                  onDone={() => {
                    onAddDone();
                    
                    requestAnimationFrame(() => {
                      const held = document.activeElement;
                      if (held === document.body || fold.current?.contains(held)) addButton.current?.focus({ preventScroll: true });
                    });
                  }}
                />
              </div>
            )}
          </Fold>
        </div>
      </section>
      <section className="node-strip-group" aria-labelledby={`${id}accounts`}>
        <h2 id={`${id}accounts`} className="t-label named-label">
          Accounts
        </h2>
        <ul className="node-chips">
          {accounts.map((account) => {
            const known = calendars?.find((entry) => entry.id === account.id);
            const lost = account.status !== "active" && !account.isDemo;
            return (
              <li key={account.id}>
                <Link className={cx(buttonClass({}), "node-chip")} href={lost ? "/app/settings#google-accounts" : `/app/mail?account=${account.id}`}>
                  <span className="node-chip-name t-name">{account.email}</span>
                  {lost ? (
                    <span className="node-chip-detail" data-tone="alert">
                      {lostWords(account.status)}
                    </span>
                  ) : (
                    <span className="node-chip-detail">{accountFacts(figureWords(mailStore.figure([account])), known ? known.calendars.filter((calendar) => calendar.selected).length : null)}</span>
                  )}
                </Link>
              </li>
            );
          })}
          {mailAccounts && accounts.length === 0 && (
            <li>
              <Link className={buttonClass({})} href={connectHref}>
                <span className="btn-label">Connect Google account</span>
              </Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}



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
    if (await saving(post(`/api/nodes/${nodeId}`, { name: next }, "PATCH"))) onClose();
  }

  return (
    <dialog ref={dialog} className="dialog rename-dialog" aria-labelledby="rename-title" onClose={onClose}>
      <form className="rename-form" onSubmit={(event) => void submit(event)}>
        <h2 id="rename-title" className="t-title">
          Rename
        </h2>
        <Field autoFocus aria-label="Name" value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValue(event.target.value)} />
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
