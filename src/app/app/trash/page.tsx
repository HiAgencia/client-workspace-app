"use client";

import Link from "next/link";
import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { LOCALE } from "@/lib/dates";
import { get, post, type Item } from "../client-api";
import { TYPE_NAMES } from "../item-parts";
import { useWorkspace } from "../workspace";

type Entry = Item & { branch: number; deletedAt: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The trash: what was deleted, each branch once by the item it was deleted with, and its restore, which brings the
// whole branch back.
export default function TrashPage() {
  const { saving, version } = useWorkspace();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<{ items: Entry[] }>("/api/trash").then((answer) => {
      if (answer.ok) {
        setItems(answer.items);
        setError(null);
      } else setError(answer.message);
    });
  }, [version]);

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page">
        <header className="card page-head">
          <h1 className="t-h1" tabIndex={-1}>
            Trash
          </h1>
          <p className="t-help">What was deleted, by hand, by the chat, or by an agent. Restoring an item brings back everything deleted with it.</p>
        </header>
        {error && (
          <p role="alert" className="inline-note" data-tone="alert">
            The trash could not be read: {error}.
          </p>
        )}
        {items === null ? (
          !error && (
            <div className="card stack" role="status" aria-label="Loading the trash" aria-busy="true">
              <span className="skeleton" style={{ width: "58%" }} />
              <span className="skeleton" style={{ width: "46%" }} />
            </div>
          )
        ) : items.length === 0 ? (
          <section className="card fade-enter" aria-label="The trash is empty">
            <div className="empty">
              <p className="t-help">Nothing deleted. What you delete waits here until you restore it.</p>
              <Link className={buttonClass({ size: "sm" })} href="/app">
                <span className="btn-label">Go to the Overview</span>
              </Link>
            </div>
          </section>
        ) : (
          <section className="card fade-enter" aria-label="Deleted items">
            <ul className="rows">
              {items.map((item) => (
                <li key={item.id} className="row" data-trash={item.id}>
                  <div className="row-main">
                    <span className="t-value">{item.title}</span>
                    <span className="t-meta">
                      {TYPE_NAMES[item.type]} in {item.nodePath} · deleted {stamp(item.deletedAt)}
                      {item.branch > 1 ? ` with ${item.branch - 1} more` : ""}
                    </span>
                  </div>
                  <div className="row-act">
                    <Button size="sm" onClick={() => void saving(post(`/api/items/${item.id}/restore`, {}))} aria-label={`Restore “${item.title}”`}>
                      Restore
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ViewTransition>
  );
}
