import { useCallback, useState, type FocusEvent, type KeyboardEvent } from "react";

// The calendar's grids are walked as the ARIA grid pattern asks: one stop in the page's tab order, the arrows move between
// cells, Home and End go to the row's ends, Ctrl+Home and Ctrl+End to the grid's, and Page Up and Page Down by a few rows.
// Each cell that takes focus carries `data-grid-row` and `data-grid-col`; only the cell last reached is in the tab order.

export type GridSpot = { row: number; col: number };

// Where a key leads from a cell, inside a grid of `rows` by `cols`; null for a key that does not move.
export function gridMove(key: string, from: GridSpot, size: { rows: number; cols: number }, ctrl = false, page = 4): GridSpot | null {
  const clamp = (spot: GridSpot): GridSpot => ({ row: Math.max(0, Math.min(size.rows - 1, spot.row)), col: Math.max(0, Math.min(size.cols - 1, spot.col)) });
  switch (key) {
    case "ArrowRight":
      return clamp({ ...from, col: from.col + 1 });
    case "ArrowLeft":
      return clamp({ ...from, col: from.col - 1 });
    case "ArrowDown":
      return clamp({ ...from, row: from.row + 1 });
    case "ArrowUp":
      return clamp({ ...from, row: from.row - 1 });
    case "Home":
      return ctrl ? { row: 0, col: 0 } : { ...from, col: 0 };
    case "End":
      return ctrl ? clamp({ row: size.rows - 1, col: size.cols - 1 }) : clamp({ ...from, col: size.cols - 1 });
    case "PageDown":
      return clamp({ ...from, row: from.row + page });
    case "PageUp":
      return clamp({ ...from, row: from.row - page });
    default:
      return null;
  }
}

// Whether a key on a cell asks to act on it: Enter or Space, as a button takes them.
export const activates = (key: string) => key === "Enter" || key === " ";

const spotOf = (element: Element | null): GridSpot | null => {
  const cell = element?.closest<HTMLElement>("[data-grid-row][data-grid-col]");
  return cell ? { row: Number(cell.dataset.gridRow), col: Number(cell.dataset.gridCol) } : null;
};

// The roving tab stop of one grid: which cell is in the tab order, its props, and the grid's key handler. `initial` is the
// cell the grid is entered on until the person moves (today's, when it is shown).
export function useGridKeys(size: { rows: number; cols: number }, initial: GridSpot) {
  const [moved, setMoved] = useState<GridSpot | null>(null);
  const spot = moved && moved.row < size.rows && moved.col < size.cols ? moved : initial;
  const cell = useCallback(
    (row: number, col: number) => ({ "data-grid-row": row, "data-grid-col": col, tabIndex: row === spot.row && col === spot.col ? 0 : -1 }),
    [spot.row, spot.col],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Only a cell's own keys: a chip inside it keeps its own (a task's Alt+arrows moves it to another day).
    const target = event.target as HTMLElement;
    if (!target.matches("[data-grid-row][data-grid-col]") || event.altKey || event.shiftKey || event.metaKey) return;
    const from = spotOf(target);
    if (!from) return;
    const next = gridMove(event.key, from, size, event.ctrlKey);
    if (!next) return;
    event.preventDefault();
    setMoved(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-grid-row="${next.row}"][data-grid-col="${next.col}"]`)?.focus();
  };
  // A click on a cell makes it the grid's stop, so Tab returns where the person was.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const at = spotOf(event.target as HTMLElement);
    if (at && (event.target as HTMLElement).matches("[data-grid-row][data-grid-col]") && (at.row !== spot.row || at.col !== spot.col)) setMoved(at);
  };
  return { cell, onKeyDown, onFocus };
}
