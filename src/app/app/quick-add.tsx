"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Fold } from "@/components/ui/fold";
import { AddIcon, DateIcon, EnterKeyIcon, GeneralIcon, PriorityIcon, TimeIcon } from "@/components/ui/icons";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { Select, type SelectOption } from "@/components/ui/select";
import { afterExit, focusAfterClose } from "@/components/ui/use-exit";
import { today, type Day } from "@/lib/dates";
import { prepare, rank } from "@/lib/fuzzy";
import { inlinePlain } from "@/lib/inline-links";
import { readQuickAdd, type PieceKind, type QuickAddPiece, type QuickAddPlace } from "@/lib/quick-add";
import { tool, type Item } from "./client-api";
import { PRIORITIES } from "./item-parts";
import { onOpenQuickAdd, type QuickAddStart } from "./quick-add-bus";
import { pasteLinkOver, whenLabel, whenTone } from "./task-row";
import { useWorkspace } from "./workspace";

const LOW = 4;
const clockNow = () => new Date().toTimeString().slice(0, 5);

const KIND_NAMES: Record<PieceKind, string> = { date: "Date", place: "Client or project", priority: "Priority" };
const GENERAL = "general";

type Overrides = { date?: { day: Day | null; time: string | null }; place?: string | null; priority?: number | null };

function placeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)#([^#\n]{0,40})$/u.exec(before);
  if (!match) return null;
  const start = before.length - match[1].length - 1;
  return { start, query: match[1] };
}

