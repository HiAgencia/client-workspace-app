"use client";

import type { ReactNode } from "react";
import { Select, type SelectOption } from "@/components/ui/select";
import { count } from "@/lib/count";
import type { TreeNode } from "./client-api";






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


export type ShownEvent = { origin: "google" | "local"; nodeId: string | null; linkedNodeIds: string[]; fromNodeId: string };




export function placesThatShow(tree: TreeNode[] | null, accounts: Array<{ nodeIds: string[] }>, notes: { nodes: string[]; general: boolean } | null, events: ShownEvent[]): Set<string> {
  const shows = new Set<string>(notes?.nodes ?? []);
  if (notes?.general) shows.add(GENERAL);
  const down = (id: string) => {
    for (const entry of branchOf(tree, id)) shows.add(entry);
  };
  const up = (id: string) => {
    for (const entry of lineOf(tree, id)) shows.add(entry);
  };
  for (const account of accounts) account.nodeIds.forEach(down);
  for (const event of events) {
    if (event.origin === "google") {
      if (event.fromNodeId) down(event.fromNodeId);
      continue;
    }
    if (event.nodeId === null && event.linkedNodeIds.length === 0) shows.add(GENERAL);
    if (event.nodeId) up(event.nodeId);
    event.linkedNodeIds.forEach(up);
  }
  return shows;
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

export const whatItBrings = (n: number, unit: FilterUnit) => count(n, unit.one, unit.many);

type PlaceOptions = {
  value: string;
  tree: TreeNode[] | null;
  
  counts: Map<string, number> | null;
  
  unit: FilterUnit;
  
  noGeneral?: boolean;
  
  
  shows?: Set<string>;
};


export function placeOptions({ value, tree, counts, unit, noGeneral = false, shows }: PlaceOptions): SelectOption[] {
  const brings = (id: string) => counts?.get(id) ?? 0;
  const option = (id: string, label: string) => ({ value: id, label, ...(counts ? { detail: whatItBrings(brings(id), unit) } : {}) });
  return [
    option(ALL, "All places"),
    ...(!noGeneral && (brings(GENERAL) > 0 || shows?.has(GENERAL) || value === GENERAL) ? [option(GENERAL, "General")] : []),
    ...(tree ?? []).filter((node) => brings(node.id) > 0 || shows?.has(node.id) || node.id === value).map((node) => option(node.id, node.path)),
  ];
}


function NamedFilter({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="named filter">
      <span className="t-label named-label" aria-hidden="true">
        {name}
      </span>
      {children}
    </div>
  );
}

export function PlaceFilter({ onChange, ...read }: PlaceOptions & { onChange: (value: string) => void }) {
  return (
    <NamedFilter name="Place">
      <Select label="Place" value={read.value} options={placeOptions(read)} onChange={onChange} />
    </NamedFilter>
  );
}

type AccountOptions = {
  value: string;
  accounts: Array<{ id: string; email: string }>;
  counts: Map<string, number>;
  unit: FilterUnit;
};

export function accountOptions({ value, accounts, counts, unit }: AccountOptions): SelectOption[] {
  const offered = accounts.filter((account) => (counts.get(account.id) ?? 0) > 0 || account.id === value);
  if (offered.length === 0) return [];
  const detail = (id: string) => whatItBrings(counts.get(id) ?? 0, unit);
  return [{ value: ALL, label: "All accounts", detail: detail(ALL) }, ...offered.map((account) => ({ value: account.id, label: account.email, detail: detail(account.id) }))];
}

export function AccountFilter({ onChange, ...read }: AccountOptions & { onChange: (value: string) => void }) {
  const options = accountOptions(read);
  
  if (options.length === 0) return null;
  return (
    <NamedFilter name="Account">
      <Select label="Account" value={read.value} options={options} onChange={onChange} />
    </NamedFilter>
  );
}
