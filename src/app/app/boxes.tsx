"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { cx } from "@/lib/utils";
import { get, post, tool } from "./client-api";
import { useWorkspace } from "./workspace";
import "../styles/boxes.css";

// ---- The boxes a page holds, in the order the person gave them ------------------------------------------------------
// A page's boxes are one list read from the first column to the second: `SPLIT` marks where the second column starts.
// On a computer the two columns stand side by side, each box as tall as its content; on a phone they read as one column
// in that same order. Hidden boxes keep their place, so showing one again puts it back where it was.

export const SPLIT = "split";

export type BoardLayout = { order: string[]; hidden: string[] };

// A stored order keeps what this page still has, in its place; a box the page added since enters at the end of the
// column its default gives it.
export function settleLayout(saved: BoardLayout | null, defaults: string[]): BoardLayout {
  const known = new Set(defaults);
  if (!saved) return { order: defaults, hidden: [] };
  const order = saved.order.filter((id, index, all) => known.has(id) && all.indexOf(id) === index);
  if (!order.includes(SPLIT)) order.push(SPLIT);
  for (const id of defaults) {
    if (order.includes(id)) continue;
    const second = defaults.indexOf(id) > defaults.indexOf(SPLIT);
    if (second) order.push(id);
    else order.splice(order.indexOf(SPLIT), 0, id);
  }
  return { order, hidden: saved.hidden.filter((id) => known.has(id) && id !== SPLIT) };
}

export function columnsOf(layout: BoardLayout): [string[], string[]] {
  const at = layout.order.indexOf(SPLIT);
  return [layout.order.slice(0, at), layout.order.slice(at + 1)];
}

// The board's order and what is hidden: each change shows at once, is saved for the person (and in the cookie the server
// reads, so the page enters in this order next time), and goes back saying so if the server refuses it.
export function useBoardLayout(page: string, defaults: string[], saved: BoardLayout | null, apart: string | null = null) {
  const { notify } = useWorkspace();
  const [layout, setLayout] = useState(() => settleLayout(saved, defaults));
  const confirmed = useRef(layout);
  const touched = useRef(false);

  // The cookie paints the first order; the server's is read once anyway, because it may carry an order the person gave
  // on another device (or one the cookie left out, since it keeps only what fits). When it differs and the person has
  // touched nothing yet, the board takes it, travelling as a move does.
  useEffect(() => {
    let live = true;
    void get<{ preferences: { boards: Record<string, BoardLayout> } }>("/api/preferences").then((answer) => {
      if (!live || touched.current || !answer.ok) return;
      const stored = answer.preferences.boards[page];
      const next = settleLayout(stored ?? null, defaults);
      const same = (a: BoardLayout, b: BoardLayout) => a.order.join() === b.order.join() && a.hidden.join() === b.hidden.join();
      confirmed.current = next;
      setLayout((current) => (same(current, next) ? current : next));
    });
    return () => {
      live = false;
    };
    // Read once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // The order is saved whole, the latest one wins: a change made while another is on its way waits for it, and only the
  // newest waiting one is sent. A refusal goes back to what the server last kept only when nothing newer is waiting, so a
  // failed first change never takes back a second one.
  const wanted = useRef<BoardLayout | null>(null);
  const sending = useRef(false);
  const send = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    while (wanted.current) {
      const next = wanted.current;
      wanted.current = null;
      const answer = await savePreference({ page, board: next });
      if (answer.ok) confirmed.current = next;
      else if (!wanted.current) {
        setLayout(confirmed.current);
        notify({ text: `The boxes' order could not be saved: ${answer.message}`, tone: "error" });
      }
    }
    sending.current = false;
  }, [page, notify]);

  const commit = useCallback(
    (next: BoardLayout, said?: string) => {
      touched.current = true;
      setLayout(next);
      wanted.current = next;
      void send();
      if (said) announce(said);
    },
    [send],
  );

  // What the columns draw: not what is hidden, nor a box drawn across both columns.
  const visible = (order: string[]) => order.filter((id) => id === SPLIT || (!layout.hidden.includes(id) && id !== apart));

  // One step up or down among the boxes in view, across the columns: the last of the first column steps into the
  // second, as the phone reads them.
  function step(id: string, by: -1 | 1, name: string) {
    const shown = visible(layout.order);
    const at = shown.indexOf(id);
    const target = at + by;
    if (target < 0 || target >= shown.length) return;
    const swapWith = shown[target];
    const order = [...layout.order];
    const from = order.indexOf(id);
    const to = order.indexOf(swapWith);
    order.splice(from, 1);
    order.splice(to, 0, id);
    commit({ ...layout, order }, `${name} moved ${by < 0 ? "up" : "down"}.`);
    refocus(id);
  }

  // To the other column, at its end.
  function otherColumn(id: string, name: string) {
    const [first] = columnsOf(layout);
    const order = layout.order.filter((entry) => entry !== id);
    if (first.includes(id)) order.push(id);
    else order.splice(order.indexOf(SPLIT), 0, id);
    commit({ ...layout, order }, `${name} moved to the ${first.includes(id) ? "second" : "first"} column.`);
    refocus(id);
  }

  // A drop: before another box, or at the end of a column.
  function place(id: string, before: string | null, column: 0 | 1) {
    const order = layout.order.filter((entry) => entry !== id);
    if (before) order.splice(order.indexOf(before), 0, id);
    else if (column === 0) order.splice(order.indexOf(SPLIT), 0, id);
    else order.push(id);
    if (order.join() === layout.order.join()) return;
    commit({ ...layout, order });
  }

  function hide(id: string, name: string) {
    commit({ ...layout, hidden: [...layout.hidden, id] }, `${name} is hidden. «More» of the page, «Customize», shows it again.`);
    // The box held the focus: it goes to the page's title, the start of what is left.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-page-title]")?.focus({ preventScroll: true }));
  }

  function show(id: string, name: string) {
    commit({ ...layout, hidden: layout.hidden.filter((entry) => entry !== id) }, `${name} is back.`);
    refocus(id);
  }

  function reset() {
    commit({ order: defaults, hidden: [] }, "The boxes are back in their first order.");
  }

  return { layout, step, otherColumn, place, hide, show, reset, columns: columnsOf({ ...layout, order: visible(layout.order) }) };
}

