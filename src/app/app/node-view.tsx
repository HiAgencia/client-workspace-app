"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { firstWeekday, today, weekOf } from "@/lib/dates";
import { Empty } from "./blocks";
import { ChatToggle } from "./chat-panel";
import { get, tool, type Board, type Item, type TreeNode } from "./client-api";
import { ConnectBlockedNote, type ConnectBlocked } from "./connect-blocked";
import { land, onFocusRequest, takeFocusRequest, type FocusTarget, type Landing } from "./focus-request";
import { ItemList, ItemRow, QuickAdd } from "./items";
import {
  ActivitySection,
  AgendaSection,
  KIND_NAME,
  NodeCards,
  placesIn,
  plural,
  ReviewSection,
  TasksSection,
  tasksInput,
  useAgenda,
  useBoardState,
  useRead,
  type BoardState,
  type Browse,
  type Read,
  type SetBoard,
} from "./sections";
import { NewNode } from "./side-nav";
import { useWorkspace } from "./workspace";

// The latest notes, decisions, and links of the node and of everything below it, each with its path, and how many there
// are in all.
type Overview = {
  node: { id: string; path: string; kind: TreeNode["kind"] };
  children: Array<{ id: string; name: string }>;
  notes: Item[];
  decisions: Item[];
  links: Item[];
  totals: Record<"notes" | "decisions" | "links", number>;
};

type Account = { id: string; email: string; status: string; nodeIds: string[] };
type Accounts = { list: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked };

function ancestorsOf(tree: TreeNode[] | null, nodeId: string): TreeNode[] {
  const chain: TreeNode[] = [];
  for (let cursor = tree?.find((n) => n.id === nodeId); cursor; cursor = tree?.find((n) => n.id === cursor!.parentId)) chain.unshift(cursor);
  return chain;
}

