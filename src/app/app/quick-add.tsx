"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Fold } from "@/components/ui/fold";
import { TextArea } from "@/components/ui/field";
import { NodeGlyph } from "@/components/node-glyph";
import { trackTaskCreated } from "@/lib/analytics";
import { AddIcon, DateIcon, EnterKeyIcon, EventIcon, GeneralIcon, PriorityIcon, TimeIcon } from "@/components/ui/icons";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { Select, type SelectOption } from "@/components/ui/select";
import { afterExit, focusAfterClose, handBack } from "@/components/ui/use-exit";
import { addDays, instantsOf, today, type Day } from "@/lib/dates";
import { taskPayload } from "@/lib/create-task";
import { inlinePlain } from "@/lib/inline-links";
import { tool, type Item } from "./client-api";
import { dueTimeOptions, NO_TIME } from "./due-times";
import { readEvents } from "./events-read";
import { PRIORITIES } from "./item-parts";
import { onOpenQuickAdd, type QuickAddStart } from "./quick-add-bus";
import { openTaskDetail, pasteLinkOver, whenLabel, whenTone } from "./task-row";
import { menuButton, useWorkspace } from "./workspace";

const LOW = 4;
const GENERAL = "general";
const NONE = "none";
const NEW_EVENT = "new";

type ListedEvent = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  origin: "google" | "local";
  localId: string | null;
  accountId: string;
  calendarId: string;
};

type EventChoice =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "local"; id: string }
  | { kind: "google"; accountId: string; calendarId: string; id: string };

type Done = (reason: "added" | "close" | "discard", createdId?: string) => void;

const eventKey = (event: ListedEvent) =>
  event.origin === "local" && event.localId ? `local:${event.localId}` : `google:${event.accountId}:${event.calendarId}:${event.id}`;

