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
import { ActivityIcon, CalendarIcon, GripIcon, MailIcon, NoDateIcon, NoteIcon, TasksIcon, type Icon } from "@/components/ui/icons";
import { landFrom, useFlip } from "@/components/ui/flip";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { Tick } from "@/components/ui/tick";
import { cx } from "@/lib/utils";
import { columnsOf, isMark, orderDropped, orderMovedTo, settleLayout, steppedOrder, type BoardLayout, type Zone } from "./board-layout";
import { get, peekTool, post, tool } from "./client-api";
import { isFresh, keep, peek, refreshEnded, refreshStarted, stamp, type Kept } from "./read-cache";
import { useWorkspace } from "./workspace";
import "../styles/boxes.css";




const MOVE_ON = ["Move to the second column", "Move to the row below", "Move to the first column"];
const ZONE_NAMES = ["the first column", "the second column", "the row below"];



export function useBoardLayout(page: string, defaults: string[], saved: BoardLayout | null, apart: string | null = null) {
  const { notify } = useWorkspace();
  const [layout, setLayout] = useState(() => settleLayout(saved, defaults));
  const confirmed = useRef(layout);
  const touched = useRef(false);

  
  
  
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
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  
  
  
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

  
  const visible = (order: string[]) => order.filter((id) => isMark(id) || (!layout.hidden.includes(id) && id !== apart));

  
  function step(id: string, by: -1 | 1, name: string, spread: boolean) {
    const order = steppedOrder(layout.order, visible(layout.order), id, by, spread);
    if (!order) return;
    commit({ ...layout, order }, `${name} moved ${by < 0 ? "up" : "down"}.`);
    refocus(id);
  }

  
  function moveOn(id: string, name: string, spread: boolean) {
    const [first, second] = columnsOf(layout);
    const from: Zone = first.includes(id) ? 0 : second.includes(id) ? 1 : 2;
    const to = spread ? (((from + 1) % 3) as Zone) : 2;
    commit({ ...layout, order: orderMovedTo(layout.order, id, to) }, `${name} moved to ${spread ? ZONE_NAMES[to] : "the end"}.`);
    refocus(id);
  }

  
  function place(id: string, before: string | null, zone: Zone) {
    const order = orderDropped(layout.order, id, before, zone);
    if (order.join() === layout.order.join()) return;
    commit({ ...layout, order });
  }

  function hide(id: string, name: string) {
    commit({ ...layout, hidden: [...layout.hidden, id] }, `${name} hidden. Show it again from More › Customize.`);
    
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-page-title]")?.focus({ preventScroll: true }));
  }

  function show(id: string, name: string) {
    commit({ ...layout, hidden: layout.hidden.filter((entry) => entry !== id) }, `${name} is back.`);
    refocus(id);
  }

  function reset() {
    commit({ order: defaults, hidden: [] }, "Layout reset.");
  }

  return { layout, step, moveOn, place, hide, show, reset, columns: columnsOf({ ...layout, order: visible(layout.order) }) };
}

export type Board = ReturnType<typeof useBoardLayout>;



let preferenceChain: Promise<unknown> = Promise.resolve();
export function savePreference(change: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  const next = preferenceChain.then(() => post("/api/preferences", change));
  preferenceChain = next.catch(() => {});
  return next;
}


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
          : [{ kind: "action" as const, label: "No hidden boxes", disabled: true, onSelect: () => {} }]),
        { kind: "separator" },
        { kind: "action", label: "Reset layout", onSelect: () => board.reset() },
      ],
    },
  ];
}


let announcer: ((text: string) => void) | null = null;
function announce(text: string) {
  announcer?.(text);
}