function QuickAddEditor({
  start,
  onDone,
  inline = false,
  submitLabel = "Add task",
  draft,
  onDraft,
}: {
  start: QuickAddStart;
  onDone: (reason: "added" | "cancel") => void;
  inline?: boolean;
  submitLabel?: string;
  draft?: string;
  onDraft?: (text: string) => void;
}) {
  const { tree, notify, touch, saving } = useWorkspace();
  const [text, setText] = useState(draft ?? "");
  const [caret, setCaret] = useState(draft?.length ?? 0);
  const [dismissed, setDismissed] = useState<Array<{ kind: PieceKind; text: string }>>([]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const fieldId = useId();
  useEffect(() => {
    onDraft?.(text);
  }, [text, onDraft]);
  const opened = useRef(draft);
  useLayoutEffect(() => {
    const words = opened.current;
    if (words) field.current?.setSelectionRange(words.length, words.length);
  }, []);
  const now = today();
  const clock = clockNow();

  const places = useMemo<QuickAddPlace[]>(() => (tree ?? []).map((node) => ({ id: node.id, name: node.name, path: node.path })), [tree]);
  const prepared = useMemo(() => places.map((place) => ({ place, prepared: prepare(`${place.path} ${place.name}`) })), [places]);
  const reading = useMemo(() => readQuickAdd(text, { today: now, clock, places, dismissed }), [text, now, clock, places, dismissed]);
  const byId = (id: string | null | undefined) => (id ? places.find((place) => place.id === id) ?? null : null);
  const colorOf = (id: string | null | undefined) => (id ? (tree?.find((node) => node.id === id)?.color ?? undefined) : undefined);

  const day = overrides.date !== undefined ? overrides.date.day : (reading.day ?? start.day ?? null);
  const time = overrides.date !== undefined ? overrides.date.time : reading.day ? reading.time : null;
  const placeId = overrides.place !== undefined ? overrides.place : (reading.place?.id ?? (reading.placeCandidates.length ? undefined : (start.placeId ?? null)));
  const priority = overrides.priority !== undefined ? overrides.priority : reading.priority;
  const place = byId(placeId ?? null);

  const query = closedAt === null || placeQuery(text, caret)?.start !== closedAt ? placeQuery(text, caret) : null;
  const placedPiece = query ? reading.pieces.find((piece) => piece.kind === "place" && piece.start === query.start) : undefined;
  const typedPiece = placedPiece && placedPiece.end >= caret ? placedPiece : undefined;
  const suggestions =
    query && !(placedPiece && caret > placedPiece.end)
      ? (query.query.trim() ? rank(query.query, prepared, (entry) => entry.prepared).map((hit) => hit.entry.place) : places).slice(0, 6)
      : [];
  const listOpen = suggestions.length > 0;
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));
  const [lastShown, setLastShown] = useState(suggestions);
  if (listOpen && (lastShown.length !== suggestions.length || lastShown.some((entry, index) => entry.id !== suggestions[index].id))) setLastShown(suggestions);
  const drawn = listOpen ? suggestions : lastShown;

  function sync() {
    const el = field.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }

  function edit(next: string, at?: number) {
    setText(next);
    setProblem(null);
    if (at !== undefined) {
      setCaret(at);
      requestAnimationFrame(() => field.current?.setSelectionRange(at, at));
    }
  }

  function pick(chosen: QuickAddPlace) {
    if (!query) return;
    const shared = places.filter((other) => other.name.toLowerCase() === chosen.name.toLowerCase()).length > 1;
    const words = `#${shared ? chosen.path : chosen.name} `;
    const end = typedPiece ? typedPiece.end : caret;
    const next = text.slice(0, query.start) + words + text.slice(end).replace(/^ /, "");
    edit(next, query.start + words.length);
    setOverrides((was) => ({ ...was, place: undefined }));
    setActive(0);
  }

  function choose(kind: PieceKind, value: Overrides[keyof Overrides] | null, removing: boolean) {
    const piece = reading.pieces.find((entry) => entry.kind === kind);
    if (piece && removing) setDismissed((was) => [...was, { kind, text: piece.text }]);
    if (piece && !removing) {
      const next = (text.slice(0, piece.start) + text.slice(piece.end)).replace(/\s{2,}/g, " ");
      edit(next, Math.min(piece.start, next.length));
    }
    setOverrides((was) => ({ ...was, [kind]: value }) as Overrides);
    focusAfterClose(() => field.current);
  }

  async function add() {
    if (busy) return;
    const title = reading.title;
    if (!title) {
      setProblem("Write what has to be done.");
      return field.current?.focus();
    }
    if (placeId === undefined) {
      setProblem(`More than one client or project is called “${reading.pieces.find((piece) => piece.kind === "place")?.text.slice(1) ?? ""}”: choose one on its chip.`);
      return;
    }
    setBusy(true);
    try {
      const answer = await tool<{ item: Item }>("create_task", {
        node: placeId,
        ...(start.parentId ? { parent: start.parentId } : {}),
        title,
        priority: priority ?? LOW,
        ...(day ? { dueOn: day } : {}),
        ...(day && time ? { dueTime: time } : {}),
      });
      if (!answer.ok) return setProblem(`The task could not be added: ${answer.message}`);
      touch();
      const id = answer.item.id;
      notify({ text: `Added “${inlinePlain(title)}”`, tone: "status", undo: () => void saving(tool("delete_item", { id })) });
      setText("");
      setDismissed([]);
      setOverrides({});
      setProblem(null);
      onDone("added");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((highlighted + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[highlighted]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setClosedAt(query?.start ?? null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void add();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone("cancel");
    }
  }

  const marked: ReactNode[] = [];
  let at = 0;
  for (const piece of reading.pieces) {
    if (piece.start > at) marked.push(text.slice(at, piece.start));
    marked.push(
      <mark key={piece.start} className="qa-mark" data-kind={piece.kind}>
        {text.slice(piece.start, piece.end)}
      </mark>,
    );
    at = piece.end;
  }
  marked.push(text.slice(at));

  const readKinds = new Set(reading.pieces.map((piece: QuickAddPiece) => piece.kind));
  const candidates = reading.placeCandidates;
  const placeOptions: SelectOption[] = [
    { value: GENERAL, label: "General" },
    ...(candidates.length > 1 && overrides.place === undefined ? candidates : places).map((entry) => ({ value: entry.id, label: entry.path })),
  ];

  return (
    <div className="qa" data-inline={inline || undefined}>
      <div className="field qa-box">
        <div className="qa-mirror" aria-hidden="true">
          {marked}
          {"​"}
        </div>
        <textarea
          ref={field}
          id={fieldId}
          name={fieldId}
          className="qa-input"
          rows={1}
          autoFocus
          lang="en"
          aria-label="Task, with a date, #client or project and p1–p4 priority"
          placeholder="Call the printer tomorrow 4pm #Website p2"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={listOpen ? `${listId}-${highlighted}` : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setProblem(null);
            setActive(0);
            setClosedAt(null);
          }}
          onSelect={sync}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
            if (next !== null) {
              event.preventDefault();
              edit(next, next.length);
            }
          }}
        />
        <ul id={listId} className="popup qa-suggest" role="listbox" aria-label="Clients and projects" hidden={!listOpen}>
          {drawn.map((entry, index) => (
            <li
              key={entry.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={listOpen && index === highlighted}
              className="option"
              data-highlighted={listOpen && index === highlighted ? "" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(entry)}
            >
              <span className="qa-suggest-disc" data-color={colorOf(entry.id)} aria-hidden="true" />
              {entry.path}
            </li>
          ))}
        </ul>
      </div>
      <div className="qa-chips" role="group" aria-label="What the task will be">
        <span
          className="qa-chip task-prop"
          data-prop="date"
          data-read={readKinds.has("date") || undefined}
          data-set={day ? "" : undefined}
          data-unset={day ? undefined : ""}
          data-when={day ? whenTone(day, now) : undefined}
        >
          {time ? <TimeIcon className="task-prop-icon" /> : <DateIcon className="task-prop-icon" />}
          <DatePicker
            look="chip"
            label={KIND_NAMES.date}
            value={day}
            display={whenLabel(day, time, now)}
            onChange={(next) => choose("date", { day: next, time: next ? time : null }, next === null)}
          />
        </span>
        <span className="qa-chip task-prop" data-prop="place" data-read={readKinds.has("place") || undefined} data-set="" data-color={colorOf(placeId)}>
          {placeId ? <span className="task-prop-disc" aria-hidden="true" /> : <GeneralIcon className="task-prop-icon" />}
          <Select
            look="chip"
            label={KIND_NAMES.place}
            value={placeId === undefined ? null : (placeId ?? GENERAL)}
            placeholder={`Choose one of ${candidates.length}`}
            options={placeOptions}
            onChange={(value) => choose("place", value === GENERAL ? null : value, value === GENERAL)}
          />
        </span>
        <span
          className="qa-chip task-prop"
          data-prop="priority"
          data-read={readKinds.has("priority") || undefined}
          data-set={priority ? "" : undefined}
          data-unset={priority ? undefined : ""}
          data-priority={priority ?? undefined}
        >
          <PriorityIcon className="task-prop-icon" />
          <Select
            look="chip"
            label={KIND_NAMES.priority}
            value={String(priority ?? LOW)}
            options={PRIORITIES}
            onChange={(value) => choose("priority", Number(value), false)}
          />
        </span>
      </div>
      {(problem || reading.unknownPlace) && (
        <p className="inline-note qa-note" data-tone={problem ? "alert" : undefined} role={problem ? "alert" : "status"}>
          {problem ?? `No client or project is called “${reading.unknownPlace}”: the task goes to ${place?.path ?? "General"}.`}
        </p>
      )}
      <div className="qa-foot">
        <p className="t-meta qa-hint">
          <kbd className="kbd">#</kbd> client or project · <span className="nowrap"><kbd className="kbd">p1</kbd> {PRIORITIES[0].label.toLowerCase()}</span> to{" "}
          <span className="nowrap"><kbd className="kbd">p4</kbd> {PRIORITIES[3].label.toLowerCase()}</span> · <span className="nowrap">a day like “tomorrow 4pm”</span>
        </p>
        <div className="qa-actions">
          <Button size="sm" onClick={() => onDone("cancel")}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy || !reading.title} aria-keyshortcuts="Enter">
            <span className="btn-label">{busy ? "Adding…" : submitLabel}</span>
            <kbd className="kbd" aria-hidden="true">
              <EnterKeyIcon />
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QuickAddDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const popupOpen = useRef(false);
  const draft = useRef("");
  const keepDraft = useCallback((text: string) => {
    draft.current = text;
  }, []);
  const [start, setStart] = useState<QuickAddStart | null>(null);
  const [round, setRound] = useState(0);
  const [words, setWords] = useState("");

  useEffect(
    () =>
      onOpenQuickAdd((next) => {
        const el = dialog.current;
        if (!el) return;
        if (!el.open) opener.current = document.activeElement as HTMLElement | null;
        setStart(next);
        setWords(draft.current);
        setRound((value) => value + 1);
        if (!el.open) el.showModal();
      }),
    [],
  );

  return (
    <dialog
      ref={dialog}
      className="dialog qa-dialog"
      aria-label="Add task"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") popupOpen.current = Boolean(dialog.current?.querySelector("[data-popup-open]"));
      }}
      onCancel={(event) => {
        if (!popupOpen.current) return;
        popupOpen.current = false;
        event.preventDefault();
      }}
      onClose={() => {
        const element = dialog.current;
        afterExit(element, () => {
          if (!element?.open) setStart(null);
        });
        focusAfterClose(() => opener.current, opener.current);
      }}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) dialog.current.close();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      <PopupLayerProvider container={dialog}>
        {start && (
          <QuickAddEditor key={round} start={start} draft={words} onDraft={keepDraft} onDone={() => dialog.current?.close()} />
        )}
      </PopupLayerProvider>
    </dialog>
  );
}

export function useQuickAddInline({ day, placeId, parentId, label = "Add task" }: { day?: Day | null; placeId?: string | null; parentId?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const foldId = useId();
  const trigger = (
    <Button
      ref={button}
      variant="quiet"
      size="sm"
      className="head-action"
      aria-expanded={open}
      aria-controls={foldId}
      onClick={() => {
        if (!open) setRound((value) => value + 1);
        setOpen((value) => !value);
      }}
    >
      <AddIcon />
      <span className="btn-label">{label}</span>
    </Button>
  );
  const editor = (
    <Fold open={open} id={foldId}>
      {round > 0 && (
        <div className="qa-inline">
          <QuickAddEditor
            key={round}
            inline
            start={{ day: day ?? null, placeId, parentId }}
            onDone={(reason) => {
              if (reason === "added") return setRound((value) => value + 1);
              setOpen(false);
              focusAfterClose(() => button.current);
            }}
          />
        </div>
      )}
    </Fold>
  );
  return { trigger, editor };
}
