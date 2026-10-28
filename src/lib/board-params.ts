// The Overview's filters in the address: the general one (scope) and each section's own. A saved view keeps exactly these,
// and a view reads as the one on screen by these alone, in one order, whatever else the address carries.
export const BOARD_PARAMS = ["scope", "tasks", "status", "priority", "agenda", "review", "who", "what", "kind"] as const;

export function boardQuery(query: string): string {
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(query)) {
    if ((BOARD_PARAMS as readonly string[]).includes(key) && value) kept.set(key, value);
  }
  kept.sort();
  return kept.toString();
}
