import { documentCookies, sessionOwner } from "@/lib/supabase/session-owner";




const KEY = "client-workspace:last-node";

const owner = () => sessionOwner(documentCookies());

export function rememberLastNode(nodeId: string): void {
  localStorage.setItem(KEY, JSON.stringify({ node: nodeId, owner: owner() }));
}

export function lastNode(): string | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as { node?: unknown; owner?: unknown } | null;
    return kept && typeof kept.node === "string" && kept.owner === owner() ? kept.node : null;
  } catch {
    
    return null;
  }
}

export function forgetLastNode(): void {
  localStorage.removeItem(KEY);
}
