"use client";

import { Link } from "@/components/ui/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { afterExit } from "@/components/ui/use-exit";
import { AddIcon, AlertIcon, CloseIcon, CopiedIcon, MenuIcon } from "@/components/ui/icons";
import { firstWeekday, today } from "@/lib/dates";
import type { PublicConfig } from "@/lib/env";
import { PRODUCT_NAME } from "@/lib/product";
import { sessionPerson, type SessionPerson } from "@/lib/session-person";
import { browserClient } from "@/lib/supabase/browser";
import { ChatDock, useDocked } from "./chat-panel";
import { forgetLayout, peekTool, post, tool, type Item, type TreeNode } from "./client-api";
import { EARLY_TREE, treeInput } from "./early-reads";
import { dropFocusRequestOutside, hasFocusRequest, onFocusRequest } from "./focus-request";
import { ItemPanel } from "./item-panel";
import { forgetLastNode, rememberLastNode } from "./last-node";
import { markStarted } from "./started";
import { createMailStore, type MailAccountRef, type MailFigure, type MailStore } from "./mail-store";
import { Palette } from "./palette";
import { Shortcuts } from "./shortcuts";
import { QuickAddDialog } from "./quick-add";
import { watchRounds } from "./read-again";
import { forgetReads, onReads, onRefreshes, refreshesInFlight, wrote } from "./read-cache";
import { MAIN_PAGES, warmPage, whenSettled, type Warmth } from "./warm-reads";
import { TaskDetail } from "./task-detail";
import { SCREEN_TITLES } from "./screen-titles";
import { openTaskDetail } from "./task-row";
import { SideNav, startTask, useCurrentNode } from "./side-nav";



type Notice = { id: number; text: string; tone: "status" | "error"; undo?: () => void; focusAfter?: () => HTMLElement | null };





const WARM_MAIN_PAGES = false;


const noticeLife = (notice: Notice) => (notice.undo ? 6000 : 3000);




type Chat = { scope: string | null | undefined; open: boolean; setOpen: (open: boolean) => void };

type Workspace = {
  config: PublicConfig;
  tree: TreeNode[] | null;
  treeError: string | null;
  
  taskCounts: { overdue: number; today: number } | null;
  
  generalTasks: number | null;
  
  notePlaces: { nodes: string[]; general: boolean } | null;
  
  mailAccounts: MailAccountRef[] | null;
  mailWaiting: WaitingRead[] | null;
  
  mailStore: MailStore;
  mailFigure: MailFigure | null;
  
  
  person: Person | null;
  signOut: () => void;
  refreshTree: () => Promise<void>;
  
  version: number;
  touch: () => void;
  notify: (notice: Omit<Notice, "id">) => void;
  
  
  saving: (promise: Promise<{ ok: boolean; message?: string }>, options?: { reread?: boolean }) => Promise<boolean>;
  openPalette: () => void;
  
  openItem: (item: Item) => void;
  chat: Chat;
  setChatScope: (scope: string | null | undefined) => void;
};

export type Person = SessionPerson & { email: string | null; isAnonymous: boolean };

function personOf(user: { email?: string; is_anonymous?: boolean; user_metadata?: Record<string, unknown> }): Person {
  return { email: user.email ?? null, isAnonymous: user.is_anonymous ?? false, ...sessionPerson(user.user_metadata) };
}

export type WaitingRead = { id: string; title: string; nodeId: string | null; path: string | null; color: TreeNode["color"]; accountId: string | null; waitsFor: string };

type TreeRead = {
  nodes: TreeNode[];
  tasks: { overdue: number; today: number } | null;
  generalTasks: number;
  mail: { accounts: MailAccountRef[]; waiting: WaitingRead[] } | null;
  notes: { nodes: string[]; general: boolean } | null;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace outside the workspace");
  return value;
}


export function useChatScope(scope: string | null): void {
  const { setChatScope } = useWorkspace();
  useEffect(() => {
    setChatScope(scope);
    return () => setChatScope(undefined);
  }, [scope, setChatScope]);
}

const noRevision = () => 0;

