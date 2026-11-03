import { withInitialCapital } from "@/lib/initial-capital";







export const NAME_MAX = 80;

export type SessionPerson = { name: string | null; googleName: string | null; avatarUrl: string | null };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, NAME_MAX) : null;
}


function photo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sessionPerson(metadata: Record<string, unknown> | null | undefined): SessionPerson {
  const data = metadata ?? {};
  const googleName = text(data.full_name) ?? text(data.name);
  return { name: text(data.display_name) ?? googleName, googleName, avatarUrl: photo(data.avatar_url) ?? photo(data.picture) };
}



export function nameToStore(typed: string, googleName: string | null): string | null {
  const tidy = typed.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!tidy) return null;
  const named = withInitialCapital(tidy);
  return named === googleName ? null : named;
}


export function firstName(name: string | null): string | null {
  return name?.split(" ")[0] || null;
}


export function initialOf(name: string | null, email: string | null): string {
  const source = name ?? email ?? "";
  return Array.from(source.trim())[0]?.toUpperCase() ?? "";
}