function eventSpan(day: Day, time: string | null) {
  if (!time) return { startsOn: day };
  const [h, m] = time.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  const start = new Date(y, mo - 1, d, h, m);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() };
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
  onDone: Done;
  inline?: boolean;
  submitLabel?: string;
  draft?: string;
  onDraft?: (text: string) => void;
}) {
  const { tree, notify, touch, saving } = useWorkspace();
  const [text, setText] = useState(draft ?? "");
  const [day, setDay] = useState<Day | null>(start.day ?? null);
  const [time, setTime] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(start.placeId ?? null);
  const [priority, setPriority] = useState(LOW);
  const [description, setDescription] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [eventChoice, setEventChoice] = useState<EventChoice>({ kind: "none" });
  const [events, setEvents] = useState<ListedEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const adding = useRef(false);
  const fieldId = useId();
  const descriptionId = useId();
  const now = today();

  useEffect(() => {
    onDraft?.(text);
  }, [text, onDraft]);

  useEffect(() => {
    let live = true;
    const from = today();
    const to = addDays(from, 30);
    const range = instantsOf(from, to);
    void readEvents<ListedEvent>({ from: range.from, to: range.to, fromDay: from, toDay: to }).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setProblem("The calendars could not be read. Add the task, and link the event from it.");
        return;
      }
      setEvents(answer.events);
      if (answer.failures.length > 0) setProblem("Some calendars could not be read. The ones that answered are in the list.");
    });
    return () => {
      live = false;
    };
  }, []);

  const places = useMemo(() => (tree ?? []).map((node) => ({ id: node.id, name: node.name, path: node.path })), [tree]);
  const place = placeId ? places.find((entry) => entry.id === placeId) ?? null : null;
  const colorOf = (id: string | null) => (id ? (tree?.find((node) => node.id === id)?.color ?? undefined) : undefined);
  const placeOptions: SelectOption[] = [{ value: GENERAL, label: "General" }, ...places.map((entry) => ({ value: entry.id, label: entry.path }))];
  const hours = time ? dueTimeOptions(time) : dueTimeOptions(null).filter((option) => option.value !== NO_TIME);
  const eventValue = eventChoice.kind === "none" ? NONE : eventChoice.kind === "new" ? NEW_EVENT : eventChoice.kind === "local" ? `local:${eventChoice.id}` : `google:${eventChoice.accountId}:${eventChoice.calendarId}:${eventChoice.id}`;
  const eventOptions: SelectOption[] = [
    { value: NONE, label: "No event" },
    { value: NEW_EVENT, label: "New calendar event" },
    ...events.map((event) => ({ value: eventKey(event), label: event.allDay ? `${event.title}, ${event.start.slice(0, 10)}` : `${event.title}, ${event.start.slice(0, 16).replace("T", " ")}` })),
  ];

  function pickEvent(value: string) {
    if (value === NONE) return setEventChoice({ kind: "none" });
    if (value === NEW_EVENT) return setEventChoice({ kind: "new" });
    const event = events.find((entry) => eventKey(entry) === value);
    if (!event) return setEventChoice({ kind: "none" });
    if (event.origin === "local" && event.localId) setEventChoice({ kind: "local", id: event.localId });
    else setEventChoice({ kind: "google", accountId: event.accountId, calendarId: event.calendarId, id: event.id });
  }

  async function add() {
    if (adding.current) return;
    adding.current = true;
    const payload = taskPayload({
      title: text,
      day,
      time,
      placeId,
      parentId: start.parentId,
      priority,
      description,
      subtasks,
      notes,
    });
    if (!payload.title) {
      setProblem("Write what has to be done.");
      adding.current = false;
      return field.current?.focus();
    }
    if (eventChoice.kind === "new" && !payload.dueOn) {
      setProblem("Choose a date for the calendar event.");
      adding.current = false;
      return field.current?.focus();
    }
    setBusy(true);
    setProblem(null);
    let createdEvent: string | null = null;
    try {
      const answer = await tool<{ item: Item }>("create_task", {
        node: payload.node,
        ...(payload.parent ? { parent: payload.parent } : {}),
        title: payload.title,
        priority: payload.priority,
        ...(payload.notes ? { notes: payload.notes } : {}),
        ...(payload.dueOn ? { dueOn: payload.dueOn } : {}),
        ...(payload.dueTime ? { dueTime: payload.dueTime } : {}),
      });
      if (answer.ok) trackTaskCreated();
      if (!answer.ok) {
        setProblem(`The task could not be added: ${answer.message}`);
        return;
      }
      const id = answer.item.id;
      const missed: string[] = [];
      for (const line of payload.subtasks) {
        const child = await tool("create_task", { parent: id, title: line });
        if (!child.ok) missed.push("A subtask");
      }
      for (const line of payload.notesToAdd) {
        const note = await tool("add_note", { parent: id, text: line });
        if (!note.ok) missed.push("A note");
      }
      if (eventChoice.kind === "new") {
        const made = await tool<{ event: { id: string } }>("create_event", {
          node: payload.node,
          title: inlinePlain(payload.title),
          ...eventSpan(payload.dueOn ?? today(), payload.dueTime ?? null),
        });
        if (!made.ok) missed.push("The calendar event");
        else {
          createdEvent = made.event.id;
          const linked = await tool("link_task_event", { task: id, event: made.event.id });
          if (!linked.ok) {
            await tool("delete_event", { id: made.event.id });
            createdEvent = null;
            missed.push("The calendar event");
          }
        }
      } else if (eventChoice.kind === "local") {
        if (!(await tool("link_task_event", { task: id, event: eventChoice.id })).ok) missed.push("The calendar event");
      } else if (eventChoice.kind === "google") {
        const linked = await tool("link_task_event", {
          task: id,
          account: eventChoice.accountId,
          calendar: eventChoice.calendarId,
          googleEvent: eventChoice.id,
        });
        if (!linked.ok) missed.push("The calendar event");
      }
      touch();
      const where = place?.path ?? "General";
      const failed = [...new Set(missed)].map((item) => item.charAt(0).toLowerCase() + item.slice(1));
      const missedText = failed.join(" and ");
      notify({
        text: failed.length
          ? `Added “${inlinePlain(payload.title)}” in ${where}. ${missedText.charAt(0).toUpperCase()}${missedText.slice(1)} could not be added: it is open, add it there.`
          : `Added “${inlinePlain(payload.title)}” in ${where}.`,
        tone: failed.length ? "error" : "status",
        undo: () =>
          void saving(
            (async () => {
              const removed = await tool("delete_item", { id });
              if (createdEvent) {
                const event = await tool("delete_event", { id: createdEvent });
                if (!event.ok) return event;
              }
              return removed;
            })(),
          ),
      });
      setText("");
      setDescription("");
      setSubtasks([]);
      setNotes([]);
      setEventChoice({ kind: "none" });
      onDone("added", id);
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void add();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone("close");
    }
  }

  return (
    <div className="qa" data-inline={inline || undefined}>
      <div className="qa-head">
        <label className="t-label" htmlFor={fieldId}>
          Task
        </label>
        <TextArea
          ref={field}
          id={fieldId}
          className="qa-title"
          rows={2}
          autoFocus
          lang="en"
          placeholder="Call the printer"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
            if (next !== null) {
              event.preventDefault();
              setText(next);
            }
          }}
        />
      </div>
      <div className="qa-chips" role="group" aria-label="Place, date and priority">
        <span className="qa-chip task-prop" data-prop="date" data-set={day ? "" : undefined} data-unset={day ? undefined : ""} data-when={day ? whenTone(day, now) : undefined}>
          {time ? <TimeIcon className="task-prop-icon" /> : <DateIcon className="task-prop-icon" />}
          <DatePicker look="chip" label="Date" value={day} display={whenLabel(day, null, now)} onChange={(next) => { setDay(next); if (!next) setTime(null); }} />
        </span>
        {day && (
          <span className="qa-chip task-prop" data-prop="time" data-set={time ? "" : undefined} data-unset={time ? undefined : ""}>
            <TimeIcon className="task-prop-icon" />
            <Select look="chip" label="Time" value={time} placeholder="Add time" options={hours} onChange={(value) => setTime(value === NO_TIME ? null : value)} />
          </span>
        )}
        <span className="qa-chip task-prop" data-prop="place" data-set="" data-color={colorOf(placeId)}>
          {placeId ? (
            <NodeGlyph className="task-prop-icon" kind={tree?.find((node) => node.id === placeId)?.kind} icon={tree?.find((node) => node.id === placeId)?.icon} />
          ) : (
            <GeneralIcon className="task-prop-icon" />
          )}
          <Select look="chip" label="Client or project" value={placeId ?? GENERAL} options={placeOptions} onChange={(value) => setPlaceId(value === GENERAL ? null : value)} />
        </span>
        <span className="qa-chip task-prop" data-prop="priority" data-set="" data-priority={priority}>
          <PriorityIcon className="task-prop-icon" />
          <Select look="chip" label="Priority" value={String(priority)} options={PRIORITIES} onChange={(value) => setPriority(Number(value))} />
        </span>
        <span className="qa-chip task-prop" data-prop="event" data-set={eventChoice.kind === "none" ? undefined : ""} data-unset={eventChoice.kind === "none" ? "" : undefined}>
          <EventIcon className="task-prop-icon" />
          <Select look="chip" label="Calendar event" value={eventValue} options={eventOptions} onChange={pickEvent} />
        </span>
      </div>
      <div className="qa-more">
        <label className="t-label" htmlFor={descriptionId}>
          Description
        </label>
        <TextArea id={descriptionId} rows={3} lang="en" placeholder="Add a description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <LineList label="Subtasks" addLabel="Add subtask" lines={subtasks} onChange={setSubtasks} />
        <LineList label="Notes" addLabel="Add note" lines={notes} onChange={setNotes} />
      </div>
      {problem && (
        <p className="inline-note qa-note" data-tone="alert" role="alert">
          {problem}
        </p>
      )}
      <div className="qa-foot">
        <p className="t-meta qa-hint">The task opens when you add it, in the place and on the date you set.</p>
        <div className="qa-actions">
          <Button size="sm" onClick={() => onDone("discard")}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy || !text.trim()} aria-keyshortcuts="Enter">
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