const CHAT_OPEN_KEY = "client-workspace:chat-open";

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHAT_OPEN_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHAT_OPEN_KEY, onChange);
  };
}



let treeOfLoad: { read: TreeRead | null } | undefined;
function keptTreeOfLoad(): TreeRead | null {
  treeOfLoad ??= { read: peekTool<TreeRead>("list_tree", treeInput(today()), true)?.value ?? null };
  return treeOfLoad.read;
}
const noTree = () => null;
const noSubscription = () => () => {};
const NO_ACCOUNTS: MailAccountRef[] = [];
const NO_WAITING: WaitingRead[] = [];

export function WorkspaceShell({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const [treeRead, setTreeRead] = useState<TreeRead | null>(null);
  const keptTree = useSyncExternalStore(noSubscription, keptTreeOfLoad, noTree);
  const shownTree = treeRead ?? keptTree;
  const [treeError, setTreeError] = useState<string | null>(null);
  const tree = shownTree?.nodes ?? null;
  const taskCounts = shownTree ? shownTree.tasks : null;
  const generalTasks = shownTree ? shownTree.generalTasks : null;
  const notePlaces = shownTree ? shownTree.notes : null;
  const mailAccounts = shownTree ? (shownTree.mail?.accounts ?? NO_ACCOUNTS) : null;
  const mailWaiting = shownTree ? (shownTree.mail?.waiting ?? NO_WAITING) : null;
  const [mailStore] = useState(() => createMailStore(tool));
  useSyncExternalStore(mailStore.subscribe, mailStore.revision, noRevision);
  const mailFigure = mailAccounts ? mailStore.figure(mailAccounts) : null;
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");
  
  const [lastStatus, setLastStatus] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatScope, setChatScope] = useState<string | null | undefined>(undefined);
  
  const docked = useDocked();
  const storedOpen = useSyncExternalStore(subscribeStorage, () => localStorage.getItem(CHAT_OPEN_KEY) === "1", () => false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const chatOpen = docked ? storedOpen : sheetOpen;
  const setChatOpen = useCallback(
    (open: boolean) => {
      if (!docked) return setSheetOpen(open);
      localStorage.setItem(CHAT_OPEN_KEY, open ? "1" : "0");
      window.dispatchEvent(new Event(CHAT_OPEN_KEY));
    },
    [docked],
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queued = useRef<Notice | null>(null);
  const noticeHost = useModalHost();
  const counter = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  const refreshTree = useCallback(
    () =>
      tool<TreeRead>("list_tree", treeInput(today())).then((answer) => {
        
        if (answer.ok) {
          setTreeRead(answer);
          setTreeError(null);
          markStarted(answer.nodes.length > 0);
        } else setTreeError(answer.message);
      }),
    [],
  );

  
  
  
  
  const accountsKey = mailAccounts?.map((account) => account.id).join() ?? "";
  useEffect(() => {
    for (const account of mailAccounts ?? []) mailStore.count(account);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, mailStore, version]);

  const lastRound = useRef(0);
  const readAgain = useCallback(() => {
    lastRound.current = Date.now();
    mailStore.forget();
    setVersion((v) => v + 1);
    void refreshTree();
  }, [refreshTree, mailStore]);
  
  
  const touch = useCallback(() => {
    wrote();
    readAgain();
  }, [readAgain]);

  
  
  useEffect(() => {
    lastRound.current = Date.now();
    return watchRounds(
      document,
      () => Date.now() - lastRound.current,
      () => {
        mailStore.aged();
        readAgain();
      },
    );
  }, [mailStore, readAgain]);

  
  
  
  const [weekStart] = useState(() => (typeof window === "undefined" ? 1 : firstWeekday()));
  const warmth = useRef<Warmth | null>(null);
  useEffect(() => {
    warmth.current = tree && mailAccounts && mailWaiting ? { today: today(), weekStart, tree, accounts: mailAccounts, waiting: mailWaiting, mailStore } : null;
  });
  const treeKnown = tree !== null;
  useEffect(() => {
    if (!treeKnown || !WARM_MAIN_PAGES) return;
    return whenSettled(() => {
      const known = warmth.current;
      if (!known) return;
      for (const page of MAIN_PAGES) if (page !== window.location.pathname) warmPage(page, known);
    });
    
  }, [treeKnown]);
  useEffect(() => {
    let last = "";
    const onTheWay = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='/app']") : null;
      const href = link?.getAttribute("href");
      if (!href || href === last || !warmth.current) return;
      last = href;
      warmPage(href, warmth.current);
    };
    
    const stop = onReads(() => {
      last = "";
    });
    document.addEventListener("pointerover", onTheWay);
    document.addEventListener("focusin", onTheWay);
    return () => {
      stop();
      document.removeEventListener("pointerover", onTheWay);
      document.removeEventListener("focusin", onTheWay);
    };
  }, []);

  
  const shown = useRef<Notice | null>(null);
  const show = useCallback((next: Notice | null) => {
    shown.current = next;
    setNotice(next);
  }, []);
  const noticeBox = useRef<HTMLDivElement>(null);
  const heldBefore = useRef<HTMLElement | null>(null);
  const pointerOnNotice = useRef(false);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    if (!shown.current) return show(queued.current);
    
    if (noticeBox.current?.contains(document.activeElement)) {
      const { focusAfter } = shown.current;
      const before = heldBefore.current;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const target = focusAfter?.() ?? (before?.isConnected ? before : null) ?? document.querySelector<HTMLElement>("[data-page-title]");
          target?.focus({ preventScroll: true });
        }),
      );
    }
    setLeaving(true);
  }, [show]);
  
  useEffect(() => {
    if (!leaving) return;
    return afterExit(noticeBox.current, () => {
      setLeaving(false);
      const next = queued.current;
      queued.current = null;
      show(next);
    });
  }, [leaving, show]);

  useEffect(() => {
    if (!notice || leaving) return;
    
    if (notice.tone === "status") {
      clearTimeout(timer.current);
      timer.current = setTimeout(dismiss, noticeLife(notice));
    }
  }, [notice, leaving, dismiss]);

  
  
  useEffect(() => {
    pointerOnNotice.current = false;
    if (!notice) return;
    const holder = document.activeElement;
    const free = !holder || holder === document.body || holder.closest("[data-leaving]") !== null;
    heldBefore.current = free ? null : (holder as HTMLElement);
    if (free && notice.undo) noticeBox.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [notice]);

  const notify = useCallback(
    (next: Omit<Notice, "id">) => {
      const entry = { ...next, id: ++counter.current };
      if (!shown.current) return show(entry);
      queued.current = entry;
      dismiss();
    },
    [dismiss, show],
  );

  const saving = useCallback(
    async (promise: Promise<{ ok: boolean; message?: string }>, { reread = true }: { reread?: boolean } = {}) => {
      clearTimeout(statusTimer.current);
      setStatus("Saving…");
      setLastStatus("Saving…");
      const answer = await promise;
      if (answer.ok) {
        setStatus("Saved");
        setLastStatus("Saved");
        
        statusTimer.current = setTimeout(() => setStatus(""), 2000);
        if (reread) touch();
        return true;
      }
      setStatus("");
      notify({ text: answer.message ?? "The change could not be saved.", tone: "error" });
      return false;
    },
    [notify, touch],
  );

  useEffect(() => {
    void refreshTree();
    
    
    const auth = browserClient(config).auth;
    void auth.getSession().then(({ data }) => {
      if (data.session) setPerson(personOf(data.session.user));
    });
    const {
      data: { subscription },
    } = auth.onAuthStateChange((event, session) => {
      if (event === "USER_UPDATED" && session) setPerson(personOf(session.user));
    });
    return () => subscription.unsubscribe();
  }, [refreshTree, config]);

  
  useEffect(() => {
    const match = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/);
    if (match) rememberLastNode(match[1]);
  }, [pathname]);

  
  useEffect(() => dropFocusRequestOutside(pathname), [pathname]);

  
  
  
  const lastScreen = useRef(pathname);
  useEffect(() => {
    if (lastScreen.current === pathname) return;
    lastScreen.current = pathname;
    if (hasFocusRequest(pathname)) return;
    const focusTitle = () => document.querySelector<HTMLElement>("[data-page-title]")?.focus({ preventScroll: true });
    focusTitle();
    const frame = requestAnimationFrame(focusTitle);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  
  
  
  useEffect(() => {
    const id = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1];
    const name = id ? tree?.find((node) => node.id === id)?.name : SCREEN_TITLES[pathname];
    if (name) document.title = `${name} · ${PRODUCT_NAME}`;
  }, [pathname, tree]);

  
  
  useEffect(() => {
    if (!drawerOpen) return;
    return onFocusRequest(() => setDrawerOpen(false));
  }, [drawerOpen]);

  
  const [placeSeen, setPlaceSeen] = useState(pathname);
  if (placeSeen !== pathname) {
    setPlaceSeen(pathname);
    setDrawerOpen(false);
  }

  
  
  const currentNode = useCurrentNode();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key.toLowerCase() !== "q" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      startTask(currentNode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentNode]);

  const signOut = useCallback(async () => {
    await forgetLayout();
    await browserClient(config).auth.signOut();
    forgetLastNode();
    
    forgetReads();
    treeOfLoad = undefined;
    router.replace("/");
  }, [config, router]);
  const leave = useCallback(() => void signOut(), [signOut]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  
  const openItem = useCallback((item: Item) => {
    if (item.type !== "task") return setDetail(item);
    openTaskDetail({
      id: item.id,
      task: {
        id: item.id,
        title: item.title,
        nodeId: item.nodeId,
        path: item.nodePath,
        parentId: item.parentId,
        status: item.status,
        priority: item.priority,
        dueOn: item.dueOn,
        dueTime: item.dueTime ?? null,
        source: item.source,
        agentLabel: item.agentLabel,
        createdAt: item.createdAt,
      },
    });
  }, []);
  
  const closeItem = useCallback((id: string) => {
    setDetail(null);
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-item="${id}"]`);
      const target = row?.querySelector<HTMLElement>("[data-detail]") ?? row?.querySelector<HTMLElement>("[data-item-title]");
      target?.focus({ preventScroll: true });
    });
  }, []);
  
  const deleteItem = useCallback(
    async (item: Item) => {
      const fold = document.querySelector(`[data-item="${item.id}"]`)?.closest(".row-fold");
      fold?.toggleAttribute("data-leaving", true);
      if (fold) await new Promise((resolve) => setTimeout(resolve, 220));
      const answer = await tool("delete_item", { id: item.id });
      if (!answer.ok) {
        fold?.toggleAttribute("data-leaving", false);
        return notify({ text: answer.message, tone: "error" });
      }
      touch();
      notify({ text: `Deleted “${item.title}”`, tone: "status", undo: () => void saving(post(`/api/items/${item.id}/restore`, {})) });
    },
    [notify, touch, saving],
  );
  
  const [chatMotion, setChatMotion] = useState(false);
  useEffect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setChatMotion(true))));
    return () => cancelAnimationFrame(frame);
  }, []);
  const chat: Chat = { scope: chatScope, open: chatOpen, setOpen: setChatOpen };
  const value: Workspace = { config, tree, treeError, taskCounts, generalTasks, notePlaces, mailAccounts, mailWaiting, mailStore, mailFigure, person, signOut: leave, refreshTree, version, touch, notify, saving, openPalette, openItem, chat, setChatScope };
  const chatColumn = docked && chatOpen && chatScope !== undefined;

  return (
    <WorkspaceContext.Provider value={value}>
      <EarlyTree />
      <ReadingLine />
      <a href="#content" className="skip-link btn btn-primary">
        <span className="btn-label">Skip to content</span>
      </a>
      <div className="shell" data-chat={chatColumn ? "open" : undefined} data-chat-motion={chatMotion || undefined}>
        <header className="topbar">
          <Button className="drawer-trigger btn-icon" size="sm" variant="quiet" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>
            <MenuIcon />
            <span className="sr-only">Menu</span>
          </Button>
          <Link href="/app" className="brand" aria-label={`${PRODUCT_NAME}, Overview`}>
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </Link>
        </header>
        {}
        <div className="sidebar">
          <SideNav onSignOut={leave} />
        </div>
        {}
        <span className="save-status t-meta" data-shown={status ? "" : undefined} aria-hidden="true" {...(status ? { "data-save-status": "" } : {})}>
          {lastStatus}
        </span>
        <main id="content" className="main" tabIndex={-1}>
          {children}
        </main>
        <ChatDock />
      </div>
      {}
      <Button variant="primary" className="add-task-float" data-add-task-float onClick={() => startTask(currentNode)} aria-keyshortcuts="Q">
        <AddIcon />
        <span className="btn-label">Add task</span>
      </Button>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSignOut={leave} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Shortcuts />
      <TaskDetail />
      <QuickAddDialog />
      <ItemPanel item={detail} saving={saving} version={version} onClose={closeItem} onDelete={(item) => void deleteItem(item)} />
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {}
      {withHost(
        noticeHost,
        <div className="notices" popover="manual" ref={showLayer} aria-live="polite">
          {notice && (
            <div
              key={notice.id}
              ref={noticeBox}
              role={notice.tone === "error" ? "alert" : "status"}
              className="notice"
              data-tone={notice.tone}
              data-leaving={leaving ? "" : undefined}
              inert={leaving}
              data-notice
              
              
              onPointerMove={(event) => {
                if (leaving || notice.tone !== "status" || pointerOnNotice.current || (!event.movementX && !event.movementY)) return;
                pointerOnNotice.current = true;
                clearTimeout(timer.current);
              }}
              onPointerLeave={() => {
                if (!pointerOnNotice.current) return;
                pointerOnNotice.current = false;
                if (!leaving && notice.tone === "status") timer.current = setTimeout(dismiss, noticeLife(notice));
              }}
            >
              {}
              <span className="notice-mark" aria-hidden="true">
                {notice.tone === "error" ? <AlertIcon /> : <CopiedIcon />}
              </span>
              <span className="t-value notice-text">{notice.text}</span>
              {notice.undo && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    notice.undo?.();
                    dismiss();
                  }}
                >
                  Undo
                </Button>
              )}
              {notice.tone === "error" && (
                <Button size="sm" onClick={dismiss}>
                  Close
                </Button>
              )}
            </div>
          )}
        </div>,
      )}
    </WorkspaceContext.Provider>
  );
}



function EarlyTree() {
  const fromServer = useSyncExternalStore(noSubscription, () => false, () => true);
  return fromServer ? <script dangerouslySetInnerHTML={{ __html: EARLY_TREE }} /> : null;
}




function ReadingLine() {
  const reading = useSyncExternalStore(onRefreshes, () => refreshesInFlight() > 0, () => false);
  return <div className="reading-line" data-reading={reading || undefined} aria-hidden="true" />;
}




function useModalHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const read = () =>
      setHost([...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter((dialog) => dialog.isConnected && dialog.matches(":modal")).at(-1) ?? null);
    const holdsDialog = (node: Node) => node instanceof Element && (node.matches("dialog") || node.querySelector("dialog") !== null);
    const watch = new MutationObserver((changes) => {
      if (changes.some((change) => change.type === "attributes" || [...change.addedNodes, ...change.removedNodes].some(holdsDialog))) read();
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    read();
    return () => watch.disconnect();
  }, []);
  return host;
}

const withHost = (host: HTMLElement | null, layer: ReactNode) => (host ? createPortal(layer, host) : layer);


function showLayer(element: HTMLElement | null) {
  if (element && !element.matches(":popover-open")) element.showPopover();
}


function Drawer({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="dialog drawer"
      aria-labelledby="drawer-title"
      onClose={onClose}
      
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) onClose();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      <div className="drawer-in">
        <div className="drawer-head">
          <h2 id="drawer-title" className="t-title">
            Menu
          </h2>
          <Button size="sm" variant="quiet" className="btn-icon" onClick={onClose} title="Close">
            <CloseIcon />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        <SideNav inDrawer onLeave={onClose} onSignOut={onSignOut} />
      </div>
    </dialog>
  );
}
