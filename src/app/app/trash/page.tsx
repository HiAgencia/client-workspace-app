"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { RestoreIcon } from "@/components/ui/icons";
import { count } from "@/lib/count";
import { LOCALE } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post, type Item } from "../client-api";
import { PathText, TYPE_NAMES } from "../item-parts";
import { PageHeader } from "../page-header";
import { useWorkspace } from "../workspace";
import "../../styles/settings.css";

type Entry = Item & { branch: number; with: { subtasks: number; notes: number }; deletedAt: string };

function broughtBack(item: Entry): string | null {
  const parts = [
    item.with.subtasks > 0 ? count(item.with.subtasks, "subtask", "subtasks") : null,
    item.with.notes > 0 ? count(item.with.notes, "note", "notes") : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : null;
}

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
                  <>
                  <p className="t-help">What you delete waits here until you restore it.</p>
                  <ul className="plain-list trash-list fade-enter">
                    {items.map((item) => {
                      const title = inlinePlain(item.title);
                      const back = broughtBack(item);
                      return (
                        <li key={item.id} className="trash-item" data-trash={item.id} data-leaving={leaving === item.id || undefined}>
                          <div className="trash-row">
                            <div className="trash-main">
                              <span className="t-value trash-title">{title}</span>
                              <span className="t-meta">
                                {TYPE_NAMES[item.type]} in {item.nodePath ? <PathText path={item.nodePath} /> : "General"}, deleted {stamp(item.deletedAt)}
                              </span>
                              {back && <span className="t-meta">{`Restore also brings back ${back} deleted with it`}</span>}
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
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </ViewTransition>
  );
}
