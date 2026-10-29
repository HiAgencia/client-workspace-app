"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { Select, type SelectOption } from "@/components/ui/select";
import { today, type Day } from "@/lib/dates";
import { prepare, rank } from "@/lib/fuzzy";
import { inlinePlain } from "@/lib/inline-links";
import { readQuickAdd, type PieceKind, type QuickAddPiece, type QuickAddPlace } from "@/lib/quick-add";
import { tool, type Item } from "./client-api";
import { PRIORITIES } from "./item-parts";
import { onOpenQuickAdd, type QuickAddStart } from "./quick-add-bus";
import { pasteLinkOver, whenLabel } from "./task-row";
import { useWorkspace } from "./workspace";

// "HH:MM" on the person's clock.
const clockNow = () => new Date().toTimeString().slice(0, 5);

const KIND_NAMES: Record<PieceKind, string> = { date: "Date", place: "Place", priority: "Priority" };
const NO_PRIORITY = "none";
const GENERAL = "general";

// What the person chose on a chip, over what the field reads: a day (or none), a place (or General), a priority.
type Overrides = { date?: { day: Day | null; time: string | null }; place?: string | null; priority?: number | null };

// The place a «#» being typed asks for: the words after it up to the caret, while no place is read there yet.
function placeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)#([^#\n]{0,40})$/u.exec(before);
  if (!match) return null;
  const start = before.length - match[1].length - 1;
  return { start, query: match[1] };
}

