"use client";

import type { ReactNode } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { AccountIcon, PlaceIcon, type Icon } from "@/components/ui/icons";
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
    option(ALL, "All clients and projects"),
    ...(!noGeneral && (brings(GENERAL) > 0 || shows?.has(GENERAL) || value === GENERAL) ? [option(GENERAL, "General")] : []),
    ...(tree ?? []).filter((node) => brings(node.id) > 0 || shows?.has(node.id) || node.id === value).map((node) => option(node.id, node.path)),
  ];
}




function NamedFilter({ name, icon: Glyph, children }: { name: string; icon: Icon; children: ReactNode }) {
  return (
    <div className="named filter">
      <span className="t-label named-label" aria-hidden="true">
        <Glyph className="filter-icon" />
        <span className="filter-name">{name}</span>
      </span>
      {children}
    </div>
  );
}

export function PlaceFilter({ onChange, ...read }: PlaceOptions & { onChange: (value: string) => void }) {
  return (
    <NamedFilter name="Client or project" icon={PlaceIcon}>
      <Select label="Client or project" value={read.value} options={placeOptions(read)} onChange={onChange} />
    </NamedFilter>
  );
}




export type FilterAccount = { id: string; email: string; nodeIds: string[] };


export const ACCOUNTS_OF = "of:";


function clientOf(byId: Map<string, TreeNode>, nodeId: string): { client: TreeNode; depth: number } | null {
  let node = byId.get(nodeId);
  let depth = 0;
  for (const seen = new Set<string>(); node?.parentId && !seen.has(node.id); node = byId.get(node.parentId), depth += 1) seen.add(node.id);
  return node ? { client: node, depth } : null;
}




export function accountGroups<A extends FilterAccount>(accounts: A[], tree: TreeNode[] | null): Array<{ client: TreeNode | null; accounts: A[] }> {
  const byId = new Map((tree ?? []).map((node) => [node.id, node]));
  
  const tops = (tree ?? []).filter((node) => node.parentId === null);
  const order = new Map([...tops.filter((node) => node.kind === "client"), ...tops.filter((node) => node.kind !== "client")].map((node, index) => [node.id, index]));
  const rank = (client: TreeNode | null) => (client ? (order.get(client.id) ?? order.size) : order.size + 1);
  const groups = new Map<string, { client: TreeNode | null; accounts: A[] }>();
  for (const account of accounts) {
    const under = account.nodeIds.map((id) => clientOf(byId, id)).filter((entry) => entry !== null);
    const client = under.sort((a, b) => a.depth - b.depth || rank(a.client) - rank(b.client))[0]?.client ?? null;
    const key = client?.id ?? "";
    if (!groups.has(key)) groups.set(key, { client, accounts: [] });
    groups.get(key)!.accounts.push(account);
  }
  return [...groups.values()].sort((a, b) => rank(a.client) - rank(b.client));
}



export function chosenAccounts(value: string | null, accounts: FilterAccount[], tree: TreeNode[] | null): Set<string> | null {
  if (!value || value === ALL) return null;
  if (!value.startsWith(ACCOUNTS_OF)) return new Set([value]);
  const branch = branchOf(tree, value.slice(ACCOUNTS_OF.length));
  return new Set(accounts.filter((account) => account.nodeIds.some((id) => branch.has(id))).map((account) => account.id));
}



export function accountFromUrl(value: string | null, accounts: FilterAccount[], tree: TreeNode[] | null): string {
  if (!value || value === ALL) return ALL;
  if (!value.startsWith(ACCOUNTS_OF)) return accounts.some((account) => account.id === value) ? value : ALL;
  const client = value.slice(ACCOUNTS_OF.length);
  return (tree ?? []).some((node) => node.id === client && node.parentId === null) && (chosenAccounts(value, accounts, tree)?.size ?? 0) > 0 ? value : ALL;
}


export function countsByAccount(accounts: FilterAccount[], tree: TreeNode[] | null, brings: (chosen: Set<string> | null) => number): Map<string, number> {
  const counts = new Map<string, number>([[ALL, brings(null)]]);
  for (const { client } of accountGroups(accounts, tree)) {
    if (client) counts.set(ACCOUNTS_OF + client.id, brings(chosenAccounts(ACCOUNTS_OF + client.id, accounts, tree)));
  }
  for (const account of accounts) counts.set(account.id, brings(new Set([account.id])));
  return counts;
}

type AccountOptions = {
  value: string;
  accounts: FilterAccount[];
  tree: TreeNode[] | null;
  
  counts: Map<string, number> | null;
  unit: FilterUnit;
};





export function accountOptions({ value, accounts, tree, counts, unit }: AccountOptions): SelectOption[] {
  if (accounts.length === 0) return [];
  const said = (key: string) => (counts ? { detail: whatItBrings(counts.get(key) ?? 0, unit), empty: (counts.get(key) ?? 0) === 0 } : {});
  const groups = accountGroups(accounts, tree);
  const apart = groups.length > 1;
  return [
    { value: ALL, label: "All accounts", ...said(ALL) },
    ...groups.flatMap(({ client, accounts: own }) => {
      const group = apart ? { key: client?.id ?? "nowhere", label: client?.name ?? "No client or project", color: client?.color } : undefined;
      const together = client ? ACCOUNTS_OF + client.id : null;
      const offerTogether = together !== null && apart && ((chosenAccounts(together, accounts, tree)?.size ?? 0) > 1 || value === together);
      return [
        ...(offerTogether ? [{ value: together, label: `All ${client!.name} accounts`, group, ...said(together) }] : []),
        ...own.map((account) => ({ value: account.id, label: account.email, mark: GoogleMark, group, ...said(account.id) })),
      ];
    }),
  ];
}




export function AccountFilter({ onChange, pending, known, ...read }: AccountOptions & { onChange: (value: string) => void; pending?: boolean; known?: FilterAccount[] | null }) {
  const options = pending ? waitingOptions(read.value, known ?? []) : accountOptions(read);
  if (options.length === 0) return null;
  return (
    <NamedFilter name="Account" icon={AccountIcon}>
      <Select label="Account" value={read.value} options={options} onChange={onChange} />
    </NamedFilter>
  );
}

function waitingOptions(value: string, known: FilterAccount[]): SelectOption[] {
  const all = { value: ALL, label: "All accounts" };
  if (value === ALL) return [all];
  const chosen = known.find((account) => account.id === value);
  return [all, chosen ? { value, label: chosen.email, mark: GoogleMark } : { value, label: "One account" }];
}
