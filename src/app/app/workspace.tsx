"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { PublicConfig } from "@/lib/env";
import { browserClient } from "@/lib/supabase/browser";
import { tool, type TreeNode } from "./client-api";
import { Tree } from "./tree";

type Notice = { text: string; tone: "status" | "error"; undo?: () => void };

type Workspace = {
  config: PublicConfig;
  tree: TreeNode[] | null;
  treeError: string | null;
  refreshTree: () => Promise<void>;
  // Data written elsewhere (the tree, another panel, the chat) bumps this so open views read again.
  version: number;
  touch: () => void;
  notify: (notice: Notice) => void;
  saving: (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
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
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  const notify = useCallback((next: Notice) => {
    clearTimeout(timer.current);
    setNotice(next);
    // A status leaves on its own; an error stays until the person reads it and closes it.
    if (next.tone === "status") timer.current = setTimeout(() => setNotice(null), next.undo ? 6000 : 3000);
  }, []);

  const saving = useCallback(
    async (promise: Promise<{ ok: boolean; message?: string }>) => {
      setStatus("Saving…");
      const answer = await promise;
      if (answer.ok) {
        setStatus("Saved");
        // "Saved" says what just happened and leaves; it does not stay over the page.
        clearTimeout(statusTimer.current);
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
  }, [refreshTree]);

  // A session resumes on the last open node.
  useEffect(() => {
    const match = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/);
    if (match) localStorage.setItem(LAST_NODE_KEY, match[1]);
  }, [pathname]);

  async function signOut() {
    await browserClient(config).auth.signOut();
    localStorage.removeItem(LAST_NODE_KEY);
    router.replace("/");
  }

  const value: Workspace = { config, tree, treeError, refreshTree, version, touch, notify, saving };

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="flex flex-col gap-4 border-b p-4 md:w-72 md:border-r md:border-b-0">
          <nav className="flex flex-col gap-1">
            <Link href="/app">Today</Link>
            <Link href="/app/accounts">Accounts</Link>
          </nav>
          <Tree />
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </aside>
        {/* Room at the bottom so the last controls can scroll above the notices' corner. */}
        <main className="flex flex-1 flex-col gap-6 p-6 pb-24">{children}</main>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {/* The notices' layer lets clicks through to the page; only a notice's own buttons take them. */}
      <div className="pointer-events-none fixed right-4 bottom-4 flex items-center gap-3" aria-live="polite">
        {status && <span data-save-status>{status}</span>}
        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-center gap-3 rounded border bg-background p-3"
            data-notice
          >
            <span>{notice.text}</span>
            {notice.undo && (
              <Button
                size="sm"
                onClick={() => {
                  notice.undo?.();
                  setNotice(null);
                }}
              >
                Undo
              </Button>
            )}
            {notice.tone === "error" && (
              <Button size="sm" variant="outline" onClick={() => setNotice(null)}>
                Close
              </Button>
            )}
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
