import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashAgentToken, newAgentToken } from "@/lib/agent-token";
import { mcpEndpoint } from "@/lib/mcp/server";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The MCP endpoint driven in-process by the SDK's own client, against the real database. The owner has
// Acme → { Web, Mobile }; the agent's token is issued on Web.

const URL_MCP = "http://localhost:8787/api/mcp";
let user: DisposableUser | undefined;
const ids = { acme: "", web: "", mobile: "" };
let token = "";
let revokedToken = "";

const serve = () => mcpEndpoint({ service: serviceClient() });

async function node(kind: "client" | "project", name: string, parent?: string) {
  const { data, error } = await user!.client
    .from("nodes")
    .insert({ owner_id: user!.id, kind, name, parent_id: parent ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function issue(nodeId: string, label: string): Promise<{ token: string; id: string }> {
  const value = newAgentToken();
  const { data, error } = await user!.client
    .from("agent_tokens")
    .insert({ node_id: nodeId, label, token_hash: await hashAgentToken(value) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { token: value, id: data.id };
}

async function connect(bearer: string): Promise<Client> {
  const endpoint = serve();
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    fetch: (url, init) => endpoint(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

function parse(result: { content: unknown }): Record<string, unknown> {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first.text) as Record<string, unknown>;
}

beforeAll(async () => {
  user = await createDisposableUser("mcp");
  ids.acme = await node("client", "Acme");
  ids.web = await node("project", "Web", ids.acme);
  ids.mobile = await node("project", "Mobile", ids.acme);
  token = (await issue(ids.web, "laptop")).token;
  const revoked = await issue(ids.web, "old laptop");
  revokedToken = revoked.token;
  const { error } = await user.client.from("agent_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", revoked.id);
  if (error) throw new Error(error.message);
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

describe("the MCP endpoint", () => {
  it("initializes and lists the twelve tools, the reads marked read-only", async () => {
    const client = await connect(token);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(readOnly).toEqual(["get_overview", "get_updates_since", "list_events", "list_items", "list_tree", "search_items"]);
    expect(tools.find((t) => t.name === "create_task")?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });

  it("answers 401 without a token, with a malformed one, and with a revoked one", async () => {
    const endpoint = serve();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const none = await endpoint(new Request(URL_MCP, { method: "POST", headers, body }));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    const malformed = await endpoint(new Request(URL_MCP, { method: "POST", headers: { ...headers, Authorization: "Bearer nope" }, body }));
    expect(malformed.status).toBe(401);
    const revoked = await endpoint(new Request(URL_MCP, { method: "POST", headers: { ...headers, Authorization: `Bearer ${revokedToken}` }, body }));
    expect(revoked.status).toBe(401);
    await expect(connect(revokedToken)).rejects.toThrow();
  });

  it("refuses a request whose Origin is another site", async () => {
    const response = await serve()(
      new Request(URL_MCP, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("a write appears with source agent and the token's label", async () => {
    const client = await connect(token);
    const result = await client.callTool({ name: "create_task", arguments: { title: "Fix the hero on mobile Safari" } });
    expect(result.isError).toBeFalsy();
    const created = parse(result) as { ok: boolean; item: { id: string } };
    const { data } = await user!.client.from("items").select("node_id, source, agent_label").eq("id", created.item.id).single();
    expect(data).toEqual({ node_id: ids.web, source: "agent", agent_label: "laptop" });
    await client.close();
  });

  it("a failing token lookup refuses rather than lets through", async () => {
    // The database answering an error must make the verdict stricter: 401, never a pass.
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
    const response = await mcpEndpoint({ service: broken as unknown as ReturnType<typeof serviceClient> })(
      new Request(URL_MCP, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("a token on the parent reaches the node a sibling token cannot", async () => {
    const parentToken = (await issue(ids.acme, "parent")).token;
    const client = await connect(parentToken);
    const reached = await client.callTool({ name: "get_overview", arguments: { node: "Acme / Mobile" } });
    expect(parse(reached)).toMatchObject({ ok: true, node: { path: "Acme / Mobile" } });
    await client.close();
  });

  it("a token on a node does not reach its sibling", async () => {
    const client = await connect(token);
    const byId = await client.callTool({ name: "create_task", arguments: { node: ids.mobile, title: "Escape" } });
    expect(byId.isError).toBe(true);
    expect(parse(byId)).toMatchObject({ ok: false, code: "not_found" });
    const byPath = await client.callTool({ name: "get_overview", arguments: { node: "Acme / Mobile" } });
    expect(parse(byPath)).toMatchObject({ ok: false, code: "not_found" });
    const tree = parse(await client.callTool({ name: "list_tree", arguments: {} })) as { nodes: Array<{ id: string }> };
    expect(tree.nodes.map((n) => n.id)).toEqual([ids.web]);
    await client.close();
  });

  it("what's new starts from where the token last read, and reading moves the mark", async () => {
    const client = await connect(token);
    // The token never read: with no moment, its first read brings everything in reach.
    const first = parse(await client.callTool({ name: "get_updates_since", arguments: {} })) as {
      created: Array<{ title: string }>;
      until: string;
    };
    expect(first.created.map((i) => i.title)).toContain("Fix the hero on mobile Safari");
    const empty = parse(await client.callTool({ name: "get_updates_since", arguments: {} })) as { since: string; created: unknown[] };
    expect(empty.since).toBe(first.until);
    expect(empty.created).toEqual([]);
    await user!.client.from("items").insert({ node_id: ids.web, type: "task", title: "Written on screen after the read" });
    const next = parse(await client.callTool({ name: "get_updates_since", arguments: {} })) as { created: Array<{ title: string }> };
    expect(next.created.map((i) => i.title)).toEqual(["Written on screen after the read"]);
    await client.close();
  });
});
