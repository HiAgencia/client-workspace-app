"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, DecisionIcon, DeleteIcon, NoteIcon, TasksIcon } from "@/components/ui/icons";
import { RichEditor } from "@/components/ui/rich-editor";
import { currentLanguage } from "@/lib/language";
import { inlinePlain } from "@/lib/inline-links";
import { ASSISTANT_NAME } from "@/lib/product";
import { translateNow, useStrings } from "@/lib/strings";
import { get, post, tool, type Item } from "./client-api";
import { Origin, typeName } from "./item-parts";
import { PlaceName } from "./task-row";
import { useWorkspace } from "./workspace";

type Saving = (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
type Status = "" | "saving" | "saved" | "failed";
type Revision = {
  id: string;
  createdAt: string;
  source: "manual" | "chat" | "agent";
  agentLabel: string | null;
  snapshot: { title: string; status: string; deleted_at: string | null };
};

const SAY: Record<Exclude<Status, "">, "workspace.saving" | "workspace.saved" | "detail.notSaved"> = { saving: "workspace.saving", saved: "workspace.saved", failed: "detail.notSaved" };

const stamp = (iso: string) => new Date(iso).toLocaleString(currentLanguage(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const stampDay = (iso: string) => new Date(iso).toLocaleString(currentLanguage(), { month: "short", day: "numeric" });
const by = (source: Revision["source"], label: string | null) => (source === "chat" ? ASSISTANT_NAME : source === "agent" ? translateNow("panel.byAgent", { label: label ?? "" }) : translateNow("panel.youWord"));

export function ItemPanel({
  item,
  saving,
  version,
  onClose,
  onDelete,
}: {
  item: Item | null;
  saving: Saving;
  version: number;
  onClose: (id: string, from: HTMLElement | null) => void;
  onDelete: (item: Item) => void;
}) {
  const { t, lang } = useStrings();
  const { tree } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<Item | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const titleId = useId();
  const notesId = useId();

  const current = item && shown && shown.id === item.id ? shown : (item ?? shown);
  const id = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef("");
  const confirmed = useRef("");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (item && (!el.open || id.current !== item.id)) {
      id.current = item.id;
      latest.current = item.body ?? "";
      confirmed.current = item.body ?? "";
      pending.current = null;
      setShown(item);
      setNotes(item.body ?? "");
      setStatus("");
      setRevisions(null);
      if (!el.open) {
        opener.current = document.activeElement as HTMLElement | null;
        el.showModal();
      }
      requestAnimationFrame(() => el.querySelector<HTMLElement>(".rich-field")?.focus({ preventScroll: true }));
    } else if (!item && el.open) {
      el.close();
    }
  }, [item]);

  const openId = item?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    let live = true;
    void get<{ revisions: Revision[] }>(`/api/items/${openId}/revisions`).then((versions) => {
      if (live && versions.ok) setRevisions(versions.revisions);
    });
    return () => {
      live = false;
    };
  }, [openId, version]);

  function edit(value: string) {
    setNotes(value);
    latest.current = value;
    setStatus("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }

  function flush(): Promise<unknown> {
    clearTimeout(timer.current);
    const value = latest.current.trim();
    const itemId = id.current;
    if (!itemId || value === confirmed.current) return queue.current;
    if (value === pending.current) return queue.current;
    pending.current = value;
    setStatus("saving");
    queue.current = queue.current.then(async () => {
      const ok = await saving(tool("update_item", { id: itemId, notes: value || null }));
      if (pending.current === value) pending.current = null;
      if (id.current !== itemId) return;
      if (!ok) return setStatus("failed");
      confirmed.current = value;
      setStatus(latest.current.trim() === value ? "saved" : "saving");
    });
    return queue.current;
  }

  function close() {
    if (latest.current.trim() === confirmed.current) return void dialog.current?.close();
    void flush().then(() => {
      if (latest.current.trim() === confirmed.current) dialog.current?.close();
    });
  }

  async function restore(revisionId: string) {
    const answer = await post<{ item: Item }>(`/api/revisions/${revisionId}/restore`, {});
    if (!(await saving(Promise.resolve(answer))) || !answer.ok || answer.item.id !== id.current) return;
    latest.current = answer.item.body ?? "";
    confirmed.current = answer.item.body ?? "";
    setShown(answer.item);
    setNotes(answer.item.body ?? "");
  }

  function markDecision(decision: boolean) {
    const itemId = id.current;
    if (!itemId) return;
    void flush();
    setStatus("saving");
    queue.current = queue.current.then(async () => {
      const answer = await tool<{ item: Item }>("update_item", { id: itemId, decision });
      const ok = await saving(Promise.resolve(answer));
      if (id.current !== itemId) return;
      if (!ok || !answer.ok) return setStatus("failed");
      const typedMeanwhile = latest.current.trim() !== confirmed.current;
      confirmed.current = answer.item.body ?? "";
      if (!typedMeanwhile) {
        latest.current = confirmed.current;
        setNotes(confirmed.current);
      }
      setShown(answer.item);
      setStatus("saved");
    });
  }

  const fieldName = current?.type === "note" ? t("type.note") : current?.type === "decision" ? t("panel.why") : t("box.notes");

  return (
    <dialog
      ref={dialog}
      className="dialog panel"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        void flush();
        if (id.current) onClose(id.current, opener.current);
      }}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) close();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {current && (
        <div className="panel-in" data-cascade>
          <header className="panel-head">
            <div className="panel-title">
              <p key={current.type} className="t-label panel-kind fade-enter" data-kind={current.type}>
                {current.type === "decision" ? <DecisionIcon /> : current.type === "note" ? <NoteIcon /> : <TasksIcon />}
                {typeName(current.type)}
              </p>
            </div>
            <Button size="sm" variant="quiet" className="btn-icon" onClick={close} title={t("common.close")}>
              <CloseIcon />
              <span className="sr-only">{t("common.close")}</span>
            </Button>
          </header>
          <div className="panel-body">
            <h2 id={titleId} className="panel-heading">
              {inlinePlain(current.title)}
            </h2>
            <p className="panel-meta t-meta">
              {current.nodeId ? (
                <Link className="link link-meta panel-path" href={`/app/node/${current.nodeId}`} data-panel-path>
                  <PlaceName path={current.nodePath} color={tree?.find((node) => node.id === current.nodeId)?.color ?? null} />
                </Link>
              ) : (
                <span className="panel-path" data-panel-path>
                  <PlaceName path={null} color={null} />
                </span>
              )}
              <span className="panel-record" data-panel-record>
                <Origin item={current} />
              </span>
              <span className="panel-added">{t("panel.addedOn", { when: stampDay(current.createdAt) })}</span>
            </p>
            <div className="panel-field">
              <label className={current.type === "decision" ? "t-meta panel-field-name" : "sr-only"} htmlFor={notesId}>
                {fieldName}
              </label>
              <RichEditor key={current.id} id={notesId} label={fieldName} lang={lang} value={notes} placeholder={t("panel.addDetails")} onChange={edit} onBlur={() => void flush()} onEscape={close} />
              <div className="panel-field-foot">
                <p className="t-meta panel-status" role="status" data-panel-status={status || undefined}>
                  {status ? t(SAY[status]) : ""}
                </p>
                <p className="t-meta panel-help">{t("panel.savesAsType")}</p>
              </div>
            </div>
            <Versions revisions={revisions} onRestore={restore} />
          </div>
          <footer className="panel-foot">
            {current.type !== "task" && (
              <Button size="sm" data-panel-mark onClick={() => markDecision(current.type === "note")}>
                {current.type === "note" ? <DecisionIcon /> : <NoteIcon />}
                <span className="btn-label">{current.type === "note" ? t("detail.markDecision") : t("detail.markNote")}</span>
              </Button>
            )}
            <Button
              variant="quiet"
              size="sm"
              data-panel-delete
              onClick={() => {
                const doomed = current;
                void flush().then(() => {
                  dialog.current?.close();
                  onDelete(doomed);
                });
              }}
            >
              <DeleteIcon />
              <span className="btn-label">{t("panel.deleteThis", { type: typeName(current.type).toLowerCase() })}</span>
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}

function Versions({ revisions, onRestore }: { revisions: Revision[] | null; onRestore: (id: string) => Promise<void> }) {
  const { t } = useStrings();
  return (
    <section className="panel-section" aria-labelledby="panel-versions" data-panel-versions>
      <h3 id="panel-versions" className="panel-section-head">
        {t("detail.versions")}
        {revisions && revisions.length > 0 && <span className="panel-section-count">{revisions.length}</span>}
      </h3>
      {revisions === null || revisions.length === 0 ? (
        <p className="t-meta panel-section-empty">{revisions === null ? t("detail.loadingVersions") : t("detail.noEarlier")}</p>
      ) : (
        <ul className="plain-list panel-versions">
          {revisions.slice(0, 12).map((revision) => (
            <li key={revision.id} className="panel-version" data-revision={revision.id}>
              <span className="panel-version-text">
                <span className="t-value">{revision.snapshot.deleted_at ? t("panel.deletedPrefix", { title: revision.snapshot.title }) : revision.snapshot.title}</span>
                <span className="t-meta">
                  {t("panel.beforeBy", { who: by(revision.source, revision.agentLabel), when: stamp(revision.createdAt) })}
                </span>
              </span>
              <Button size="sm" variant="quiet" onClick={() => void onRestore(revision.id)} aria-label={t("detail.restoreVersion", { when: stamp(revision.createdAt) })}>
                {t("trash.restore")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
