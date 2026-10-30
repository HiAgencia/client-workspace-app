"use client";

import { Select } from "@/components/ui/select";
import type { TreeNode } from "./client-api";
import { count } from "./count";






export const ALL = "all";
export const GENERAL = "general";


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


export function lineOf(tree: TreeNode[] | null, nodeId: string): Set<string> {
  const byId = new Map((tree ?? []).map((node) => [node.id, node]));
  const line = new Set<string>();
  for (let node = byId.get(nodeId); node && !line.has(node.id); node = node.parentId ? byId.get(node.parentId) : undefined) line.add(node.id);
  return line;
}


export function placeFromUrl(value: string | null, tree: TreeNode[] | null): string {
  if (!value || value === ALL) return ALL;
  if (value === GENERAL) return GENERAL;
  if (!tree) return value;
  return tree.some((node) => node.id === value) ? value : ALL;
}




export type FilterUnit = { one: string; many: string };
export const TASKS: FilterUnit = { one: "task", many: "tasks" };
export const MESSAGES: FilterUnit = { one: "message", many: "messages" };
export const ITEMS: FilterUnit = { one: "item", many: "items" };
export const EVENTS: FilterUnit = { one: "event", many: "events" };

export const withCount = (label: string, n: number, unit: FilterUnit) => `${label} (${count(n, unit.one, unit.many)})`;

export function PlaceFilter({
  value,
  tree,
  counts,
  unit,
  onChange,
  noGeneral = false,
  shows,
}: {
  value: string;
  tree: TreeNode[] | null;
  
  counts: Map<string, number>;
  
  unit: FilterUnit;
  onChange: (value: string) => void;
  
  noGeneral?: boolean;
  
  
  shows?: Set<string>;
}) {
  const options = [
    { value: ALL, label: withCount("All places", counts.get(ALL) ?? 0, unit) },
    ...(!noGeneral && ((counts.get(GENERAL) ?? 0) > 0 || shows?.has(GENERAL) || value === GENERAL) ? [{ value: GENERAL, label: withCount("General", counts.get(GENERAL) ?? 0, unit) }] : []),
    ...(tree ?? [])
      .filter((node) => (counts.get(node.id) ?? 0) > 0 || shows?.has(node.id) || node.id === value)
      .map((node) => ({ value: node.id, label: withCount(node.path, counts.get(node.id) ?? 0, unit) })),
  ];
  return <Select label="Place" value={value} options={options} onChange={onChange} />;
}

export function AccountFilter({
  value,
  accounts,
  counts,
  unit,
  onChange,
}: {
  value: string;
  accounts: Array<{ id: string; email: string }>;
  counts: Map<string, number>;
  unit: FilterUnit;
  onChange: (value: string) => void;
}) {
  const offered = accounts.filter((account) => (counts.get(account.id) ?? 0) > 0 || account.id === value);
  
  if (offered.length === 0) return null;
  const options = [
    { value: ALL, label: withCount("All accounts", counts.get(ALL) ?? 0, unit) },
    ...offered.map((account) => ({ value: account.id, label: withCount(account.email, counts.get(account.id) ?? 0, unit) })),
  ];
  return <Select label="Account" value={value} options={options} onChange={onChange} />;
}