// The field and what it read: the words, each recognized piece marked where it sits and repeated as a chip below; a chip
// opens its selector, which can also take the piece out (it stays as words). While words follow «#», the places that
// answer to them are offered. Enter adds, Escape closes what is open inside, or the whole.
function QuickAddEditor({
  start,
  onDone,
  inline = false,
  submitLabel = "Add task",
}: {
  start: QuickAddStart;
  onDone: (reason: "added" | "cancel") => void;
  inline?: boolean;
  submitLabel?: string;
}) {
  const { tree, notify, touch, saving } = useWorkspace();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<Array<{ kind: PieceKind; text: string }>>([]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const fieldId = useId();
  const now = today();
  // The person's hour: an hour written alone that already passed is tomorrow's.
  const clock = clockNow();

  const places = useMemo<QuickAddPlace[]>(() => (tree ?? []).map((node) => ({ id: node.id, name: node.name, path: node.path })), [tree]);
  const prepared = useMemo(() => places.map((place) => ({ place, prepared: prepare(`${place.path} ${place.name}`) })), [places]);
  const reading = useMemo(() => readQuickAdd(text, { today: now, clock, places, dismissed }), [text, now, clock, places, dismissed]);
  const byId = (id: string | null | undefined) => (id ? places.find((place) => place.id === id) ?? null : null);

  // What the task will be: a chip's choice first, then what the field read, then where it was opened from.
  const day = overrides.date !== undefined ? overrides.date.day : (reading.day ?? start.day ?? null);
  const time = overrides.date !== undefined ? overrides.date.time : reading.day ? reading.time : null;
  const placeId = overrides.place !== undefined ? overrides.place : (reading.place?.id ?? (reading.placeCandidates.length ? undefined : (start.placeId ?? null)));
  const priority = overrides.priority !== undefined ? overrides.priority : reading.priority;
  const place = byId(placeId ?? null);

  // The places offered while «#» is typed.
  const query = closedAt === null || placeQuery(text, caret)?.start !== closedAt ? placeQuery(text, caret) : null;
  const placedPiece = query ? reading.pieces.find((piece) => piece.kind === "place" && piece.start === query.start) : undefined;
  const typedPiece = placedPiece && placedPiece.end >= caret ? placedPiece : undefined;
  // Once the caret moved past a place already read, the person is writing something else.
  const suggestions =
    query && !(placedPiece && caret > placedPiece.end)
      ? (query.query.trim() ? rank(query.query, prepared, (entry) => entry.prepared).map((hit) => hit.entry.place) : places).slice(0, 6)
      : [];
  const listOpen = suggestions.length > 0;
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));

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

  // A place picked from the list goes in as «#Name», or its whole path when another place shares the name.
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

  // A chip's choice. Taking a piece out leaves its words in the title; choosing another value takes its words out.
  function choose(kind: PieceKind, value: Overrides[keyof Overrides] | null, removing: boolean) {
    const piece = reading.pieces.find((entry) => entry.kind === kind);
    if (piece && removing) setDismissed((was) => [...was, { kind, text: piece.text }]);
    if (piece && !removing) {
      const next = (text.slice(0, piece.start) + text.slice(piece.end)).replace(/\s{2,}/g, " ");
      edit(next, Math.min(piece.start, next.length));
    }
    setOverrides((was) => ({ ...was, [kind]: value }) as Overrides);
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  }

  async function add() {
    if (busy) return;
    const title = reading.title;
    if (!title) {
      setProblem("Write what has to be done.");
      return field.current?.focus();
    }
    if (placeId === undefined) {
      setProblem(`More than one place is called “${reading.pieces.find((piece) => piece.kind === "place")?.text.slice(1) ?? ""}”: choose one on the Place chip.`);
      return;
    }
    setBusy(true);
    try {
      const answer = await tool<{ item: Item }>("create_task", {
        node: placeId,
        ...(start.parentId ? { parent: start.parentId } : {}),
        title,
        priority: priority ?? 4,
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

  // The field's words, with every piece the reader took marked where it sits.
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
  const priorityOptions: SelectOption[] = [...PRIORITIES, { value: NO_PRIORITY, label: "No priority" }];

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
          // What the field writes is English, and the browser's spell checker follows the element's language, not the
          // system's: without this, every word here was underlined in a Spanish browser.
          lang="en"
          aria-label="Task: what to do, with a day, #place and p1 to p4"
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
        <ul id={listId} className="popup qa-suggest" role="listbox" aria-label="Places" hidden={!listOpen}>
          {suggestions.map((entry, index) => (
            <li
              key={entry.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              className="option"
              data-highlighted={index === highlighted ? "" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(entry)}
            >
              {entry.path}
            </li>
          ))}
        </ul>
      </div>
      <div className="qa-chips" role="group" aria-label="What the task will be">
        <span className="qa-chip" data-read={readKinds.has("date") || undefined} data-set={day ? "" : undefined}>
          <DatePicker
            look="chip"
            label={KIND_NAMES.date}
            value={day}
            display={whenLabel(day, time, now)}
            onChange={(next) => choose("date", { day: next, time: next ? time : null }, next === null)}
          />
        </span>
        <span className="qa-chip" data-read={readKinds.has("place") || undefined} data-set="">
          <Select
            look="chip"
            label={KIND_NAMES.place}
            value={placeId === undefined ? null : (placeId ?? GENERAL)}
            placeholder={`Choose: ${candidates.length} places`}
            options={placeOptions}
            onChange={(value) => choose("place", value === GENERAL ? null : value, value === GENERAL)}
          />
        </span>
        <span className="qa-chip" data-read={readKinds.has("priority") || undefined} data-set={priority ? "" : undefined}>
          <Select
            look="chip"
            label={KIND_NAMES.priority}
            value={priority ? String(priority) : NO_PRIORITY}
            options={priorityOptions}
            onChange={(value) => choose("priority", value === NO_PRIORITY ? null : Number(value), value === NO_PRIORITY)}
          />
        </span>
      </div>
      {(problem || reading.unknownPlace) && (
        <p className="inline-note qa-note" data-tone={problem ? "alert" : undefined} role={problem ? "alert" : "status"}>
          {problem ?? `No client or project is called “${reading.unknownPlace}”: the task goes to ${place?.path ?? "General"}.`}
        </p>
      )}
      <div className="qa-foot">
        <div className="qa-actions">
          <Button size="sm" onClick={() => onDone("cancel")}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy || !reading.title}>
            {busy ? "Adding…" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// The quick add of the whole workspace: a dialog opened by any caller of `openQuickAdd` —the sidebar's «Add task», the Q
// key the shell listens to, a group's foot—. It starts where the caller asks, and on General when it asks for nothing.
// The shell mounts it once.
export function QuickAddDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const popupOpen = useRef(false);
  const [start, setStart] = useState<QuickAddStart | null>(null);
  const [round, setRound] = useState(0);

  useEffect(
    () =>
      onOpenQuickAdd((next) => {
        const el = dialog.current;
        if (!el) return;
        if (!el.open) opener.current = document.activeElement as HTMLElement | null;
        setStart(next);
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
        // A chip's list open inside takes this Escape: read before its own handler closes it.
        if (event.key === "Escape") popupOpen.current = Boolean(dialog.current?.querySelector("[data-popup-open]"));
      }}
      onCancel={(event) => {
        if (!popupOpen.current) return;
        popupOpen.current = false;
        event.preventDefault();
      }}
      onClose={() => {
        setStart(null);
        requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
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
        {start && <QuickAddEditor key={round} start={start} onDone={() => dialog.current?.close()} />}
      </PopupLayerProvider>
    </dialog>
  );
}

// The quick add at a group's foot: «Add task» unfolds the same field in place, and what it adds takes the group's day
// (and the page's place).
export function QuickAddInline({ day, placeId, parentId, label = "Add task" }: { day?: Day | null; placeId?: string | null; parentId?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  if (!open) {
    return (
      <button ref={button} type="button" className="task-add qa-open" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="qa-inline">
      <QuickAddEditor
        key={round}
        inline
        start={{ day: day ?? null, placeId, parentId }}
        onDone={(reason) => {
          if (reason === "added") return setRound((value) => value + 1);
          setOpen(false);
          requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
        }}
      />
    </div>
  );
}
