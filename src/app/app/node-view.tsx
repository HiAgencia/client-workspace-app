"use client";

import { Link } from "@/components/ui/link";
import { Menu as Base } from "@base-ui/react/menu";
import { usePopupContainer } from "@/components/ui/popup-layer";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, ViewTransition, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { FlipList } from "@/components/ui/flip-list";
import { Fold } from "@/components/ui/fold";
import { GoogleMark } from "@/components/ui/brands";
import { NodeGlyph, glyphOf } from "@/components/node-glyph";
import { AddIcon } from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { firstWeekday, today } from "@/lib/dates";
import { countedNow, translateNow, useStrings, type StringKey } from "@/lib/strings";
import { ASSISTANT_NAME } from "@/lib/product";
import { NODE_COLORS } from "@/lib/node-colors";
import { NODE_ICONS, shownIcon } from "@/lib/node-icons";
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
import { ConnectSession } from "./connect-session";
import { land, onFocusRequest, takeFocusRequest } from "./focus-request";
import { accountsSeenFrom, figureWords, lostWords, type MailFigure } from "./mail-store";
import { useGoogleOutcome } from "./google-outcome";
import { BoardShell } from "./overview";
import { PageHeader, type PageLayout } from "./page-header";
import { useAddress } from "./page-filters";
import { useQuickAddInline } from "./quick-add";
import { NewNode } from "./side-nav";
import { useTaskReplies } from "./task-replies";
import { useChatScope, useWorkspace } from "./workspace";

const NODE_BOXES = ["tasks", SPLIT, "calendar", "mail", FOOT, "no_date", "notes", "activity"];

type Account = { id: string; email: string; status: string; nodeIds: string[]; calendars: Array<{ selected: boolean }> };
type Accounts = { accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked };

const COLOR_NAMES: Record<(typeof NODE_COLORS)[number], StringKey> = {
  red: "color.red",
  orange: "color.orange",
  amber: "color.amber",
  green: "color.green",
  teal: "color.teal",
  blue: "color.blue",
  indigo: "color.indigo",
  violet: "color.violet",
  pink: "color.pink",
  gray: "color.gray",
};

function chainOf(tree: TreeNode[], id: string): TreeNode[] {
  const chain: TreeNode[] = [];
  for (let cursor = tree.find((node) => node.id === id); cursor; cursor = tree.find((node) => node.id === cursor!.parentId)) chain.unshift(cursor);
  return chain;
}

const noSubscription = () => () => {};

