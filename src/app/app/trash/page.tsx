"use client";

import Link from "next/link";
import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { LOCALE } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post, type Item } from "../client-api";
import { PathText, TYPE_NAMES } from "../item-parts";
import { PageHeader } from "../page-header";
import { count } from "../task-row";
import { useWorkspace } from "../workspace";
import "../../styles/settings.css";

type Entry = Item & { branch: number; deletedAt: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// How long a restored row takes to fold away before the list reads again.
const FOLD_MS = 220;

// The trash: what was deleted, each branch once by the item it was deleted with, and its «Restore», which brings the
// whole branch back. One box in the page's column, of the workspace's own skin.
export default function TrashPage() {
  const { saving, version } = useWorkspace();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void get<{ items: Entry[] }>("/api/trash").then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setItems(answer.items);
        setError(null);
      } else setError(answer.message);
      setLeaving(null);
    });
    return () => {
      live = false;
    };
  }, [version, round]);

  // The row folds away first, then the branch comes back; a refused restore brings the row back and says why.
  async function restore(item: Entry) {
    setLeaving(item.id);
    await new Promise((resolve) => setTimeout(resolve, FOLD_MS));
    if (!(await saving(post(`/api/items/${item.id}/restore`, {})))) setLeaving(null);
  }

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-settings">
        <PageHeader title="Trash" count={items === null || items.length === 0 ? undefined : count(items.length, "deleted item", "deleted items")} />
        <section className="box settings-box" aria-labelledby="trash-title" data-settings="trash" data-shown="">
          <header className="box-head">
            <h2 id="trash-title" className="t-title box-title">
              Deleted
            </h2>
          </header>
          <div className="box-body">
            <p className="t-help">What was deleted, by hand, by the chat, or by an agent. Restoring an item brings back everything deleted with it.</p>
            {items === null ? (
              error ? (
                <BoxFailed what="The trash" message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
              ) : (
                <BoxWait what="Reading the trash…" rows={3} />
              )
            ) : (
              <>
                {error && <BoxFailed what="The trash" message={error} kept onRetry={() => setRound((n) => n + 1)} />}
                {items.length === 0 ? (
                  <BoxEmpty text="Nothing deleted. What you delete waits here until you restore it." reason="empty-trash">
                    <Link className={buttonClass({ size: "sm" })} href="/app">
                      <span className="btn-label">Go to the Overview</span>
                    </Link>
                  </BoxEmpty>
                ) : (
                  <ul className="plain-list trash-list fade-enter">
                    {items.map((item) => {
                      const title = inlinePlain(item.title);
                      return (
                        <li key={item.id} className="trash-item" data-trash={item.id} data-leaving={leaving === item.id || undefined}>
                          <div className="trash-row">
                            <div className="trash-main">
                              <span className="t-value trash-title">{title}</span>
                              <span className="t-meta">
                                {TYPE_NAMES[item.type]} in {item.nodePath ? <PathText path={item.nodePath} /> : "General"}, deleted {stamp(item.deletedAt)}
                                {item.branch > 1 ? `, with ${count(item.branch - 1, "more item", "more items")}` : ""}
                              </span>
                            </div>
                            <Button size="sm" disabled={leaving !== null} onClick={() => void restore(item)} aria-label={`Restore “${title}”`}>
                              Restore
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </ViewTransition>
  );
}
