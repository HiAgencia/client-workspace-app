"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { DecisionIcon, NoteIcon, RestoreIcon, TaskIcon } from "@/components/ui/icons";
import { count } from "@/lib/count";
import { LOCALE } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post, type Item } from "../client-api";
import { PathText, TYPE_NAMES } from "../item-parts";
import { PageHeader } from "../page-header";
import { useWorkspace } from "../workspace";
import "../../styles/settings.css";

type Entry = Item & { branch: number; deletedAt: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const FOLD_MS = 220;
const RESTORES = "Brings back everything deleted with it";

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

  async function restore(item: Entry) {
    setLeaving(item.id);
    await new Promise((resolve) => setTimeout(resolve, FOLD_MS));
    if (!(await saving(post(`/api/items/${item.id}/restore`, {})))) setLeaving(null);
  }

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-settings">
        <PageHeader title="Trash" count={items && items.length > 0 ? count(items.length, "deleted item", "deleted items") : undefined} />
        <section className="box settings-box" aria-label="Deleted items" data-settings="trash" data-shown="">
          <div className="box-body">
            {items === null ? (
              error ? (
                <BoxFailed what="The trash" message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
              ) : (
                <BoxWait what="Loading the trash…" rows={3} />
              )
            ) : (
              <>
                {error && <BoxFailed what="The trash" message={error} kept onRetry={() => setRound((n) => n + 1)} />}
                {items.length === 0 ? (
                  <BoxEmpty text="Trash is empty. What you delete waits here until you restore it." reason="empty-trash">
                    <Link className={buttonClass({ variant: "quiet", size: "sm" })} href="/app">
                      <span className="btn-label">Go to Overview</span>
                    </Link>
                  </BoxEmpty>
                ) : (
                  <ul className="plain-list trash-list fade-enter">
                    {items.map((item) => {
                      const title = inlinePlain(item.title);
                      return (
                        <li key={item.id} className="trash-item" data-trash={item.id} data-leaving={leaving === item.id || undefined}>
                          <div className="trash-row">
                            <span className="trash-icon" aria-hidden="true">
                              {item.type === "task" ? <TaskIcon /> : item.type === "decision" ? <DecisionIcon /> : <NoteIcon />}
                            </span>
                            <div className="trash-main">
                              <span className="t-value trash-title">{title}</span>
                              <span className="t-meta">
                                {TYPE_NAMES[item.type]} in {item.nodePath ? <PathText path={item.nodePath} /> : "General"}, deleted {stamp(item.deletedAt)}
                                {item.branch > 1 ? `, with ${count(item.branch - 1, "more item", "more items")}` : ""}
                              </span>
                            </div>
                            <Button size="sm" disabled={leaving !== null} onClick={() => void restore(item)} aria-label={`Restore “${title}”`} title={RESTORES}>
                              <RestoreIcon />
                              <span className="btn-label">Restore</span>
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
