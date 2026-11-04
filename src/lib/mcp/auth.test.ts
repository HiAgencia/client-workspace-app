import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { newAgentToken } from "@/lib/agent-token";
import { authenticateAgent } from "./auth";

function serviceAnswering(answer: { data: unknown; error: { message: string } | null }): Db {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => answer };
  return { from: () => query } as unknown as Db;
}

const withToken = (token: string) => new Request("https://site.example.test/api/mcp", { headers: { Authorization: `Bearer ${token}` } });

describe("authenticating an agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not read a database that did not answer as a bad token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await authenticateAgent(withToken(newAgentToken()), serviceAnswering({ data: null, error: { message: "502 Bad Gateway" } }));
    expect(outcome).toEqual({ ok: false, status: 503, message: "the token could not be checked: try again" });
  });

  it("refuses a token the database does not know with 401", async () => {
    const outcome = await authenticateAgent(withToken(newAgentToken()), serviceAnswering({ data: null, error: null }));
    expect(outcome).toEqual({ ok: false, status: 401, message: "a valid agent token is required" });
  });
});
