import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/supabase/server";

const PERSON: SessionUser = { id: "11111111-1111-4111-8111-111111111111", email: "alex.rivera@studio.example", isAnonymous: false, name: "Alex Rivera", avatarUrl: null };
const NODE = "22222222-2222-4222-8222-222222222222";
const LINK = "33333333-3333-4333-8333-333333333333";

type Row = {
  id: string;
  owner_id: string;
  node_id: string;
  status: string;
  email: string | null;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
  expires_at: string;
};

const world = vi.hoisted(() => ({
  row: null as Row | null,
  stored: [] as Array<{ ownerId: string; nodeId: string }>,
}));

function freshRow(overrides: Partial<Row> = {}): Row {
  return {
    id: LINK,
    owner_id: PERSON.id,
    node_id: NODE,
    status: "authorized",
    email: "other@studio.example",
    refresh_token: "sealed-refresh",
    access_token: "sealed-access",
    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scopes: ["openid"],
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  };
}

class Query {
  op = "select";
  values: Record<string, unknown> = {};
  filters: Array<[string, unknown]> = [];
  statuses: string[] | null = null;
  constructor(private table: string) {}
  select() { return this; }
  insert(values: Record<string, unknown>) { this.op = "insert"; this.values = values; return this; }
  update(values: Record<string, unknown>) { this.op = "update"; this.values = values; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  in(column: string, values: string[]) { if (column === "status") this.statuses = values; return this; }
  gt() { return this; }
  lte() { return this; }
  order() { return this; }
  private matches(): boolean {
    const row = world.row;
    if (!row) return false;
    if (this.statuses && !this.statuses.includes(row.status)) return false;
    return this.filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value);
  }
  private run(): { data: unknown; error: null } {
    if (this.table !== "google_connect_links") return { data: { id: NODE }, error: null };
    if (this.op === "update") {
      if (!this.matches()) return { data: [], error: null };
      Object.assign(world.row!, this.values);
      return { data: [{ id: LINK }], error: null };
    }
    return { data: this.matches() ? world.row : null, error: null };
  }
  async maybeSingle() { return this.run(); }
  async single() { return this.run(); }
  then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  userClient: async () => ({ from: (table: string) => new Query(table) }),
  requireUser: async () => ({ ok: true, user: PERSON }),
  serviceClient: () => ({ from: (table: string) => new Query(table) }),
}));
vi.mock("@/lib/google/deps", () => ({
  googleDeps: async () => ({ service: null, key: null, client: { clientId: "id", clientSecret: "secret" }, fetch: fetch }),
  missingGoogleConfig: () => [],
}));
vi.mock("@/lib/google/connect", () => ({
  decryptAuthorized: async () => ({ email: "other@studio.example", refreshToken: "refresh", accessToken: "access", accessTokenExpiresAt: new Date().toISOString(), scopes: [] }),
  storeAuthorizedAccount: async (_deps: unknown, target: { ownerId: string; nodeId: string }) => {
    world.stored.push(target);
    return { accountId: "account", email: "other@studio.example", calendars: 0 };
  },
}));

async function post(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(new NextRequest("http://localhost/api/google/connect-links", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  }));
}

describe("accepting a connect link", () => {
  beforeEach(() => {
    world.row = freshRow();
    world.stored = [];
  });

  it("connects the account once, in the session that created the link", async () => {
    const response = await post({ action: "accept", id: LINK });
    expect(response.status).toBe(200);
    expect(world.stored).toEqual([{ ownerId: PERSON.id, nodeId: NODE }]);
    expect(world.row?.status).toBe("accepted");
    expect(world.row?.refresh_token).toBeNull();
    const again = await post({ action: "accept", id: LINK });
    expect(again.status).toBe(422);
    expect(world.stored).toHaveLength(1);
  });

  it("refuses the link of another owner and stores nothing", async () => {
    world.row = freshRow({ owner_id: "99999999-9999-4999-8999-999999999999" });
    const response = await post({ action: "accept", id: LINK });
    expect(response.status).toBe(404);
    expect(world.stored).toHaveLength(0);
    expect(world.row?.status).toBe("authorized");
  });

  it("an expired link accepts nothing and keeps no token", async () => {
    world.row = freshRow({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const response = await post({ action: "accept", id: LINK });
    expect(response.status).toBe(422);
    expect(world.stored).toHaveLength(0);
    expect(world.row?.refresh_token).toBeNull();
    expect(world.row?.access_token).toBeNull();
  });

  it("a rejection racing the accept leaves nothing connected", async () => {
    const rejected = await post({ action: "reject", id: LINK });
    expect(rejected.status).toBe(200);
    const response = await post({ action: "accept", id: LINK });
    expect(response.status).toBe(422);
    expect(world.stored).toHaveLength(0);
  });
});
