export type Span = { start: number; end: number; above?: boolean };

export type Placed<T> = {
  item: T;
  inset: number;
  layer: number;
  textAt: number;
  room: number;
  clip: number;
};

export const KEEP = 0.64;
export const STEP = 0.25;

export function cascade<T extends Span>(items: T[], line: number): Array<Placed<T>> {
  const order = [...items].sort((a, b) => a.start - b.start || b.end - a.end || Number(Boolean(a.above)) - Number(Boolean(b.above)));
  const depths: number[] = [];
  const runs: number[][] = [];
  let runEnd = -Infinity;
  order.forEach((item, index) => {
    if (item.start >= runEnd) {
      runs.push([]);
      runEnd = item.end;
    } else runEnd = Math.max(runEnd, item.end);
    runs.at(-1)!.push(index);
    let deepest = -1;
    for (let before = 0; before < index; before++) if (order[before].end > item.start) deepest = Math.max(deepest, depths[before]);
    depths.push(deepest + 1);
  });
  const insets: number[] = [];
  for (const run of runs) {
    const deepest = Math.max(...run.map((index) => depths[index]));
    const step = deepest === 0 ? 0 : Math.min(STEP, (1 - KEEP) / deepest);
    for (const index of run) insets[index] = depths[index] * step;
  }
  const drawn = order.map((_, index) => index).sort((a, b) => Number(Boolean(order[a].above)) - Number(Boolean(order[b].above)) || a - b);
  const layers: number[] = [];
  drawn.forEach((index, layer) => (layers[index] = layer));

  return order.map((item, index) => {
    const over = order
      .map((other, at) => ({ other, at }))
      .filter(({ other, at }) => layers[at] > layers[index] && other.start < item.end && other.end > item.start);
    const stretches = over.map(({ other }) => [Math.max(other.start, item.start), Math.min(other.end, item.end)] as const).sort((a, b) => a[0] - b[0]);
    let from = item.start;
    let until = item.end;
    for (const [start, end] of stretches) {
      if (start - from >= line) {
        until = start;
        break;
      }
      from = Math.max(from, end);
    }
    const free = until - from >= line;
    const strip = over.filter(({ other, at }) => other.start < item.start + line && insets[at] > insets[index]).map(({ at }) => insets[at]);
    return {
      item,
      inset: insets[index],
      layer: layers[index],
      textAt: free ? from - item.start : 0,
      room: free ? until - from : item.end - item.start,
      clip: free || strip.length === 0 ? 1 : Math.min(...strip),
    };
  });
}