export function NodeView({ nodeId, saved, savedLayout }: { nodeId: string; saved: BoardLayout | null; savedLayout: PageLayout | null }) {
  const { t, counted } = useStrings();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree, notify, saving, refreshTree, person } = useWorkspace();
  const router = useRouter();
  useChatScope(nodeId);
  const page = `node:${nodeId}`;
  const params = useSearchParams();
  useGoogleOutcome();
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
            if (landing === "missing") notify({ text: translateNow("node.isNotOnPage", { title: request.target.title }), tone: "status" });
            if (landing === "hidden") notify({ text: translateNow("node.couldNotShow", { title: request.target.title }), tone: "status" });
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
  const sessionEmail = root.kind === "project" && person && !person.isAnonymous ? person.email : null;
  const blocked = accounts.data && !accounts.data.canConnect ? (accounts.data.connectBlocked === "demo" ? t("node.connectNeedsSignIn") : t("node.connectNotSetUp")) : null;
  const trail = [{ label: root.kind === "client" ? t("nav.clients") : t("nav.projects") }, ...chain.slice(0, -1).map((entry) => ({ label: entry.name, href: `/app/node/${entry.id}` }))];
  const ids = new Set(chain.map((entry) => entry.id));
  const seen = (accounts.data?.accounts ?? []).filter((account) => account.nodeIds.some((id) => ids.has(id)));
  const connectHref = accounts.data?.canConnect ? `/api/google/connect?node=${nodeId}` : "/app/settings#accounts-settings";
  const one = node.kind === "client" ? "project" : "subproject";
  const oneWord = t(`kindWord.${one}` as "kindWord.project");
  const childName = node.kind === "client" ? t("nav.projectsWord") : t("nav.subprojectsWord");
  const names: Record<string, string> = { tasks: t("box.tasks"), no_date: t("box.noDate"), calendar: t("box.calendar"), mail: t("box.mail"), notes: t("box.notes"), activity: t("box.activity") };
  const view = tasks.data;
  const tasksRead = tasks;

  function chooseLayout(value: PageLayout) {
    set({ layout: value });
    void savePreference({ page, layout: value }).then((answer) => {
      if (!answer.ok) notify({ text: t("node.layoutNotRemembered", { message: answer.message }), tone: "error" });
    });
  }

  async function setColor(color: string | null) {
    if (await saving(post(`/api/nodes/${nodeId}`, { color }, "PATCH"))) void refreshTree();
  }

  async function setIcon(icon: string | null) {
    if (await saving(post(`/api/nodes/${nodeId}`, { icon }, "PATCH"))) void refreshTree();
  }

  async function remove() {
    const answer = await post(`/api/nodes/${nodeId}`, { archived: true }, "PATCH");
    if (!(await saving(Promise.resolve(answer)))) return;
    router.push("/app");
    notify({
      text: t("node.deleted", { name: node!.name }),
      tone: "status",
      undo: () => void saving(post(`/api/nodes/${nodeId}`, { archived: false }, "PATCH")).then((ok) => ok && router.push(`/app/node/${nodeId}`)),
    });
  }

  function addChild() {
    setAddRound((value) => value + 1);
    setAdding(true);
  }

  const more: MenuEntry[] = [
    { kind: "action", label: t("node.renameEllipsis"), onSelect: () => setRenaming(true) },
    { kind: "action", label: t("node.newKind", { what: oneWord }), onSelect: addChild },
    { kind: "action", label: t("node.agentToken"), onSelect: () => router.push(`/app/settings?node=${nodeId}#agent-tokens`) },
    {
      kind: "submenu",
      label: t("node.googleAccounts"),
      detail: seen.length ? String(seen.length) : undefined,
      entries: [
        ...seen.map((account): MenuEntry => ({ kind: "action", label: account.email, icon: GoogleMark, detail: account.nodeIds.includes(nodeId) ? t("node.connectedHere") : t("node.inherited"), disabled: true, onSelect: () => {} })),
        ...(seen.length ? [{ kind: "separator" } as const] : []),
        accounts.data?.canConnect
          ? { kind: "action", label: t("node.connectGoogle"), icon: GoogleMark, onSelect: () => window.location.assign(new URL(`/api/google/connect?node=${nodeId}`, window.location.origin).toString()) }
          : { kind: "action", label: t("node.connectGoogle"), icon: GoogleMark, disabled: true, detail: accounts.data?.connectBlocked === "demo" ? t("node.needsSignIn") : t("node.notSetUp"), onSelect: () => {} },
        { kind: "action", label: t("node.manageSettings"), onSelect: () => router.push("/app/settings#accounts-settings") },
      ],
    },
    {
      kind: "choice",
      label: t("node.color"),
      value: node.ownColor ?? "none",
      options: [{ value: "none", label: node.color && !node.ownColor ? t("node.inheritedWord") : t("node.none") }, ...NODE_COLORS.map((color) => ({ value: color, label: t(COLOR_NAMES[color]) }))],
      onChoose: (value) => void setColor(value === "none" ? null : value),
    },
    {
      kind: "choice",
      label: t("node.icon"),
      icon: glyphOf(shownIcon(node.kind, node.icon)),
      value: node.ownIcon ?? "default",
      options: [
        { value: "default", label: node.icon && !node.ownIcon ? t("node.inheritedWord") : t("node.default"), icon: glyphOf(shownIcon(node.kind, node.icon && !node.ownIcon ? node.icon : null)) },
        ...NODE_ICONS.map((icon) => ({ value: icon, label: t(icon === "client" ? "kind.client" : icon === "project" ? "kind.project" : icon === "place" ? "icon.place" : icon === "task" ? "type.task" : icon === "calendar" ? "box.calendar" : icon === "mail" ? "box.mail" : icon === "note" ? "type.note" : "filter.account"), icon: glyphOf(icon) })),
      ],
      onChoose: (value) => void setIcon(value === "default" ? null : value),
    },
    ...customizeEntries(board, names),
    { kind: "separator" },
    { kind: "action", label: node.kind === "client" ? t("node.deleteClient") : t("node.deleteKind", { kind: oneWord }), tone: "danger", onSelect: () => void remove() },
  ];

  const tasksBox: BoxSpec = {
    id: "tasks",
    title: t("box.tasks"),
    purpose: t("box.tasksPurpose"),
    count: tasksCountLabel(view),
    action: (
      <HeadLink href={`/app/tasks?place=${nodeId}`} name={t("box.openAllItsTasks")}>
        {t("common.open")}
      </HeadLink>
    ),
    content: <TasksBoxContent read={tasksRead} now={now} place={place} placeId={nodeId} showPlace pageNode={nodeId} layout={layout} allHref={`/app/tasks?place=${nodeId}`} />,
  };
  const boxes: Record<string, BoxSpec> = {
    tasks: tasksBox,
    no_date: {
      id: "no_date",
      title: t("box.noDate"),
      purpose: t("box.noDatePurpose"),
      surface: "rest",
      count: noDateCount(view),
      action: noDateAdd.trigger,
      unfold: noDateAdd.editor,
      content: <NoDateBoxContent read={tasksRead} showPlace pageNode={nodeId} />,
    },
    calendar: {
      id: "calendar",
      title: t("box.calendar"),
      purpose: t("box.calendarPurposeNode"),
      action: (
        <HeadLink href={`/app/calendar?place=${nodeId}`} name={t("box.openCalendar")}>
          {t("common.open")}
        </HeadLink>
      ),
      content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(view)} calendarHref={`/app/calendar?place=${nodeId}`} />,
    },
    mail: {
      id: "mail",
      title: t("box.mail"),
      purpose: t("box.mailPurposeNode"),
      count: mailCount,
      action: (
        <HeadLink href="/app/mail" name={t("box.openAllMail")}>
          {t("common.open")}
        </HeadLink>
      ),
      content: (
        <MailBoxContent
          read={mail}
          replies={replies}
          account={null}
          now={now}
          place={place}
          connectHref={connectHref}
          connect={sessionEmail ? <ConnectSession nodeId={nodeId} email={sessionEmail} size="sm" blocked={blocked} /> : undefined}
        />
      ),
    },
    notes: {
      id: "notes",
      title: t("box.notes"),
      purpose: t("box.notesPurpose"),
      surface: "rest",
      count: notesCount(notes.data?.total),
      action: noteAdd.trigger,
      unfold: noteAdd.editor,
      content: <NotesBoxContent read={notes} place={place} />,
    },
    activity: {
      id: "activity",
      title: t("box.activity"),
      purpose: t("box.activityPurposeHere", { assistant: ASSISTANT_NAME }),
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
        count={<span data-node-count={node.openTasks}>{node.openTasks === 0 ? t("node.noOpenTasks") : counted(node.openTasks, "counted.openTask", "counted.openTasks")}</span>}
        layout={{ value: layout, onChange: chooseLayout }}
        chat
        more={<Menu label={t("common.more")} about={t("board.moreFor", { name: node.name })} entries={more} />}
      />
      <NodeStrip
        node={node}
        below={children}
        name={childName}
        one={one}
        connectHref={accounts.data ? connectHref : null}
        sessionEmail={sessionEmail}
        blocked={blocked}
        calendars={accounts.data?.accounts ?? null}
        adding={adding}
        addRound={addRound}
        onAdd={addChild}
        onAddDone={() => setAdding(false)}
      />
      <BoxBoard board={board} boxes={boxes} label={t("node.boxesOf", { name: node.name })} wide={layout === "board" ? tasksBox : null} />
      <RenameDialog open={renaming} name={node.name} nodeId={nodeId} onClose={() => setRenaming(false)} />
    </div>
    </ViewTransition>
  );
}

