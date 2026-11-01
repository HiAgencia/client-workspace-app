"use client";

import { READ_TOOLS } from "@/lib/tools/read-tools";




export type Failure = { ok: false; code?: string; message: string; candidates?: Array<{ id: string; path: string }> };
export type Answer<T> = ({ ok: true } & T) | Failure;

const TIMEOUT_MS = 20_000;
const SECOND_READ_PAUSE_MS = 400;

async function ask(url: string, init: RequestInit): Promise<Response | Failure> {
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timeout ? "The server did not answer in time." : "No connection to the server." };
  }
}


function wasCut(response: Response | Failure): boolean {
  return response instanceof Response && response.status >= 500 && !response.headers.get("content-type")?.includes("application/json");
}



export async function askOnceMoreIfCut(url: string, init: RequestInit): Promise<Response | Failure> {
  const first = await ask(url, init);
  if (!wasCut(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, SECOND_READ_PAUSE_MS));
  return ask(url, init);
}


async function send<T>(url: string, init: RequestInit, kind: "read" | "write"): Promise<Answer<T>> {
  const response = kind === "read" ? await askOnceMoreIfCut(url, init) : await ask(url, init);
  if (!(response instanceof Response)) return response;
  if (response.status === 401) {
    
    window.location.assign(new URL("/", window.location.origin));
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  try {
    return (await response.json()) as Answer<T>;
  } catch {
    return { ok: false, message: "The server could not answer. Try again." };
  }
}

export function get<T>(url: string): Promise<Answer<T>> {
  return send<T>(url, { method: "GET" }, "read");
}

function postAs<T>(kind: "read" | "write", url: string, body: unknown, method = "POST"): Promise<Answer<T>> {
  return send<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, kind);
}

export function post<T>(url: string, body: unknown, method = "POST"): Promise<Answer<T>> {
  readsOnTheirWay.clear();
  return postAs<T>("write", url, body, method);
}



export async function forgetLayout(): Promise<void> {
  const answer = await send<Record<string, never>>("/api/preferences", { method: "DELETE" }, "write");
  if (!answer.ok) console.error("The saved order of the boxes could not be forgotten on signing out:", answer.message);
}



const readsOnTheirWay = new Map<string, Promise<Answer<unknown>>>();


export function tool<T>(name: string, input: Record<string, unknown>, scope?: string | null): Promise<Answer<T>> {
  const url = scope ? `/api/tools/${name}?scope=${scope}` : `/api/tools/${name}`;
  if (!READ_TOOLS.has(name)) {
    readsOnTheirWay.clear();
    return postAs<T>("write", url, input);
  }
  const key = `${url} ${JSON.stringify(input)}`;
  const onItsWay = readsOnTheirWay.get(key);
  if (onItsWay) return onItsWay as Promise<Answer<T>>;
  const read = postAs<T>("read", url, input).finally(() => {
    if (readsOnTheirWay.get(key) === read) readsOnTheirWay.delete(key);
  });
  readsOnTheirWay.set(key, read);
  return read;
}

export type Item = {
  id: string;
  
  nodeId: string | null;
  nodePath: string | null;
  
  parentId: string | null;
  type: "task" | "note" | "decision";
  title: string;
  body: string | null;
  status: "open" | "done";
  priority: number | null;
  dueOn: string | null;
  dueTime?: string | null;
  position?: number;
  source: "manual" | "chat" | "agent" | "review";
  agentLabel: string | null;
  
  changedSource?: "manual" | "chat" | "agent" | "review";
  changedAgentLabel?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  
  subtasks?: { open: number; done: number };
};

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: "client" | "project" | "subproject";
  name: string;
  path: string;
  openTasks: number;
  
  color: string | null;
  ownColor: string | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
  accountEmail: string;
  accountId: string;
  fromNodeId: string;
  link: string | null;
  
  origin?: "google" | "local";
  localId?: string | null;
  nodeId?: string | null;
};

export type EventsFailure = { accountId: string; accountEmail: string; reason: string };