function refocus(id: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-box="${id}"] .box-more .menu-trigger`)?.focus({ preventScroll: true })),
  );
}




const BOX_ICONS: Record<string, Icon> = {
  tasks: TasksIcon,
  calendar: CalendarIcon,
  mail: MailIcon,
  no_date: NoDateIcon,
  notes: NoteIcon,
  activity: ActivityIcon,
};

export type BoxSpec = {
  id: string;
  
  title: string;
  
  purpose: ReactNode;
  
  count?: ReactNode;
  
  surface?: "rest";
  
  action?: ReactNode;
  
  unfold?: ReactNode;
  
  menu?: MenuEntry[];
  
  busy?: boolean;
  content: ReactNode;
};

type BoxDrag = { id: string };
let boxDrag: BoxDrag | null = null;

const BOX_GRAB = { x: 32, y: 20 };



function dropLine(board: HTMLElement, drop: { before: string | null; zone: Zone }, sideways: boolean): { x: number; y: number; w: number; h: number } | null {
  const origin = board.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(board).rowGap) || 0;
  const inset = gap / 2;
  const across = (rect: DOMRect, y: number) => ({ x: rect.left - origin.left + inset, y: y - origin.top - 1, w: Math.max(0, rect.width - gap), h: 2 });
  if (drop.before) {
    const target = board.querySelector<HTMLElement>(`[data-box="${CSS.escape(drop.before)}"]`)?.getBoundingClientRect();
    if (!target) return null;
    if (sideways) return { x: target.left - origin.left - inset - 1, y: target.top - origin.top + inset, w: 2, h: Math.max(0, target.height - gap) };
    return across(target, target.top - inset);
  }
  const zone = board.querySelector<HTMLElement>(`[data-column="${drop.zone + 1}"]`);
  const end = zone?.querySelector<HTMLElement>(":scope > .boxes-end")?.getBoundingClientRect();
  if (end && end.width > 0) return across(end, end.top + inset);
  const last = [...(zone?.querySelectorAll<HTMLElement>(":scope > [data-box]") ?? [])].at(-1)?.getBoundingClientRect();
  return last ? across(last, last.bottom + inset) : null;
}

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




const ENTRY_CAP_MS = 6000;
const BoxIdContext = createContext<string | null>(null);
const SettledContext = createContext<((id: string, settled: boolean) => void) | null>(null);



export function useBoxSettled(settled: boolean): void {
  const id = useContext(BoxIdContext);
  const report = useContext(SettledContext);
  useLayoutEffect(() => {
    if (id) report?.(id, settled);
  }, [id, settled, report]);
}



export function BoxBoard({ board, boxes, label, wide, hold = false }: { board: Board; boxes: Record<string, BoxSpec>; label: string; wide?: BoxSpec | null; hold?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const [capped, setCapped] = useState(false);
  const reported = useRef<Record<string, boolean>>({});
  const report = useCallback((id: string, value: boolean) => {
    reported.current[id] = value;
    setSettled((known) => (known[id] === value ? known : { ...known, [id]: value }));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setCapped(true), ENTRY_CAP_MS);
    return () => clearTimeout(timer);
  }, []);
  const [first, second, row] = board.columns;
  const shown = (ids: string[]) => ids.filter((id) => boxes[id] && id !== wide?.id);
  
  const lone = (shown(first).length === 0) !== (shown(second).length === 0);
  const inView = [...first, ...second, ...row, ...(wide ? [wide.id] : [])].filter((id) => boxes[id]);
  const [entered, setEntered] = useState(false);
  if (!entered && !hold && (capped || inView.every((id) => settled[id]))) setEntered(true);
  const ready = entered;
  
  
  const [atOnce, setAtOnce] = useState(false);
  useLayoutEffect(() => {
    if (inView.length > 0 && inView.every((id) => reported.current[id])) setAtOnce(true);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  
  const revealed = new Set<string>();
  if (entered) inView.forEach((id) => revealed.add(id));
  else if (!hold && (!wide || settled[wide.id])) {
    if (wide) revealed.add(wide.id);
    for (const column of [first, second]) {
      for (const id of shown(column)) {
        if (!settled[id]) break;
        revealed.add(id);
      }
    }
    if ([...shown(first), ...shown(second)].every((id) => settled[id])) shown(row).filter((id) => settled[id]).forEach((id) => revealed.add(id));
  }
  const [drop, setDrop] = useState<{ before: string | null; zone: Zone } | null>(null);
  const [said, setSaid] = useState("");
  const fine = useFinePointer();
  
  const [spread, setSpread] = useState(true);

  useEffect(() => {
    announcer = setSaid;
    return () => {
      if (announcer === setSaid) announcer = null;
    };
  }, []);

  
  
  useFlip(host, { items: "[data-box]", layout: "grid" });
  
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const columns = element.querySelector<HTMLElement>(".boxes-cols");
      if (columns) setSpread(getComputedStyle(columns).getPropertyValue("--spread").trim() === "1");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  
  
  
  const line = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mark = line.current;
    const element = host.current;
    if (!mark || !element) return;
    const at = drop ? dropLine(element, drop, ((drop.zone === 2 || lone) && spread)) : null;
    if (!at) {
      mark.removeAttribute("data-show");
      return;
    }
    
    const appearing = !mark.hasAttribute("data-show");
    if (appearing) mark.setAttribute("data-placing", "");
    Object.assign(mark.style, { translate: `${at.x}px ${at.y}px`, width: `${at.w}px`, height: `${at.h}px` });
    mark.setAttribute("data-show", "");
    if (appearing) {
      void mark.offsetWidth;
      mark.removeAttribute("data-placing");
    }
  }, [drop, lone, spread]);

  function onDragOver(event: DragEvent<HTMLElement>, zone: Zone) {
    if (!boxDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-box]");
    let before: string | null = null;
    if (target && target.dataset.box !== boxDrag.id) {
      const box = target.getBoundingClientRect();
      const ids = shown(board.columns[zone]);
      const at = ids.indexOf(target.dataset.box!);
      
      const ahead = (zone === 2 || lone) && spread ? event.clientX < box.left + box.width / 2 : event.clientY < box.top + box.height / 2;
      before = ahead ? ids[at] : (ids[at + 1] ?? null);
    } else if (target) return;
    else {
      
      const next = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-box]")].find((el) => {
        const r = el.getBoundingClientRect();
        return event.clientY < r.top || (event.clientY <= r.bottom && event.clientX < r.left);
      });
      before = next?.dataset.box ?? null;
    }
    if (before === boxDrag.id) return;
    if (drop?.before !== before || drop?.zone !== zone) setDrop({ before, zone });
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!boxDrag || !drop) return;
    event.preventDefault();
    
    landFrom(boxDrag.id, { x: event.clientX - BOX_GRAB.x, y: event.clientY - BOX_GRAB.y, w: 0, h: 0 });
    board.place(boxDrag.id, drop.before, drop.zone);
    boxDrag = null;
    setDrop(null);
  }

  const every = [...shown(first), ...shown(second), ...shown(row)];
  const renderZone = (className: string, zone: Zone) => {
    const ids = shown(board.columns[zone]);
    const before = zone === 0 ? 0 : zone === 1 ? shown(first).length : shown(first).length + shown(second).length;
    return (
      <div
        className={className}
        data-column={zone + 1}
        onDragOver={(event) => onDragOver(event, zone)}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {ids.map((id, index) => (
          <Box
            key={id}
            spec={boxes[id]}
            index={index + before}
            board={board}
            draggable={fine}
            dropBefore={drop?.before === id && drop.zone === zone}
            isFirst={every[0] === id}
            isLast={every.at(-1) === id}
            zone={zone}
            spread={spread}
            shown={revealed.has(id)}
          />
        ))}
        {}
        <div className="boxes-end" data-drop={(drop && drop.before === null && drop.zone === zone) || undefined} aria-hidden="true" />
      </div>
    );
  };

  return (
    <SettledContext.Provider value={report}>
    <div ref={host} className="boxes" data-ready={ready || undefined} data-at-once={atOnce || undefined} aria-label={label} role="region">
      {wide && (
        <div className="boxes-wide">
          <Box spec={wide} index={0} board={board} draggable={false} dropBefore={false} isFirst isLast zone={0} spread={spread} fixed shown={revealed.has(wide.id)} />
        </div>
      )}
      {}
      <div
        className="boxes-cols"
        data-lone={lone || undefined}
        onDragOver={lone ? (event) => onDragOver(event, shown(first).length > 0 ? 0 : 1) : undefined}
        onDragLeave={lone ? onDragLeave : undefined}
        onDrop={lone ? onDrop : undefined}
      >
        {renderZone("boxes-col", 0)}
        {renderZone("boxes-col", 1)}
      </div>
      {renderZone("boxes-foot", 2)}
      <div ref={line} className="boxes-drop" aria-hidden="true" />
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
  zone,
  spread,
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
  zone: Zone;
  
  spread: boolean;
  
  fixed?: boolean;
  
  shown: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const titleId = `box-${spec.id}-title`;
  const moves: MenuEntry[] = fixed
    ? []
    : [
        { kind: "action", label: "Move up", disabled: isFirst, detail: isFirst ? "Already first" : undefined, onSelect: () => board.step(spec.id, -1, spec.title, spread) },
        { kind: "action", label: "Move down", disabled: isLast, detail: isLast ? "Last already" : undefined, onSelect: () => board.step(spec.id, 1, spec.title, spread) },
        spread
          ? { kind: "action", label: MOVE_ON[zone], onSelect: () => board.moveOn(spec.id, spec.title, spread) }
          : { kind: "action", label: "Move to the end", disabled: isLast, detail: isLast ? "Last already" : undefined, onSelect: () => board.moveOn(spec.id, spec.title, spread) },
        { kind: "separator" },
      ];
  const entries: MenuEntry[] = [...(spec.menu?.length ? [...spec.menu, { kind: "separator" } as const] : []), ...moves, { kind: "action", label: "Hide box", onSelect: () => board.hide(spec.id, spec.title) }];

  return (
    <section
      className="box"
      data-box={spec.id}
      data-surface={spec.surface}
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
          if ((event.target as HTMLElement).closest(".box-more, .box-action")) return event.preventDefault();
          boxDrag = { id: spec.id };
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", spec.title);
          const box = (event.currentTarget as HTMLElement).closest<HTMLElement>(".box");
          
          
          box?.setAttribute("data-lifted", "");
          if (box) event.dataTransfer.setDragImage(box, BOX_GRAB.x, BOX_GRAB.y);
          requestAnimationFrame(() => {
            box?.removeAttribute("data-lifted");
            box?.setAttribute("data-dragging", "");
          });
        }}
        onDragEnd={(event) => {
          boxDrag = null;
          (event.currentTarget as HTMLElement).closest(".box")?.removeAttribute("data-dragging");
        }}
      >
        <span className="box-icon" aria-hidden="true">
          {(() => {
            const Glyph = BOX_ICONS[spec.id] ?? TasksIcon;
            return <Glyph />;
          })()}
          {draggable && !fixed && <GripIcon className="box-grip" />}
        </span>
        <h2 id={titleId} className="t-title box-title" tabIndex={-1}>
          {spec.title}
        </h2>
        {spec.count !== undefined && spec.count !== null && (
          <span className="pill box-count">{typeof spec.count === "string" || typeof spec.count === "number" ? <Tick value={spec.count} /> : spec.count}</span>
        )}
        <div className="box-tools">
          <div className="box-more">
            <Menu label="More" about={`for ${spec.title}`} entries={entries} onOpenChange={setMenuOpen} />
          </div>
          {spec.action && <div className="box-action">{spec.action}</div>}
        </div>
      </header>
      <p className="box-purpose">{spec.purpose}</p>
      {spec.unfold}
      <div className="box-body">
        <BoxIdContext.Provider value={spec.id}>{spec.content}</BoxIdContext.Provider>
      </div>
    </section>
  );
}







export type WaitShape = "tasks" | "mail" | "week" | "events" | "notes" | "activity" | "lines";


const TITLE_WIDTHS = [72, 52, 64, 44, 58];
const META_WIDTHS = [40, 28, 46, 32, 36];

function WaitRows({ rows, shape, from = 0 }: { rows: number; shape: WaitShape; from?: number }) {
  
  const marked = shape !== "lines" && shape !== "notes";
  return Array.from({ length: rows }, (_, at) => {
    const index = at + from;
    return (
      <span key={index} className="wait-row" aria-hidden="true">
        {marked && <span className="skeleton wait-mark" />}
        <span className="wait-lines">
          <span className="skeleton wait-title" style={{ width: `${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}%` }} />
          {shape === "mail" && <span className="skeleton wait-title" style={{ width: `${TITLE_WIDTHS[(index + 2) % TITLE_WIDTHS.length] + 18}%` }} />}
          {shape !== "lines" && <span className="skeleton wait-meta" style={{ width: `${META_WIDTHS[index % META_WIDTHS.length]}%` }} />}
        </span>
      </span>
    );
  });
}

export function BoxWait({ what, rows = 3, shape = "lines" }: { what: string; rows?: number; shape?: WaitShape }) {
  
  const groups = shape === "tasks" && rows >= 4 ? Math.ceil(rows / 2) : 0;
  return (
    <div className="box-wait" data-shape={shape} role="status" aria-busy="true">
      <span className="sr-only">{what}</span>
      {shape === "week" && (
        <>
          <span className="wait-week" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} className="skeleton wait-day" />
            ))}
          </span>
          <span className="skeleton wait-heading" aria-hidden="true" />
        </>
      )}
      {groups > 0 ? (
        Array.from({ length: groups }, (_, group) => (
          <span key={group} className="wait-group" aria-hidden="true">
            <span className="skeleton wait-heading" />
            <WaitRows rows={Math.min(2, rows - group * 2)} shape={shape} from={group * 2} />
          </span>
        ))
      ) : (
        <WaitRows rows={rows} shape={shape === "week" ? "events" : shape} />
      )}
    </div>
  );
}



export function GroupsWait({ what, layout }: { what: string; layout: "list" | "board" }) {
  const group = (key: string, rows: number, days = 0) => (
    <section key={key} className="group" data-group={key} aria-hidden="true">
      <div className="group-head">
        <span className="skeleton wait-heading" />
      </div>
      {days > 0
        ? Array.from({ length: days }, (_, day) => (
            <div key={day} className="group-day">
              <span className="skeleton wait-day-heading" />
              <span className="wait-rows">
                <WaitRows rows={rows} shape="tasks" />
              </span>
            </div>
          ))
        : (
          <span className="wait-rows">
            <WaitRows rows={rows} shape="tasks" />
          </span>
        )}
    </section>
  );
  return (
    <div className="groups groups-wait" data-layout={layout} data-mode="page" role="status" aria-busy="true">
      <span className="sr-only">{what}</span>
      <div className="groups-zone" data-zone="now">
        {group("overdue", 2)}
        {group("today", 3)}
      </div>
      <div className="groups-zone" data-zone="ahead">
        {group("upcoming", 2, 3)}
      </div>
      <div className="groups-zone" data-zone="rest">
        {group("noDate", 3)}
      </div>
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



export function BoxFailed({ what, message, kept, onRetry }: { what: string; message: string; kept: boolean; onRetry: () => void }) {
  return (
    <div className="box-failed" role="alert" data-failed>
      <p className="inline-note" data-tone="alert">
        {kept ? `${what} could not be refreshed: ${message}. Showing the last version loaded.` : `${what} could not be loaded: ${message}.`}
      </p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}





export type BoxRead<T> = { data: T | null; error: string | null; stale: boolean; settled: boolean; retry: () => void };



type Held<T> = { key: string; value: T; partial?: boolean; freshIn?: number };

const heldFrom = <T,>(key: string, hit: Kept<T> | null, version: number): Held<T> | null =>
  hit ? { key, value: hit.value, freshIn: isFresh(hit) ? version : undefined } : null;




export function useBoxRead<T>(
  read: ((publish: (partial: T) => void) => Promise<{ ok: true } & T | { ok: false; message: string }>) | null,
  key: string,
  kept?: () => Kept<T> | null,
): BoxRead<T> {
  const { version } = useWorkspace();
  const look = (): Kept<T> | null => (read === null ? null : kept ? kept() : peek<T>(`box:${key}`));
  const [state, setState] = useState<Held<T> | null>(() => heldFrom(key, look(), version));
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [round, setRound] = useState(0);
  const [lookedFor, setLookedFor] = useState(key);
  if (lookedFor !== key) {
    setLookedFor(key);
    const hit = heldFrom(key, look(), version);
    if (hit) setState(hit);
  }
  const reader = useRef(read);
  const held = useRef(state);
  useEffect(() => {
    reader.current = read;
    held.current = state;
  });
  useEffect(() => {
    const run = reader.current;
    if (!run) return;
    
    if (round === 0 && held.current?.key === key && held.current.freshIn === version) return;
    let live = true;
    const asked = stamp();
    
    const publish = (partial: T) => {
      if (live) setState((now) => (now?.key === key && !now.partial ? now : { key, value: partial, partial: true }));
    };
    
    const behind = held.current !== null;
    if (behind) refreshStarted();
    void run(publish)
      .then((answer) => {
        if (answer.ok && !kept) keep(`box:${key}`, answer, asked);
        if (!live) return;
        if (answer.ok) {
          setState({ key, value: answer as unknown as T });
          setError(null);
        } else setError({ key, message: answer.message });
      })
      .finally(() => {
        if (behind) refreshEnded();
      });
    return () => {
      live = false;
    };
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


export function useToolRead<T>(name: string, input: Record<string, unknown> | null): BoxRead<T> {
  const key = input ? `${name}:${JSON.stringify(input)}` : `${name}:off`;
  return useBoxRead<T>(input ? () => tool<T>(name, input) : null, key, () => (input ? (peekTool<T>(name, input) as Kept<T> | null) : null));
}
