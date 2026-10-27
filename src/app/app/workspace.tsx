"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { usePiece } from "@/components/ui/use-piece";
import type { PublicConfig } from "@/lib/env";
import { browserClient } from "@/lib/supabase/browser";
import { get, tool, type TreeNode } from "./client-api";
import { dropFocusRequestOutside } from "./focus-request";
import { Palette } from "./palette";
import { Tree } from "./tree";

type Notice = { id: number; text: string; tone: "status" | "error"; undo?: () => void };

type Workspace = {
  config: PublicConfig;
  tree: TreeNode[] | null;
  treeError: string | null;
  refreshTree: () => Promise<void>;
  // Data written elsewhere (the tree, another panel, the chat) bumps this so open views read again.
  version: number;
  touch: () => void;
  notify: (notice: Omit<Notice, "id">) => void;
  saving: (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
  openPalette: () => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace outside the workspace");
  return value;
}

export const LAST_NODE_KEY = "client-workspace:last-node";

export function WorkspaceShell({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");
  // The last status keeps its text while it fades out.
  const [lastStatus, setLastStatus] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queued = useRef<Notice | null>(null);
  const counter = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  const refreshTree = useCallback(
    () =>
      tool<{ nodes: TreeNode[] }>("list_tree", {}).then((answer) => {
        // A failed refresh keeps the tree that was visible and says so.
        if (answer.ok) {
          setTree(answer.nodes);
          setTreeError(null);
        } else setTreeError(answer.message);
      }),
    [],
  );

  const touch = useCallback(() => {
    setVersion((v) => v + 1);
    void refreshTree();
  }, [refreshTree]);

  // One notice at a time: a new one waits for the shown one to leave, and what leaves keeps its text until its fade ends.
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
    // A status leaves on its own; an error stays until the person reads it and closes it.
    if (notice.tone === "status") {
      clearTimeout(timer.current);
      timer.current = setTimeout(dismiss, notice.undo ? 6000 : 3000);
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
        // "Saved" says what just happened and leaves; it does not stay over the page.
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
    void get<{ user: { email: string | null; isAnonymous: boolean } }>("/api/me").then((answer) => {
      if (answer.ok) setWho(answer.user.isAnonymous ? "Demo workspace" : answer.user.email);
    });
  }, [refreshTree]);

  // A session resumes on the last open node.
  useEffect(() => {
    const match = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/);
    if (match) localStorage.setItem(LAST_NODE_KEY, match[1]);
  }, [pathname]);

  // A landing asked for another place is dropped once the person is somewhere else.
  useEffect(() => dropFocusRequestOutside(pathname), [pathname]);

  // The drawer closes when the place changes.
  const [placeSeen, setPlaceSeen] = useState(pathname);
  if (placeSeen !== pathname) {
    setPlaceSeen(pathname);
    setDrawerOpen(false);
  }

  // Ctrl+K or Cmd+K opens the palette from anywhere in the workspace.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function signOut() {
    await browserClient(config).auth.signOut();
    localStorage.removeItem(LAST_NODE_KEY);
    router.replace("/");
  }

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const value: Workspace = { config, tree, treeError, refreshTree, version, touch, notify, saving, openPalette };

  return (
    <WorkspaceContext.Provider value={value}>
      <a href="#content" className="skip-link btn btn-primary">
        <span className="btn-label">Skip to content</span>
      </a>
      <div className="shell">
        <header className="topbar">
          <Button className="projects-trigger" size="sm" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>
            Projects
          </Button>
          <Link href="/app" className="brand" aria-label="client-workspace, Today">
            <BrandMark className="brand-mark" />
            <span className="brand-name">client-workspace</span>
          </Link>
          <PaletteTrigger onOpen={openPalette} />
          <div className="topbar-end">
            <span className="save-status t-meta" data-shown={status ? "" : undefined} aria-hidden="true" {...(status ? { "data-save-status": "" } : {})}>
              {lastStatus}
            </span>
            <ThemeSwitch />
            {who && <span className="who t-meta only-wide">{who}</span>}
            <Button size="sm" className="only-wide" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>
        <aside className="sidebar card" aria-label="Workspace">
          <div className="side-scroll">
            <SideNav />
          </div>
        </aside>
        <main id="content" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSignOut={() => void signOut()} who={who} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <div className="notices" aria-live="polite">
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
                // The deleted row held the focus; it goes to the undo of what was just deleted, not to the page.
                autoFocus
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
      </div>
    </WorkspaceContext.Provider>
  );
}

// The sidebar's content, the same in the wide sidebar and in the phone's drawer: Today, Accounts, and the tree, with
// ONE piece marking where the person is.
function SideNav() {
  const pathname = usePathname();
  const host = useRef<HTMLDivElement>(null);
  usePiece(host, '[aria-current="page"]');
  return (
    <nav ref={host} className="side-nav" aria-label="Workspace">
      <div className="side-group">
        <Link href="/app" className="side-link" aria-current={pathname === "/app" ? "page" : undefined}>
          <span className="side-link-name">Today</span>
        </Link>
        <Link href="/app/accounts" className="side-link" aria-current={pathname === "/app/accounts" ? "page" : undefined}>
          <span className="side-link-name">Accounts</span>
        </Link>
      </div>
      <Tree />
    </nav>
  );
}

const noSubscription = () => () => {};

function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  // Read once mounted: the server does not know the person's keyboard.
  const mac = useSyncExternalStore(noSubscription, () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent), () => false);
  return (
    <button type="button" className="field palette-trigger" onClick={onOpen} aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}>
      <span className="trigger-long">Search or jump to…</span>
      <span className="trigger-short">Search</span>
      <span className="kbd" aria-hidden="true">
        {mac ? "⌘ K" : "Ctrl K"}
      </span>
    </button>
  );
}

function Drawer({ open, onClose, onSignOut, who }: { open: boolean; onClose: () => void; onSignOut: () => void; who: string | null }) {
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
      // A click on the backdrop closes it only when the whole gesture happened outside the panel.
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) onClose();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {open && (
        <div className="stack">
          <div className="drawer-head">
            <h2 id="drawer-title" className="t-title">
              Projects
            </h2>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <div className="side-scroll">
            <SideNav />
          </div>
          <div className="drawer-head">
            {who && <span className="who t-meta">{who}</span>}
            <Button size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