export type Board = ReturnType<typeof useBoardLayout>;

// Every write of the preferences goes out one after the other, in the order the person made them: two changes at once
// (the order and List or Board) never race each other to the server.
let preferenceChain: Promise<unknown> = Promise.resolve();
export function savePreference(change: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  const next = preferenceChain.then(() => post("/api/preferences", change));
  preferenceChain = next.catch(() => {});
  return next;
}

// What the page's «More» offers for its boxes: the hidden ones back, and the first order.
export function customizeEntries(board: Board, names: Record<string, string>): MenuEntry[] {
  const hidden = board.layout.hidden.filter((id) => names[id]);
  return [
    {
      kind: "submenu",
      label: "Customize",
      detail: hidden.length ? `${hidden.length} hidden` : undefined,
      entries: [
        ...(hidden.length
          ? hidden.map((id): MenuEntry => ({ kind: "action", label: `Show ${names[id]}`, onSelect: () => board.show(id, names[id]) }))
          : [{ kind: "action" as const, label: "Every box is in view", disabled: true, onSelect: () => {} }]),
        { kind: "separator" },
        { kind: "action", label: "Put the boxes back in their first order", onSelect: () => board.reset() },
      ],
    },
  ];
}

// What a move says to whoever does not see it travel.
let announcer: ((text: string) => void) | null = null;
function announce(text: string) {
  announcer?.(text);
}

