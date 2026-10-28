"use client";

// The screens' calls to their own server. Every answer is `{ ok, ... }`; a failure keeps its message so the screen
// can say what went wrong, and a lost session sends the person back to sign in.

export type Failure = { ok: false; code?: string; message: string; candidates?: Array<{ id: string; path: string }> };
export type Answer<T> = ({ ok: true } & T) | Failure;

const TIMEOUT_MS = 20_000;

async function send<T>(url: string, init: RequestInit): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timeout ? "The server did not answer in time." : "No connection to the server." };
  }
  if (response.status === 401) {
    // A full load, not a client navigation: the landing page reads the session again from scratch.
    window.location.assign(new URL("/", window.location.origin));
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  try {
    return (await response.json()) as Answer<T>;
  } catch {
    return { ok: false, message: `The server answered ${response.status} without data.` };
  }
}

export function get<T>(url: string): Promise<Answer<T>> {
  return send<T>(url, { method: "GET" });
}

export function post<T>(url: string, body: unknown, method = "POST"): Promise<Answer<T>> {
  return send<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function tool<T>(name: string, input: Record<string, unknown>): Promise<Answer<T>> {
  return post<T>(`/api/tools/${name}`, input);
}

export type Item = {
  id: string;
  nodeId: string;
  nodePath: string;
  // The task it hangs from, or null when it hangs from the node.
  parentId: string | null;
  type: "task" | "note" | "decision" | "link" | "review";
  title: string;
  body: string | null;
  url: string | null;
  status: "open" | "done";
  priority: number | null;
  dueOn: string | null;
  source: "manual" | "chat" | "agent";
  agentLabel: string | null;
  // Who made the last change, and when it was completed.
  changedSource?: "manual" | "chat" | "agent";
  changedAgentLabel?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  // A task with subtasks, as a browse reads it: how many of them are open and done.
  subtasks?: { open: number; done: number };
};

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: "client" | "project" | "subproject";
  name: string;
  path: string;
  openTasks: number;
  openReviews: number;
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
  // Where it comes from: a connected Google account, or the workspace's own calendar.
  origin?: "google" | "local";
  localId?: string | null;
  nodeId?: string | null;
};

export type EventsFailure = { accountId: string; accountEmail: string; reason: string };

// The board's figures, in total and per node (each node counting its subtree), from `get_board`.
export type BoardFigures = { open: number; late: number; dueToday: number; dueInRange: number; undated: number; toReview: number };
export type Board = { scope: { id: string | null; path: string }; figures: BoardFigures; nodes: Array<BoardFigures & { id: string }> };
