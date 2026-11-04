export const SPLIT = "split";
export const FOOT = "foot";

export type BoardLayout = { order: string[]; hidden: string[] };

export type Zone = 0 | 1 | 2;

export const isMark = (id: string) => id === SPLIT || id === FOOT;

function endOf(order: string[], zone: Zone): number {
  return zone === 0 ? order.indexOf(SPLIT) : zone === 1 ? order.indexOf(FOOT) : order.length;
}

function zoneIn(order: string[], id: string): Zone {
  const at = order.indexOf(id);
  return at < order.indexOf(SPLIT) ? 0 : at < order.indexOf(FOOT) ? 1 : 2;
}

export function settleLayout(saved: BoardLayout | null, defaults: string[]): BoardLayout {
  if (!saved) return { order: defaults, hidden: [] };
  const known = new Set(defaults);
  const order = saved.order.filter((id, index, all) => known.has(id) && all.indexOf(id) === index);
  if (!order.includes(SPLIT)) order.push(SPLIT);
  if (order.includes(FOOT) && order.indexOf(FOOT) < order.indexOf(SPLIT)) order.splice(order.indexOf(FOOT), 1);
  if (!order.includes(FOOT)) order.push(FOOT);
  for (const id of defaults) {
    if (!order.includes(id)) order.splice(endOf(order, zoneIn(defaults, id)), 0, id);
  }
  return { order, hidden: saved.hidden.filter((id) => known.has(id) && !isMark(id)) };
}

export function columnsOf(layout: BoardLayout): [string[], string[], string[]] {
  const split = layout.order.indexOf(SPLIT);
  const foot = layout.order.indexOf(FOOT);
  return [layout.order.slice(0, split), layout.order.slice(split + 1, foot), layout.order.slice(foot + 1)];
}

export function steppedOrder(order: string[], inView: string[], id: string, by: -1 | 1, apart: boolean): string[] | null {
  const steps = apart ? inView : inView.filter((entry) => !isMark(entry));
  const target = steps[steps.indexOf(id) + by];
  if (target === undefined) return null;
  const next = [...order];
  const to = next.indexOf(target);
  next.splice(next.indexOf(id), 1);
  next.splice(to, 0, id);
  return next;
}

export function orderMovedTo(order: string[], id: string, zone: Zone): string[] {
  const next = order.filter((entry) => entry !== id);
  next.splice(endOf(next, zone), 0, id);
  return next;
}

export function orderDropped(order: string[], id: string, before: string | null, zone: Zone): string[] {
  if (!before) return orderMovedTo(order, id, zone);
  const next = order.filter((entry) => entry !== id);
  next.splice(next.indexOf(before), 0, id);
  return next;
}