// A client's page or a project's page, composed like the Overview over one node and what is below it, in its order: the
// tasks and the agenda, its projects or subprojects where the Overview has its clients and projects, what waits for review
// and what changed, and then what the node and those below it keep. Both read the node through the tool layer and repaint
// in place when it is read again.
export function NodeView({ nodeId, googleOutcome }: { nodeId: string; googleOutcome: string | null }) {
  const { version, tree, notify } = useWorkspace();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [weekStart] = useState(() => firstWeekday());
  const now = today();
  const week = weekOf(now, weekStart);
  const board = useRead<Board>("get_board", { node: nodeId, today: now, from: week.from, through: week.to });
  const { state, set } = useBoardState("all");
  // Tasks leads the page: its first list is read with the node, so the page enters whole instead of a placeholder that
  // grows and pushes what is below. Read once per visit; the section reads again on its own afterwards.
  const [firstTasks, setFirstTasks] = useState<{ read: Read<Browse> | null } | null>(null);
  const firstInput = useRef(tasksInput(nodeId, state, now, weekStart));

  useEffect(() => {
    let live = true;
    const input = firstInput.current;
    void tool<Browse>("browse_items", input).then((answer) => {
      // A failed read leaves the section to read and say it.
      if (live) setFirstTasks({ read: answer.ok ? { key: JSON.stringify(input), value: answer } : null });
    });
    return () => {
      live = false;
    };
  }, [nodeId]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      tool<Overview>("get_overview", { node: nodeId, withEvents: false }),
      get<{ accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked }>("/api/accounts"),
    ]).then(([answer, accountsAnswer]) => {
      // An answer for a node the person already left does not paint here.
      if (!live) return;
      if (answer.ok) {
        setOverview(answer);
        setError(null);
      } else if (answer.code === "not_found") setNotFound(true);
      else setError(answer.message);
      if (accountsAnswer.ok) {
        setAccounts({ list: accountsAnswer.accounts, canConnect: accountsAnswer.canConnect, connectBlocked: accountsAnswer.connectBlocked });
        setAccountsError(null);
      } else setAccountsError(accountsAnswer.message);
    });
    return () => {
      live = false;
    };
  }, [nodeId, version]);

  // The palette, the sidebar, or a row's path may have asked to land somewhere in this node. A done task or a reviewed
  // item lives behind its section's other tab, so that tab opens first. The place may belong to a section still reading:
  // the landing waits for it to paint, and says the place is not on the page only once nothing on it is reading.
  const setBoard = useRef(set);
  useEffect(() => {
    setBoard.current = set;
  }, [set]);
  // The page paints once its node, the tree, its figures, and its first Tasks list are read (below): the landing starts
  // then, never over the placeholder, where it would find nothing and say the place is missing.
  const ready = overview !== null && tree !== null && firstTasks !== null && (board.data !== null || board.error !== null);
  useEffect(() => {
    if (!ready) return;
    let watch: MutationObserver | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      watch?.disconnect();
      watch = null;
      clearTimeout(deadline);
    };
    const apply = () => {
      const request = takeFocusRequest(nodeId);
      if (!request) return;
      stop();
      const { target } = request;
      // The tab a done item lives behind; the address changes a frame or two later, so the landing waits until that tab
      // is the chosen one before it can say the place is missing.
      const section = target.kind === "item" && target.done ? (target.type === "task" ? "tasks" : target.type === "review" ? "review" : null) : null;
      if (section === "tasks") setBoard.current({ status: "done", tasks: null, priority: null });
      if (section === "review") setBoard.current({ review: "done" });
      const tab = section ? `[data-section='${section}'] [role='tab'][data-tab='done'][aria-selected='true']` : null;
      const page = () => document.querySelector(`[data-node-view="${nodeId}"]`);
      const attempt = (final: boolean): boolean => {
        const landing = land(target, { acted: request.acted });
        if (landing === "landed" || landing === "busy") return true;
        const reading = page()?.querySelector("[aria-busy='true']") || (tab !== null && !document.querySelector(tab));
        if (landing === "missing" && !final && reading) return false;
        notify({ text: notLanded(target, landing), tone: "status" });
        return true;
      };
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const root = page();
          if (attempt(false) || !root) return;
          watch = new MutationObserver(() => {
            if (attempt(false)) stop();
          });
          watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy", "aria-selected"] });
          deadline = setTimeout(() => {
            stop();
            attempt(true);
          }, 15_000);
        }),
      );
    };
    apply();
    const off = onFocusRequest(apply);
    return () => {
      off();
      stop();
    };
  }, [ready, nodeId, notify]);

  if (notFound) {
    return (
      <section className="card stack" aria-labelledby="missing">
        <h1 id="missing" className="t-h1">
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
  // The page enters whole: its path and its projects come from the tree, its header's and its cards' figures from the
  // board, and its tasks lead it, so it waits for those reads instead of painting and then pushing what is below —a figure
  // that arrives later adds words to the header, which takes another line on a phone. A board that failed lets it in.
  if (!ready || !overview || tree === null || firstTasks === null) return <NodeSkeleton failed={error} />;

  const chain = ancestorsOf(tree, nodeId);
  const node = chain.at(-1);
  const name = node?.name ?? overview.node.path.split(" / ").at(-1) ?? overview.node.path;
  const children = tree.filter((entry) => entry.parentId === nodeId);
  const figures = board.stale ? null : board.data;

  return (
    <article className="page board fade-enter" data-node-view={nodeId} data-node-kind={overview.node.kind}>
      <NodeHeader overview={overview} name={name} ancestors={chain.slice(0, -1)} board={figures} below={children} node={node} googleOutcome={googleOutcome} error={error} />
      <WorkRows nodeId={nodeId} tree={tree} state={state} set={set} now={now} weekStart={weekStart} firstTasks={firstTasks.read}>
        <ChildrenSection parent={node} nodes={children} board={figures} failed={board.error !== null} />
      </WorkRows>
      <div className="board-row board-row-split">
        <Section title="Notes" type="note" nodeId={nodeId} items={overview.notes} total={overview.totals.notes} empty="No notes here yet." />
        <Section title="Decisions" type="decision" nodeId={nodeId} items={overview.decisions} total={overview.totals.decisions} empty="No decisions here yet." />
      </div>
      <div className="board-row board-row-split">
        <Section title="Links" type="link" nodeId={nodeId} items={overview.links} total={overview.totals.links} empty="No links saved here yet." />
        <AccountsCard nodeId={nodeId} accounts={accounts} failed={accountsError} chain={chain} />
      </div>
    </article>
  );
}

// The node's work, in the Overview's own sections and order: the tasks and the agenda side by side, the node's projects or
// subprojects (`children`) where the Overview has its clients and projects, then what waits for review and what changed.
function WorkRows({
  nodeId,
  tree,
  state,
  set,
  now,
  weekStart,
  firstTasks,
  children,
}: {
  nodeId: string;
  tree: TreeNode[];
  state: BoardState;
  set: SetBoard;
  now: string;
  weekStart: number;
  firstTasks: Read<Browse> | null;
  children: ReactNode;
}) {
  const agenda = useAgenda(nodeId, state.agenda, now, weekStart);
  return (
    <>
      <div className="board-row board-row-wide">
        <TasksSection scope={nodeId} state={state} set={set} now={now} weekStart={weekStart} places={placesIn(tree, nodeId)} defaultTasks="all" initial={firstTasks} />
        <AgendaSection agenda={agenda} state={state} set={set} now={now} weekStart={weekStart} calendarHref={`/app/calendar?scope=${nodeId}`} />
      </div>
      {children}
      <div className="board-row board-row-split">
        <ReviewSection scope={nodeId} state={state} set={set} addTo={nodeId} />
        <ActivitySection scope={nodeId} state={state} set={set} />
      </div>
    </>
  );
}

function NodeHeader({
  overview,
  name,
  ancestors,
  board,
  below,
  node,
  googleOutcome,
  error,
}: {
  overview: Overview;
  name: string;
  ancestors: TreeNode[];
  board: Board | null;
  // Its projects or subprojects.
  below: TreeNode[];
  node: TreeNode | undefined;
  googleOutcome: string | null;
  error: string | null;
}) {
  const figures = board?.figures;
  // The node's open tasks count its whole subtree, the same number the sidebar and its card show; a project says how
  // many of them are in its subprojects, so the header and its own Tasks reconcile on sight.
  const open = figures?.open ?? node?.openTasks;
  const perNode = new Map((board?.nodes ?? []).map((entry) => [entry.id, entry.open]));
  const busy = below.filter((child) => (perNode.get(child.id) ?? 0) > 0);
  const inChildren = busy.reduce((sum, child) => sum + (perNode.get(child.id) ?? 0), 0);
  const kind = overview.node.kind;
  return (
    <header className="card page-head">
      <div className="page-head-row page-head-split">
        <div className="stack page-head-text">
          {ancestors.length > 0 ? (
            <nav aria-label="Path" className="t-meta node-eyebrow">
              <span>{KIND_NAME[kind]} of</span>
              <ol className="crumbs">
                {ancestors.map((entry) => (
                  <li key={entry.id}>
                    <Link className="link" href={`/app/node/${entry.id}`}>
                      {entry.name}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          ) : (
            <p className="t-meta">{kind === "client" ? "Client" : "Project of your own"}</p>
          )}
          <h1 className="t-h1" tabIndex={-1} data-node-title>
            {name}
          </h1>
        </div>
        <div className="page-actions">
          <ChatToggle />
          <Link className={buttonClass({ size: "sm" })} href={`/app/settings?node=${overview.node.id}#agent-tokens`}>
            <span className="btn-label">Issue an agent token</span>
          </Link>
        </div>
      </div>
      <div className="facts t-meta" data-node-count={open}>
        {kind === "client" && <span className="nowrap">{plural(below.length, "project", "projects")}</span>}
        {open !== undefined && (
          <span className="nowrap">
            {plural(open, "open task", "open tasks")}
            {kind !== "client" && inChildren > 0 && `, ${inChildren} in ${busy.length === 1 ? busy[0].name : "subprojects"}`}
          </span>
        )}
        {figures && <span className="nowrap">{figures.late} late</span>}
        {(figures || node) && <span className="nowrap">{plural(figures?.toReview ?? node!.openReviews, "item to review", "items to review")}</span>}
      </div>
      {googleOutcome && <GoogleOutcome outcome={googleOutcome} />}
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          It could not be refreshed: {error}. What you see is the last version read.
        </p>
      )}
    </header>
  );
}

// A client's projects, or a project's subprojects: one card each, with its own "New".
function ChildrenSection({ parent, nodes, board, failed }: { parent: TreeNode | undefined; nodes: TreeNode[]; board: Board | null; failed: boolean }) {
  const { tree } = useWorkspace();
  const [adding, setAdding] = useState(false);
  if (!parent) return null;
  const many = parent.kind === "client" ? "projects" : "subprojects";
  const one = parent.kind === "client" ? "project" : "subproject";
  return (
    <section className="card board-section" aria-labelledby="children-title" id="children" data-section="children">
      <div className="section-head">
        <div className="section-title">
          <h2 id="children-title" className="t-title" tabIndex={-1}>
            {`${many[0].toUpperCase()}${many.slice(1)} of ${parent.name}`}
          </h2>
          <span className="t-meta">{nodes.length}</span>
        </div>
        <div className="section-filters">
          <Button size="sm" onClick={() => setAdding(true)} data-add-child>
            {`New ${one}`}
          </Button>
        </div>
      </div>
      {adding && (
        <div className="tree-new section-new">
          <NewNode parent={parent} onDone={() => setAdding(false)} />
        </div>
      )}
      <NodeCards nodes={nodes} tree={tree ?? []} board={board} failed={failed} empty={!adding && <Empty text={`No ${many} in ${parent.name} yet.`} />} />
    </section>
  );
}

function AccountsCard({ nodeId, accounts, failed, chain }: { nodeId: string; accounts: Accounts | null; failed: string | null; chain: TreeNode[] }) {
  const { tree } = useWorkspace();
  const visible = (accounts?.list ?? [])
    .map((account) => ({ account, from: chain.map((n) => n.id).reverse().find((id) => account.nodeIds.includes(id)) }))
    .filter((entry) => entry.from);
  const node = chain.at(-1);
  const above = chain.slice(0, -1);
  return (
    <section className="card board-section" aria-labelledby="accounts">
      <div className="section-head">
        <div className="section-title">
          <h2 id="accounts" className="t-title">
            Google accounts
          </h2>
        </div>
      </div>
      {accounts === null ? (
        failed ? (
          <p role="alert" className="inline-note" data-tone="alert">
            The Google accounts could not be read: {failed}. Reload the page to try again.
          </p>
        ) : (
          <div className="stack" role="status" aria-label="Loading accounts" aria-busy="true">
            <span className="skeleton" style={{ width: "70%" }} />
            <span className="skeleton" style={{ width: "45%" }} />
          </div>
        )
      ) : (
        <div className="stack">
          {visible.length === 0 ? (
            <p className="t-help">
              {`No Google account connected yet. An account connected here${above.length > 0 ? `, or to ${above.map((n) => n.name).join(" or ")},` : ""} shows its calendars on this page${node?.kind === "client" ? " and on its projects" : ""}.`}
            </p>
          ) : (
            <ul className="plain-list stack">
              {visible.map(({ account, from }) => (
                <li key={account.id} className="account-line">
                  <span className="t-name">{account.email}</span>
                  <span className="pill" data-tone={from === nodeId ? "accent" : undefined}>
                    {from === nodeId ? "Connected here" : `Connected to ${tree?.find((n) => n.id === from)?.name ?? "a parent"}`}
                  </span>
                  {account.status !== "active" && (
                    <span className="pill" data-tone="alert">
                      {account.status === "revoked" ? "Access revoked: connect it again" : account.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {failed && (
            <p role="alert" className="inline-note" data-tone="alert">
              The Google accounts could not be refreshed: {failed}.
            </p>
          )}
          {accounts.canConnect ? (
            <div>
              <a className={buttonClass({ size: "sm" })} href={`/api/google/connect?node=${nodeId}`}>
                <span className="btn-label">Connect a Google account here</span>
              </a>
            </div>
          ) : (
            <ConnectBlockedNote reason={accounts.connectBlocked} />
          )}
        </div>
      )}
    </section>
  );
}

// What the node and those below it keep: each row says where it lives when that is not the page's own node. The section
// lists the latest ones and says how many there are in all; search finds the rest.
function Section({ title, type, nodeId, items, total, empty }: { title: string; type: Item["type"]; nodeId: string; items: Item[]; total: number; empty: string }) {
  const id = `section-${type}`;
  const more = total > items.length;
  return (
    <section className="card board-section" aria-labelledby={id} data-section={type}>
      <div className="section-head">
        <div className="section-title">
          <h2 id={id} className="t-title">
            {title}
          </h2>
          {items.length > 0 && <span className="t-meta">{more ? `${items.length} of ${total}` : items.length}</span>}
        </div>
      </div>
      <QuickAdd nodeId={nodeId} type={type} />
      {items.length === 0 ? (
        <Empty text={empty} />
      ) : (
        <ItemList items={items}>{(item) => <ItemRow item={item} showPath={item.nodeId !== nodeId} />}</ItemList>
      )}
      {more && <p className="t-meta">{`Showing the latest ${items.length} of ${total}. Search finds the others.`}</p>}
    </section>
  );
}

function notLanded(target: FocusTarget, landing: Landing): string {
  if (landing === "hidden") return "That place is there, but something on top of it holds the focus: close it and try again.";
  if (target.kind !== "item") return "That place is not on this page.";
  if (target.type === "note" || target.type === "decision" || target.type === "link") return `“${target.title}” is not on this page: it lists the latest ${target.type}s.`;
  return `“${target.title}” is not on this page anymore.`;
}

function NodeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <section className="card stack" role="alert">
        <h1 className="t-title">This page could not be read</h1>
        <p className="t-help">{failed}. Reload the page to try again.</p>
      </section>
    );
  }
  return (
    <div className="page" role="status" aria-label="Loading" aria-busy="true">
      <div className="card stack">
        <span className="skeleton" style={{ width: "18%" }} />
        <span className="skeleton skeleton-title" style={{ width: "42%", height: "1.9rem" }} />
        <span className="skeleton" style={{ width: "30%" }} />
      </div>
      <div className="card stack">
        <span className="skeleton skeleton-title" style={{ width: "16%" }} />
        <span className="skeleton" style={{ width: "100%", height: "2.5rem" }} />
        {["72%", "58%", "64%"].map((width) => (
          <span key={width} className="skeleton" style={{ width }} />
        ))}
      </div>
    </div>
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
    <p role={outcome === "connected" ? "status" : "alert"} className="inline-note" data-tone={outcome === "connected" ? "accent" : "alert"}>
      {text}
    </p>
  );
}
