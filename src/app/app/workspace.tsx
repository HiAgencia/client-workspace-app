"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { today } from "@/lib/dates";
import type { PublicConfig } from "@/lib/env";
import { browserClient } from "@/lib/supabase/browser";
import { ChatDock, useDocked } from "./chat-panel";
import { forgetLayout, post, tool, type Item, type TreeNode } from "./client-api";
import { dropFocusRequestOutside, onFocusRequest } from "./focus-request";
import { ItemPanel } from "./item-panel";
import { Palette } from "./palette";
import { QuickAddDialog } from "./quick-add";
import { ReviewNotice } from "./review-notice";
import { TaskDetail } from "./task-detail";
import { openTaskDetail } from "./task-row";
import { SideNav, startTask, useCurrentNode } from "./side-nav";



type Notice = { id: number; text: string; tone: "status" | "error"; undo?: () => void; quiet?: boolean; lasts?: number };




type Chat = { scope: string | null | undefined; open: boolean; setOpen: (open: boolean) => void };

type Workspace = {
  config: PublicConfig;
  tree: TreeNode[] | null;
  treeError: string | null;
  
  taskCounts: { overdue: number; today: number } | null;
  
  mailUnread: number | null;
  
  who: string | null;
  refreshTree: () => Promise<void>;
  
  version: number;
  touch: () => void;
  notify: (notice: Omit<Notice, "id">) => void;
  saving: (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
  openPalette: () => void;
  
  openItem: (item: Item) => void;
  chat: Chat;
  setChatScope: (scope: string | null | undefined) => void;
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

export const LAST_NODE_KEY = "client-workspace:last-node";
const CHAT_OPEN_KEY = "client-workspace:chat-open";

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHAT_OPEN_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHAT_OPEN_KEY, onChange);
  };
}

export function WorkspaceShell({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<Workspace["taskCounts"]>(null);
  const [mailUnread, setMailUnread] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");
  
  const [lastStatus, setLastStatus] = useState("");
  const [who, setWho] = useState<string | null>(null);
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
      tool<{ nodes: TreeNode[]; tasks: { overdue: number; today: number } | null; mail: { unread: number } | null }>("list_tree", { today: today(), withMail: true }).then(
        (answer) => {
          
          if (answer.ok) {
            setTree(answer.nodes);
            setTaskCounts(answer.tasks);
            setMailUnread(answer.mail?.unread ?? null);
            setTreeError(null);
          } else setTreeError(answer.message);
        },
      ),
    [],
  );

  const touch = useCallback(() => {
    setVersion((v) => v + 1);
    void refreshTree();
  }, [refreshTree]);

  
  const shown = useRef<Notice | null>(null);
  const show = useCallback((next: Notice | null) => {
    shown.current = next;
    setNotice(next);
  }, []);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    if (!shown.current) return show(queued.current);
    setLeaving(true);
    timer.current = setTimeout(() => {
      setLeaving(false);
      const next = queued.current;
      queued.current = null;
      show(next);
    }, 140);
  }, [show]);

  useEffect(() => {
    if (!notice || leaving) return;
    
    if (notice.tone === "status") {
      clearTimeout(timer.current);
      timer.current = setTimeout(dismiss, notice.lasts ?? (notice.undo ? 6000 : 3000));
    }
  }, [notice, leaving, dismiss]);

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
    async (promise: Promise<{ ok: boolean; message?: string }>) => {
      clearTimeout(statusTimer.current);
      setStatus("Saving…");
      setLastStatus("Saving…");
      const answer = await promise;
      if (answer.ok) {
        setStatus("Saved");
        setLastStatus("Saved");
        
        statusTimer.current = setTimeout(() => setStatus(""), 2000);
        touch();
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
    
    
    void browserClient(config)
      .auth.getSession()
      .then(({ data }) => {
        const user = data.session?.user;
        if (!user) return;
        setWho(user.is_anonymous ? "Demo session" : (user.email ?? null));
      });
  }, [refreshTree, config]);

  
  useEffect(() => {
    const match = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/);
    if (match) localStorage.setItem(LAST_NODE_KEY, match[1]);
  }, [pathname]);

  
  useEffect(() => dropFocusRequestOutside(pathname), [pathname]);

  
  
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

  async function signOut() {
    await forgetLayout();
    await browserClient(config).auth.signOut();
    localStorage.removeItem(LAST_NODE_KEY);
    router.replace("/");
  }

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
  const chat: Chat = { scope: chatScope, open: chatOpen, setOpen: setChatOpen };
  const value: Workspace = { config, tree, treeError, taskCounts, mailUnread, who, refreshTree, version, touch, notify, saving, openPalette, openItem, chat, setChatScope };
  const chatColumn = docked && chatOpen && chatScope !== undefined;

  return (
    <WorkspaceContext.Provider value={value}>
      <a href="#content" className="skip-link btn btn-primary">
        <span className="btn-label">Skip to content</span>
      </a>
      <div className="shell" data-chat={chatColumn ? "open" : undefined}>
        <header className="topbar">
          <Button className="drawer-trigger" size="sm" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>
            Menu
          </Button>
          <Link href="/app" className="brand" aria-label="Client Workspace, Overview">
            <BrandMark className="brand-mark" />
            <span className="brand-name">Client Workspace</span>
          </Link>
        </header>
        <aside className="sidebar" aria-label="Workspace">
          <SideNav onSignOut={() => void signOut()} />
        </aside>
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
        Add task
      </Button>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSignOut={() => void signOut()} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <TaskDetail />
      <QuickAddDialog />
      <ReviewNotice />
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
              role={notice.tone === "error" ? "alert" : "status"}
              className="notice"
              data-tone={notice.tone}
              data-leaving={leaving ? "" : undefined}
              inert={leaving}
              data-notice
            >
              <span className="t-value notice-text">{notice.text}</span>
              {notice.undo && (
                <Button
                  size="sm"
                  variant="primary"
                  
                  
                  autoFocus={!notice.quiet}
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
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <SideNav inDrawer onLeave={onClose} onSignOut={onSignOut} />
      </div>
    </dialog>
  );
}
