"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { RestoreIcon } from "@/components/ui/icons";
import { currentLanguage } from "@/lib/language";
import { useStrings } from "@/lib/strings";
import { inlinePlain } from "@/lib/inline-links";
import { BoxEmpty, BoxFailed, BoxWait } from "../boxes";
import { get, post, type Item } from "../client-api";
import { PathText, typeName } from "../item-parts";
import { PageHeader } from "../page-header";
import { useWorkspace } from "../workspace";
import { broughtBack, type DeletedWith } from "./brought-back";
import "../../styles/settings.css";

type Entry = Item & { with: DeletedWith; deletedAt: string };

const stamp = (iso: string) => new Date(iso).toLocaleString(currentLanguage(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const FOLD_MS = 220;

export default function TrashPage() {
  const { t, counted } = useStrings();
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
        <PageHeader title={t("trash.title")} count={items && items.length > 0 ? counted(items.length, "counted.deletedItem", "counted.deletedItems") : undefined} />
        <section className="box settings-box" aria-label={t("trash.deletedItems")} data-settings="trash" data-shown="">
          <div className="box-body">
            {items === null ? (
              error ? (
                <BoxFailed what={t("trash.the")} message={error} kept={false} onRetry={() => setRound((n) => n + 1)} />
              ) : (
                <BoxWait what={t("trash.loading")} rows={3} />
              )
            ) : (
              <>
                {error && <BoxFailed what={t("trash.the")} message={error} kept onRetry={() => setRound((n) => n + 1)} />}
                {items.length === 0 ? (
                  <BoxEmpty text={t("trash.empty")} reason="empty-trash">
                    <Link className={buttonClass({ variant: "quiet", size: "sm" })} href="/app">
                      <span className="btn-label">{t("node.goOverview")}</span>
                    </Link>
                  </BoxEmpty>
                ) : (
                  <>
                  <p className="t-help">{t("trash.waits")}</p>
                  <ul className="plain-list trash-list fade-enter">
                    {items.map((item) => {
                      const title = inlinePlain(item.title);
                      const back = broughtBack(item.with);
                      return (
                        <li key={item.id} className="trash-item" data-trash={item.id} data-leaving={leaving === item.id || undefined}>
                          <div className="trash-row">
                            <div className="trash-main">
                              <span className="t-value trash-title">{title}</span>
                              <span className="t-meta">
                                {typeName(item.type)} {t("trash.in")} {item.nodePath ? <PathText path={item.nodePath} /> : t("filter.general")}, {t("trash.deletedWord")} {stamp(item.deletedAt)}
                              </span>
                              {back && <span className="t-meta">{t("trash.restoreAlso", { back })}</span>}
                            </div>
                            <Button size="sm" disabled={leaving !== null} onClick={() => void restore(item)} aria-label={t("trash.restoreNamed", { title })} title={t("trash.restores")}>
                              <RestoreIcon />
                              <span className="btn-label">{t("trash.restore")}</span>
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