function NodeMark({ node }: { node: TreeNode }) {
  return (
    <span className="page-mark" data-color={node.color ?? undefined} aria-hidden="true">
      <NodeGlyph kind={node.kind} icon={node.icon} />
    </span>
  );
}

function accountFacts(figure: MailFigure | null, calendars: number | null): string {
  const unread = figure && !figure.partial && figure.unread === 0 ? translateNow("node.nothingUnread") : figureWords(figure);
  const shown = calendars === null ? null : calendars === 0 ? translateNow("node.noCalendars") : countedNow(calendars, "counted.calendar", "counted.calendars");
  const words = [unread, shown].filter(Boolean).join(", ");
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : translateNow("node.reading");
}

function NodeStrip({
  node,
  below,
  name,
  one,
  connectHref,
  sessionEmail,
  blocked,
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
  connectHref: string | null;
  sessionEmail: string | null;
  blocked: string | null;
  calendars: Account[] | null;
  adding: boolean;
  addRound: number;
  onAdd: () => void;
  onAddDone: () => void;
}) {
  const { t, counted } = useStrings();
  const { tree, mailAccounts, mailStore, notify, refreshTree, touch } = useWorkspace();
  const container = usePopupContainer();
  const addButton = useRef<HTMLButtonElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const id = useId();
  const seen = new Set(accountsSeenFrom(tree, mailAccounts ?? [], node.id));
  const address = sessionEmail?.toLowerCase() ?? null;
  const accounts = (mailAccounts ?? []).filter((account) => seen.has(account.id)).sort((a, b) => Number(b.email === address) - Number(a.email === address));
  const offerOwn = sessionEmail !== null && mailAccounts !== null && !accounts.some((account) => account.email === address);

  type ConnectLinkRow = { id: string; nodeId: string; status: string; email: string | null; expiresAt: string };
  const [links, setLinks] = useState<ConnectLinkRow[]>([]);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const loadLinks = useCallback(async () => {
    const answer = await get<{ links: ConnectLinkRow[] }>("/api/google/connect-links");
    if (answer.ok) setLinks(answer.links.filter((link) => link.nodeId === node.id));
  }, [node.id]);
  useEffect(() => {
    let live = true;
    void get<{ links: ConnectLinkRow[] }>("/api/google/connect-links").then((answer) => {
      if (live && answer.ok) setLinks(answer.links.filter((link) => link.nodeId === node.id));
    });
    const timer = window.setInterval(() => void loadLinks(), 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [loadLinks, node.id]);

  async function createLink() {
    setLinkBusy(true);
    const answer = await post<{ url: string }>("/api/google/connect-links", { action: "create", nodeId: node.id });
    setLinkBusy(false);
    if (answer.ok) {
      setLinkUrl(answer.url);
      void loadLinks();
    } else {
      notify({ text: answer.message, tone: "error" });
    }
  }

  async function actOnLink(linkId: string, action: "accept" | "reject" | "cancel") {
    const link = links.find((entry) => entry.id === linkId);
    setLinkBusy(true);
    const answer = await post("/api/google/connect-links", { action, id: linkId });
    setLinkBusy(false);
    if (answer.ok) {
      setLinkUrl(null);
      if (action === "accept") {
        void refreshTree();
        touch();
        if (link?.email) notify({ text: t("node.linkConnected", { email: link.email }), tone: "status" });
      }
      void loadLinks();
    } else {
      notify({ text: answer.message, tone: "error" });
    }
  }

  const connectMenu = (
    <>
      <Base.LinkItem className="option menu-item" label={t("node.connectHere")} href={connectHref ?? "/app/settings#accounts-settings"}>
        <span className="menu-item-text">
          <span className="menu-item-label">{t("node.connectHere")}</span>
        </span>
      </Base.LinkItem>
      <Base.Item className="option menu-item" disabled={linkBusy || Boolean(blocked)} onClick={() => void createLink()}>
        <span className="menu-item-text">
          <span className="menu-item-label">{t("node.connectFromAnother")}</span>
        </span>
      </Base.Item>
    </>
  );

  return (
    <div className="node-strip">
      <section className="node-strip-group" aria-labelledby={`${id}below`}>
        <h2 id={`${id}below`} className="t-label named-label">
          {name}
        </h2>
        <FlipList className="node-chips node-below" layout="grid">
          {below.map((child) => (
            <li key={child.id} data-flip-key={child.id}>
              <Link className={cx(buttonClass({}), "node-chip")} href={`/app/node/${child.id}`}>
                <span className="node-chip-name task-place-name" data-color={child.color ?? undefined}>
                  {child.name}
                </span>
                <span className="node-chip-detail">{child.openTasks === 0 ? t("node.noOpenTasks") : counted(child.openTasks, "counted.openTask", "counted.openTasks")}</span>
              </Link>
            </li>
          ))}
          <li data-flip-key="add">
            <Button ref={addButton} className="node-add" data-add-child aria-expanded={adding} aria-controls={`${id}new`} onClick={onAdd}>
              <AddIcon />
              <span className="btn-label">{t("node.addKind", { what: t(`kindWord.${one}` as "kindWord.project") })}</span>
            </Button>
          </li>
        </FlipList>
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
          {t("node.accounts")}
        </h2>
        <FlipList className="node-chips" layout="grid">
          {offerOwn && (
            <li data-flip-key="connect-own">
              <ConnectSession nodeId={node.id} email={sessionEmail!} primary={accounts.length === 0} detail={t("node.bringsHere")} blocked={blocked} />
            </li>
          )}
          {accounts.map((account) => {
            const known = calendars?.find((entry) => entry.id === account.id);
            const lost = account.status !== "active" && !account.isDemo;
            const own = account.email === address;
            const facts = accountFacts(mailStore.figure([account]), known ? known.calendars.filter((calendar) => calendar.selected).length : null);
            if (lost) {
              return (
                <li key={account.id} data-flip-key={account.id}>
                  <Link className={cx(buttonClass({}), "node-chip")} href="/app/settings#accounts-settings">
                    <span className="node-chip-name t-name">
                      <GoogleMark className="node-chip-mark" />
                      {account.email}
                    </span>
                    <span className="node-chip-detail" data-tone="alert">
                      {lostWords(account.status)}
                    </span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={account.id} data-flip-key={account.id}>
                <Base.Root modal={false}>
                  <Base.Trigger className={cx(buttonClass({}), "node-chip")}>
                    <span className="node-chip-name t-name">
                      <GoogleMark className="node-chip-mark" />
                      {account.email}
                    </span>
                    <span className="node-chip-detail">
                      {own ? (
                        <>
                          <span className="node-chip-own">{t("node.connected")}</span>
                          {facts === t("node.reading") ? null : ` · ${facts}`}
                        </>
                      ) : (
                        facts
                      )}
                    </span>
                  </Base.Trigger>
                  <Base.Portal container={container}>
                    <Base.Positioner className="positioner" sideOffset={6}>
                      <Base.Popup className="popup menu-popup">
                        <Base.LinkItem className="option menu-item" label={t("node.viewMail")} href={`/app/mail?account=${account.id}`}>
                          <span className="menu-item-text">
                            <span className="menu-item-label">{t("node.viewMail")}</span>
                          </span>
                        </Base.LinkItem>
                        <Base.LinkItem className="option menu-item" label={t("node.manageInSettings")} href="/app/settings#accounts-settings">
                          <span className="menu-item-text">
                            <span className="menu-item-label">{t("node.manageInSettings")}</span>
                          </span>
                        </Base.LinkItem>
                      </Base.Popup>
                    </Base.Positioner>
                  </Base.Portal>
                </Base.Root>
              </li>
            );
          })}
          {mailAccounts && connectHref && accounts.length > 0 && !blocked && !offerOwn && (
            <li data-flip-key="connect-more">
              <Base.Root modal={false}>
                <Base.Trigger className={cx(buttonClass({}), "node-chip", "node-add")}>
                  <span className="node-chip-name">
                    <AddIcon className="node-chip-mark" />
                    {t("node.connectAccount")}
                  </span>
                </Base.Trigger>
                <Base.Portal container={container}>
                  <Base.Positioner className="positioner" sideOffset={6}>
                    <Base.Popup className="popup menu-popup">{connectMenu}</Base.Popup>
                  </Base.Positioner>
                </Base.Portal>
              </Base.Root>
            </li>
          )}
          {mailAccounts && connectHref && accounts.length === 0 && !offerOwn && (
            <li data-flip-key="connect">
              <Base.Root modal={false}>
                <Base.Trigger className={cx(buttonClass({}), "node-chip node-connect")} aria-describedby={`${id}connect`}>
                  <span className="node-chip-name">
                    <GoogleMark className="node-chip-mark" />
                    {t("node.connectGoogleAccount")}
                  </span>
                  <span id={`${id}connect`} className="node-chip-detail">
                    {t("node.theOneUsedWith", { name: node.name })}
                  </span>
                </Base.Trigger>
                <Base.Portal container={container}>
                  <Base.Positioner className="positioner" sideOffset={6}>
                    <Base.Popup className="popup menu-popup">{connectMenu}</Base.Popup>
                  </Base.Positioner>
                </Base.Portal>
              </Base.Root>
            </li>
          )}
        </FlipList>
        {(linkUrl || links.length > 0) && (
          <div className="node-link-rows">
            {linkUrl && (
              <span className="node-link-row">
                <code id={`${id}link-url`} className="t-name node-link-url">{linkUrl}</code>
                <CopyButton text={linkUrl} target={`${id}link-url`} label={t("node.copyLink")} />
              </span>
            )}
            {links.map((link) =>
              link.status === "authorized" ? (
                <span key={link.id} className="node-link-row">
                  <span className="t-name">{link.email}</span>
                  <span className="t-help">{t("node.linkAuthorized")}</span>
                  <Button size="sm" variant="primary" onClick={() => void actOnLink(link.id, "accept")} disabled={linkBusy}>
                    <span className="btn-label">{t("node.accept")}</span>
                  </Button>
                  <Button size="sm" onClick={() => void actOnLink(link.id, "reject")} disabled={linkBusy}>
                    <span className="btn-label">{t("node.reject")}</span>
                  </Button>
                </span>
              ) : (
                <span key={link.id} className="node-link-row">
                  <span className="t-help">{t("node.linkWaiting")}</span>
                  <Button size="sm" onClick={() => void actOnLink(link.id, "cancel")} disabled={linkBusy}>
                    <span className="btn-label">{t("node.cancelLink")}</span>
                  </Button>
                </span>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RenameDialog({ open, name, nodeId, onClose }: { open: boolean; name: string; nodeId: string; onClose: () => void }) {
  const { t } = useStrings();
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
      <form className="rename-form" onSubmit={(event) => void submit(event)} data-cascade>
        <h2 id="rename-title" className="t-title">
          {t("node.rename")}
        </h2>
        <Field autoFocus aria-label={t("node.name")} value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValue(event.target.value)} />
        <div className="rename-actions">
          <Button size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!value.trim()}>
            {t("node.rename")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function NotHere() {
  const { t } = useStrings();
  return (
    <section className="card not-here" aria-labelledby="missing">
      <h1 id="missing" className="t-h1" tabIndex={-1} data-page-title>
        {t("node.notHereTitle")}
      </h1>
      <p className="t-help">{t("node.notHereBody")}</p>
      <div>
        <Link className={buttonClass({ variant: "primary" })} href="/app">
          <span className="btn-label">{t("node.goOverview")}</span>
        </Link>
      </div>
    </section>
  );
}