function LineList({ label, addLabel, lines, onChange }: { label: string; addLabel: string; lines: string[]; onChange: (lines: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const id = useId();
  function push() {
    const next = draft.trim();
    if (!next) return;
    onChange([...lines, next]);
    setDraft("");
  }
  return (
    <div className="qa-lines">
      <label className="t-label" htmlFor={id}>
        {label}
      </label>
      {lines.length > 0 && (
        <ul className="qa-line-list">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>
              <span className="t-body">{line}</span>
              <button type="button" className="task-add" onClick={() => onChange(lines.filter((_, at) => at !== index))} aria-label={`Remove ${line}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="qa-line-add">
        <TextArea
          id={id}
          rows={1}
          lang="en"
          placeholder={addLabel === "Add subtask" ? "Confirm the stock" : "Ask for the proof"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              push();
            }
          }}
        />
        <Button size="sm" onClick={push} disabled={!draft.trim()}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function QuickAddDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const popupOpen = useRef(false);
  const created = useRef<string | null>(null);
  const draft = useRef("");
  const keepDraft = (text: string) => {
    draft.current = text;
  };
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
        const id = created.current;
        created.current = null;
        const element = dialog.current;
        afterExit(element, () => {
          if (!element?.open) setStart(null);
        });
        focusAfterClose(handBack(opener.current, menuButton), opener.current);
        if (id) openTaskDetail({ id });
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
          <QuickAddEditor
            key={round}
            start={start}
            draft={words}
            onDraft={keepDraft}
            onDone={(reason, id) => {
              if (reason === "discard") draft.current = "";
              created.current = reason === "added" ? id ?? null : null;
              dialog.current?.close();
            }}
          />
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
            onDone={(reason, id) => {
              if (reason === "added") {
                setRound((value) => value + 1);
                if (id) openTaskDetail({ id });
                return;
              }
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