// After a move the box's «More» keeps the focus, wherever the box landed.
function refocus(id: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-box="${id}"] .box-more .menu-trigger`)?.focus({ preventScroll: true })),
  );
}

// ---- The board: two columns that become one, each box dragged by its head ---------------------------------------------

export type BoxSpec = {
  id: string;
  // Its name, which its title, its «More» and «Customize» say.
  title: string;
  // What it holds, beside its title: «8», «3 unread».
  count?: ReactNode;
  // Its own entries, before the moves.
  menu?: MenuEntry[];
  // While it reads for the first time, and when its read failed with nothing to show.
  busy?: boolean;
  content: ReactNode;
};

type BoxDrag = { id: string };
let boxDrag: BoxDrag | null = null;

const fineQuery = "(hover: hover) and (pointer: fine)";
function useFinePointer(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(fineQuery);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia(fineQuery).matches,
    () => false,
  );
}

// The board enters column by column: a box shows once it and every box above it in its column read for the first time
// —or failed—, so nothing that shows is pushed by a box arriving above it; at the latest after a short wait, all show.
// What shows takes the pointer at once: only what was never drawn waits.
const ENTRY_CAP_MS = 6000;
const BoxIdContext = createContext<string | null>(null);
const SettledContext = createContext<((id: string, settled: boolean) => void) | null>(null);

// A box's content says when its first read settled.
export function useBoxSettled(settled: boolean): void {
  const id = useContext(BoxIdContext);
  const report = useContext(SettledContext);
  useEffect(() => {
    if (id) report?.(id, settled);
  }, [id, settled, report]);
}

export function BoxBoard({ board, boxes, label, wide }: { board: Board; boxes: Record<string, BoxSpec>; label: string; wide?: BoxSpec | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const [capped, setCapped] = useState(false);
  const report = useCallback((id: string, value: boolean) => setSettled((known) => (known[id] === value ? known : { ...known, [id]: value })), []);
  useEffect(() => {
    const timer = setTimeout(() => setCapped(true), ENTRY_CAP_MS);
    return () => clearTimeout(timer);
  }, []);
  const inView = [...board.columns[0], ...board.columns[1], ...(wide ? [wide.id] : [])].filter((id) => boxes[id]);
  const [entered, setEntered] = useState(false);
  if (!entered && (capped || inView.every((id) => settled[id]))) setEntered(true);
  const ready = entered;
  // Which boxes show: the wide one once it read, and in each column the run of boxes from the top whose reads settled;
  // the boxes below a wide one that still reads wait with it.
  const revealed = new Set<string>();
  if (entered) inView.forEach((id) => revealed.add(id));
  else if (!wide || settled[wide.id]) {
    if (wide) revealed.add(wide.id);
    for (const column of board.columns) {
      for (const id of column.filter((entry) => boxes[entry] && entry !== wide?.id)) {
        if (!settled[id]) break;
        revealed.add(id);
      }
    }
  }
  const [drop, setDrop] = useState<{ before: string | null; column: 0 | 1 } | null>(null);
  const [said, setSaid] = useState("");
  const fine = useFinePointer();
  const [first, second] = board.columns;
  const shown = (ids: string[]) => ids.filter((id) => boxes[id] && id !== wide?.id);

  useEffect(() => {
    announcer = setSaid;
    return () => {
      if (announcer === setSaid) announcer = null;
    };
  }, []);

  // A box that moves travels from where it was: its old place is read before the change paints, the new one after.
  const rects = useRef(new Map<string, DOMRect>());
  const orderKey = board.layout.order.join() + "|" + board.layout.hidden.join();
  const lastKey = useRef(orderKey);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const nodes = [...element.querySelectorAll<HTMLElement>("[data-box]")];
    const moved = lastKey.current !== orderKey;
    lastKey.current = orderKey;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    for (const node of nodes) {
      const id = node.dataset.box!;
      const rect = node.getBoundingClientRect();
      next.set(id, rect);
      const before = rects.current.get(id);
      if (!moved || reduced || !before) continue;
      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      node.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 360, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    }
    rects.current = next;
  });
  // The places are read again after the boxes change size, so the next move starts from where each box really is.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = new Map<string, DOMRect>();
      element.querySelectorAll<HTMLElement>("[data-box]").forEach((node) => next.set(node.dataset.box!, node.getBoundingClientRect()));
      rects.current = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function onDragOver(event: DragEvent<HTMLElement>, column: 0 | 1) {
    if (!boxDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-box]");
    let before: string | null = null;
    if (target && target.dataset.box !== boxDrag.id) {
      const box = target.getBoundingClientRect();
      const ids = column === 0 ? shown(first) : shown(second);
      const at = ids.indexOf(target.dataset.box!);
      before = event.clientY < box.top + box.height / 2 ? ids[at] : (ids[at + 1] ?? null);
    } else if (target) return;
    if (before === boxDrag.id) return;
    if (drop?.before !== before || drop?.column !== column) setDrop({ before, column });
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!boxDrag || !drop) return;
    event.preventDefault();
    board.place(boxDrag.id, drop.before, drop.column);
    boxDrag = null;
    setDrop(null);
  }

  const renderColumn = (ids: string[], column: 0 | 1) => (
    <div
      className="boxes-col"
      data-column={column + 1}
      onDragOver={(event) => onDragOver(event, column)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={onDrop}
    >
      {ids.map((id, index) => (
        <Box
          key={id}
          spec={boxes[id]}
          index={index + (column === 1 ? first.length : 0)}
          board={board}
          draggable={fine}
          dropBefore={drop?.before === id && drop.column === column}
          isFirst={board.columns[0].concat(board.columns[1]).filter((entry) => boxes[entry])[0] === id}
          isLast={board.columns[0].concat(board.columns[1]).filter((entry) => boxes[entry]).at(-1) === id}
          column={column}
          shown={revealed.has(id)}
        />
      ))}
      {/* The end of a column takes a box too, also an empty one. */}
      <div className="boxes-end" data-drop={(drop && drop.before === null && drop.column === column) || undefined} aria-hidden="true" />
    </div>
  );

  return (
    <SettledContext.Provider value={report}>
    <div ref={host} className="boxes" data-ready={ready || undefined} aria-label={label} role="region">
      {wide && (
        <div className="boxes-wide">
          <Box spec={wide} index={0} board={board} draggable={false} dropBefore={false} isFirst isLast column={0} fixed shown={revealed.has(wide.id)} />
        </div>
      )}
      <div className="boxes-cols">
        {renderColumn(shown(first), 0)}
        {renderColumn(shown(second), 1)}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {revealed.size === 0 && (
        <p className="boxes-wait t-meta" role="status">
          Reading your workspace…
        </p>
      )}
    </div>
    </SettledContext.Provider>
  );
}

function Box({
  spec,
  index,
  board,
  draggable,
  dropBefore,
  isFirst,
  isLast,
  column,
  fixed = false,
  shown,
}: {
  spec: BoxSpec;
  index: number;
  board: Board;
  draggable: boolean;
  dropBefore: boolean;
  isFirst: boolean;
  isLast: boolean;
  column: 0 | 1;
  // A box drawn across both columns (a board of tasks) stays where it is.
  fixed?: boolean;
  // Whether it entered; one still waiting is out of sight and of the pointer's path, and says it is busy.
  shown: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const titleId = `box-${spec.id}-title`;
  const moves: MenuEntry[] = fixed
    ? []
    : [
        { kind: "action", label: "Move up", disabled: isFirst, detail: isFirst ? "First already" : undefined, onSelect: () => board.step(spec.id, -1, spec.title) },
        { kind: "action", label: "Move down", disabled: isLast, detail: isLast ? "Last already" : undefined, onSelect: () => board.step(spec.id, 1, spec.title) },
        { kind: "action", label: column === 0 ? "Move to the second column" : "Move to the first column", onSelect: () => board.otherColumn(spec.id, spec.title) },
        { kind: "separator" },
      ];
  const entries: MenuEntry[] = [...(spec.menu?.length ? [...spec.menu, { kind: "separator" } as const] : []), ...moves, { kind: "action", label: "Hide this box", onSelect: () => board.hide(spec.id, spec.title) }];

  return (
    <section
      className="box"
      data-box={spec.id}
      data-menu-open={menuOpen || undefined}
      data-drop-before={dropBefore || undefined}
      aria-labelledby={titleId}
      data-shown={shown || undefined}
      aria-busy={!shown || spec.busy || undefined}
      style={{ "--enter-delay": `${Math.min(index, 6) * 55}ms` } as CSSProperties}
    >
      <header
        className={cx("box-head", draggable && !fixed && "box-head-drag")}
        draggable={draggable && !fixed}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest(".box-more")) return event.preventDefault();
          boxDrag = { id: spec.id };
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", spec.title);
          const box = (event.currentTarget as HTMLElement).closest<HTMLElement>(".box");
          if (box) event.dataTransfer.setDragImage(box, 32, 20);
          requestAnimationFrame(() => box?.setAttribute("data-dragging", ""));
        }}
        onDragEnd={(event) => {
          boxDrag = null;
          (event.currentTarget as HTMLElement).closest(".box")?.removeAttribute("data-dragging");
        }}
      >
        <h2 id={titleId} className="t-title box-title" tabIndex={-1}>
          {spec.title}
        </h2>
        {spec.count !== undefined && spec.count !== null && <span className="box-count">{spec.count}</span>}
        <div className="box-more">
          <Menu label="More" about={`for ${spec.title}`} entries={entries} onOpenChange={setMenuOpen} />
        </div>
      </header>
      <div className="box-body">
        <BoxIdContext.Provider value={spec.id}>{spec.content}</BoxIdContext.Provider>
      </div>
    </section>
  );
}

// ---- A box's states: what it reads, which empty it is, and a read that failed -------------------------------------

export function BoxWait({ what, rows = 3 }: { what: string; rows?: number }) {
  return (
    <div className="box-wait" role="status" aria-busy="true">
      <p className="t-meta">{what}</p>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton" style={{ width: `${[78, 56, 66, 48][index % 4]}%` }} />
      ))}
    </div>
  );
}

export function BoxEmpty({ text, children, reason }: { text: ReactNode; children?: ReactNode; reason?: string }) {
  return (
    <div className="box-empty" data-empty={reason}>
      <p className="t-help">{text}</p>
      {children}
    </div>
  );
}

// A read that failed: with something on screen it stays and the box says it is the last version; with nothing, the box
// says what could not be read and offers to read again.
export function BoxFailed({ what, message, kept, onRetry }: { what: string; message: string; kept: boolean; onRetry: () => void }) {
  return (
    <div className="box-failed" role="alert" data-failed>
      <p className="inline-note" data-tone="alert">
        {kept ? `${what} could not be refreshed: ${message}. What you see is the last version read.` : `${what} could not be read: ${message}.`}
      </p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ---- Reading a box's data ------------------------------------------------------------------------------------------
// What a box read, with the request it answers: once the request changes —another place, another account— what is on
// screen belongs to the previous one and says so until the new answer arrives. A refresh that fails keeps it.

export type BoxRead<T> = { data: T | null; error: string | null; stale: boolean; settled: boolean; retry: () => void };

export function useBoxRead<T>(read: (() => Promise<{ ok: true } & T | { ok: false; message: string }>) | null, key: string): BoxRead<T> {
  const { version } = useWorkspace();
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [round, setRound] = useState(0);
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  useEffect(() => {
    const run = reader.current;
    if (!run) return;
    let live = true;
    void run().then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setState({ key, value: answer as unknown as T });
        setError(null);
      } else setError({ key, message: answer.message });
    });
    return () => {
      live = false;
    };
  }, [key, version, round]);
  const failed = error?.key === key ? error.message : null;
  return {
    data: state?.value ?? null,
    error: failed,
    stale: state !== null && state.key !== key,
    settled: state !== null || failed !== null || read === null,
    retry: () => setRound((value) => value + 1),
  };
}

// A tool read for a box.
export function useToolRead<T>(name: string, input: Record<string, unknown> | null): BoxRead<T> {
  const key = input ? `${name}:${JSON.stringify(input)}` : `${name}:off`;
  return useBoxRead<T>(input ? () => tool<T>(name, input) : null, key);
}
