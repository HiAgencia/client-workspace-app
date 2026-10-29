"use client";

import { Select } from "@/components/ui/select";
import type { TreeNode } from "./client-api";

// The two filters a page of the workspace's calendar and mail carries, one per axis: the place —everything, General, a
// client or a project— and the account. Each option says how much it brings, and one that would bring nothing is not
// offered; the value already set stays offered. Both live in the address (`place`, `account`), so a reload or a link
// returns to the same view.

export const ALL = "all";
export const GENERAL = "general";

// A place's whole branch: the node and every node below it.
export function branchOf(tree: TreeNode[] | null, nodeId: string): Set<string> {
  const branch = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of tree ?? []) {
      if (node.parentId && branch.has(node.parentId) && !branch.has(node.id)) {
        branch.add(node.id);
        grew = true;
      }
    }
  }
  return branch;
}

// A node and every node above it: the places whose accounts it sees.
export function lineOf(tree: TreeNode[] | null, nodeId: string): Set<string> {
  const byId = new Map((tree ?? []).map((node) => [node.id, node]));
  const line = new Set<string>();
  for (let node = byId.get(nodeId); node && !line.has(node.id); node = node.parentId ? byId.get(node.parentId) : undefined) line.add(node.id);
  return line;
}

// A place read from the address passes the list of what exists: an unknown value is dropped, not applied as nothing.
export function placeFromUrl(value: string | null, tree: TreeNode[] | null): string {
  if (!value || value === ALL) return ALL;
  if (value === GENERAL) return GENERAL;
  if (!tree) return value;
  return tree.some((node) => node.id === value) ? value : ALL;
}

const withCount = (label: string, n: number) => `${label} (${n})`;

export function PlaceFilter({
  value,
  tree,
  counts,
  onChange,
  noGeneral = false,
  shows,
}: {
  value: string;
  tree: TreeNode[] | null;
  // How much each place brings, by `all`, `general`, or a node's id.
  counts: Map<string, number>;
  onChange: (value: string) => void;
  // Where General never brings anything (no account hangs from it), it is not offered.
  noGeneral?: boolean;
  // The places that have something to show besides what they count (mail, events, notes): offered with their count,
  // also when it is zero. `general` stands for General.
  shows?: Set<string>;
}) {
  const options = [
    { value: ALL, label: withCount("All places", counts.get(ALL) ?? 0) },
    ...(!noGeneral && ((counts.get(GENERAL) ?? 0) > 0 || shows?.has(GENERAL) || value === GENERAL) ? [{ value: GENERAL, label: withCount("General", counts.get(GENERAL) ?? 0) }] : []),
    ...(tree ?? [])
      .filter((node) => (counts.get(node.id) ?? 0) > 0 || shows?.has(node.id) || node.id === value)
      .map((node) => ({ value: node.id, label: withCount(node.path, counts.get(node.id) ?? 0) })),
  ];
  return <Select label="Place" value={value} options={options} onChange={onChange} />;
}

export function AccountFilter({
  value,
  accounts,
  counts,
  onChange,
}: {
  value: string;
  accounts: Array<{ id: string; email: string }>;
  counts: Map<string, number>;
  onChange: (value: string) => void;
}) {
  const offered = accounts.filter((account) => (counts.get(account.id) ?? 0) > 0 || account.id === value);
  // With nothing to choose between, the control does not appear.
  if (offered.length === 0) return null;
  const options = [
    { value: ALL, label: withCount("All accounts", counts.get(ALL) ?? 0) },
    ...offered.map((account) => ({ value: account.id, label: withCount(account.email, counts.get(account.id) ?? 0) })),
  ];
  return <Select label="Account" value={value} options={options} onChange={onChange} />;
}
