import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { readSession, requireUser } from "./server";

const PROJECT_URL = "https://project.example.test";
const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "person@example.test",
  is_anonymous: false,
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function sessionCookie() {
  const session = {
    access_token: "header.payload.signature",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh-token",
    user: USER,
  };
  return { name: "sb-project-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` };
}

type Answer = number | "no answer" | { status: number; code: string };



function clientAgainst(answers: Answer[], cookies = [sessionCookie()]) {
  const calls: string[] = [];
  const fetchFake = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer === "no answer") throw new TypeError("fetch failed");
    if (answer === 200) return Response.json(USER);
    if (typeof answer === "object") {
      return Response.json({ code: answer.status, error_code: answer.code, msg: answer.code }, { status: answer.status });
    }
    return new Response(`<html><title>${answer}</title></html>`, { status: answer, headers: { "Content-Type": "text/html" } });
  };
  const db = createServerClient<Database>(PROJECT_URL, "public-key", {
    cookies: { getAll: () => cookies, setAll: () => {} },
    global: { fetch: fetchFake },
  }) as Db;
  return { db, calls };
}

describe("reading the session", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks again after a passing failure of the auth server, and the person stays signed in", async () => {
    const { db, calls } = clientAgainst([502, 200]);
    await expect(readSession(db)).resolves.toEqual({
      kind: "user",
      user: { id: USER.id, email: USER.email, isAnonymous: false },
    });
    expect(calls).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith("auth: reading the user failed", 502, "AuthRetryableFetchError");
  });

  it.each<[string, Answer]>([
    ["a 502", 502],
    ["a 503", 503],
    ["a 500", { status: 500, code: "unexpected_failure" }],
    ["a rate limit", { status: 429, code: "over_request_rate_limit" }],
    ["no answer at all", "no answer"],
  ])("does not read %s that never goes away as a signed-out person", async (_name, answer) => {
    const { db, calls } = clientAgainst([answer]);
    await expect(readSession(db)).resolves.toEqual({ kind: "unavailable" });
    expect(calls.length).toBeGreaterThan(1);
  });

  it.each<[string, Answer]>([
    ["a token it refuses", { status: 403, code: "bad_jwt" }],
    ["a session that no longer exists", { status: 403, code: "session_not_found" }],
    ["a user that no longer exists", { status: 403, code: "user_not_found" }],
  ])("reads %s as no session, without asking again", async (_name, answer) => {
    const { db, calls } = clientAgainst([answer]);
    await expect(readSession(db)).resolves.toEqual({ kind: "none" });
    expect(calls).toHaveLength(1);
  });

  it("without a session cookie it asks the auth server nothing", async () => {
    const { db, calls } = clientAgainst([200], []);
    await expect(readSession(db)).resolves.toEqual({ kind: "none" });
    expect(calls).toHaveLength(0);
  });
});

describe("the door of a route", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 503 when the auth server does not answer, so the screen keeps the person where they are", async () => {
    const { db } = clientAgainst([502]);
    const door = await requireUser(db);
    if (door.ok) throw new Error("the door let someone in without a session reading");
    expect(door.response.status).toBe(503);
    await expect(door.response.json()).resolves.toEqual({ ok: false, message: "The session could not be checked. Try again." });
  });

  it("answers 401 without a session, which is what sends the screen back to sign in", async () => {
    const { db } = clientAgainst([200], []);
    const door = await requireUser(db);
    if (door.ok) throw new Error("the door let someone in without a session");
    expect(door.response.status).toBe(401);
  });

  it("hands over the person with a session", async () => {
    const { db } = clientAgainst([200]);
    const door = await requireUser(db);
    expect(door.ok && door.user.id).toBe(USER.id);
  });
});
