import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GMAIL_READ_SCOPE, type Fetch } from "@/lib/google/api";
import { encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import type { GoogleDeps } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import type { ToolContext } from "@/lib/tools/context";
import { reachableMessage } from "@/lib/tools/mail";
import { callTool } from "@/lib/tools/registry";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";





let user: DisposableUser | undefined;
let other: DisposableUser | undefined;
let deps: GoogleDeps;
let client = "";
let account = "";
let foreignAccount = "";

const reads: string[] = [];

const stored = {
  id: "reply",
  threadId: "thread",
  labelIds: ["INBOX"],
  internalDate: String(Date.parse("2026-10-29T14:58:00Z")),
  snippet: "Approved",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Bayside Bank <alerts@bayside.example>" },
      { name: "To", value: "studio@example.com" },
      { name: "Subject", value: "Transfer received" },
    ],
    body: { data: Buffer.from("Transfer received.", "utf8").toString("base64url") },
  },
};

const fakeGoogle: Fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/token") return new Response(JSON.stringify({ access_token: "token-mail", expires_in: 3600 }), { status: 200 });
  if (url.pathname.startsWith("/gmail/v1/users/me/messages/")) {
    reads.push(url.searchParams.get("format") ?? "");
    return new Response(JSON.stringify(stored), { status: 200 });
  }
  if (url.pathname === "/batch/gmail/v1") {
    const [, item, id, query] = /Content-ID: <(item\d+)>\r\n\r\nGET \/gmail\/v1\/users\/me\/messages\/([^?\s]+)\?(\S+)/.exec(String(init?.body)) ?? [];
    const format = new URLSearchParams(query).get("format") ?? "";
    reads.push(format);
    const found = decodeURIComponent(id) === stored.id;
    const body = found
      ? JSON.stringify({ ...stored, payload: { mimeType: stored.payload.mimeType, headers: stored.payload.headers } })
      : JSON.stringify({ error: { code: 404 } });
    const part = `--batch_fake\r\nContent-Type: application/http\r\nContent-ID: <response-${item}>\r\n\r\nHTTP/1.1 ${found ? "200 OK" : "404 Not Found"}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--batch_fake--\r\n`;
    return new Response(part, { status: 200, headers: { "Content-Type": "multipart/mixed; boundary=batch_fake" } });
  }
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
};

const context = (db: ToolContext["db"] = user!.client): ToolContext => ({ db, ownerId: user!.id, source: "manual", mail: gmailMailSource(deps) });


function changingCall(name: string, change: (args: Record<string, unknown>) => Record<string, unknown>): ToolContext["db"] {
  const real = user!.client;
  return new Proxy(real, {
    get(target, property) {
      if (property === "rpc") {
        return (fn: string, args: Record<string, unknown>) => (real.rpc as unknown as (f: string, a: unknown) => unknown)(fn, fn === name ? change(args) : args);
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function newTask(title = "Wait for the transfer") {
  const { data, error } = await user!.client.from("items").insert({ owner_id: user!.id, node_id: client, type: "task", title }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

type Closed = { ok: boolean; message?: string; item: { status: string; completedAt: string | null }; decision: { id: string; title: string; body: string | null }; link: { created: boolean } | null };
const close = (task: string, db?: ToolContext["db"], outcome = "approved", reply = { account, id: stored.id }) =>
  callTool("complete_task", context(db), { task, outcome, reply }) as unknown as Promise<Closed>;


async function stateOf(task: string) {
  const item = await user!.client.from("items").select("status, completed_at").eq("id", task).single();
  const under = await user!.client.from("items").select("id").eq("parent_item_id", task).is("deleted_at", null);
  const links = await user!.client.from("mail_links").select("message_id").eq("item_id", task);
  if (item.error || under.error || links.error) throw new Error("the task could not be read back");
  return { status: item.data.status, completedAt: item.data.completed_at, results: under.data.length, links: links.data.length };
}

function leftAsItWas(state: Awaited<ReturnType<typeof stateOf>>) {
  expect(state, "a closing that failed leaves the task open, without a result and without a link").toEqual({ status: "open", completedAt: null, results: 0, links: 0 });
}

beforeAll(async () => {
  user = await createDisposableUser("complete-task");
  other = await createDisposableUser("complete-task-other");
  deps = { service: serviceClient(), key: await importKey(newKeyBase64()), client: { clientId: "id", clientSecret: "secret" }, fetch: fakeGoogle };
  const node = await user.client.from("nodes").insert({ owner_id: user.id, kind: "client", name: "Acme" }).select("id").single();
  if (node.error) throw new Error(node.error.message);
  client = node.data.id;
  const insertAccount = async (owner: DisposableUser, email: string) => {
    const { data, error } = await serviceClient()
      .from("google_accounts")
      .insert({
        owner_id: owner.id,
        email,
        refresh_token: await encrypt(deps.key, "refresh-mail"),
        access_token: await encrypt(deps.key, "stale"),
        access_token_expires_at: "2020-01-01T00:00:00Z",
        scopes: ["openid", "email", GMAIL_READ_SCOPE],
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  };
  account = await insertAccount(user, "studio@example.com");
  const attached = await serviceClient().from("node_accounts").insert({ node_id: client, account_id: account });
  if (attached.error) throw new Error(attached.error.message);
  foreignAccount = await insertAccount(other, "foreign@example.com");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user, other]);
}, 60_000);

describe("closing a task with its result", () => {
  it("marks it done, hangs the result from it, and links the reply, with the moment from the database and the words of the message", async () => {
    const task = await newTask();
    const closed = await close(task);
    expect(closed.ok).toBe(true);
    expect(closed.item.status).toBe("done");
    expect(closed.item.completedAt, "the database stamped the completion").not.toBeNull();
    expect(closed.decision).toMatchObject({ title: "Approved", body: "<p>From Bayside Bank: Transfer received · 2026-10-29</p>" });
    expect(closed.link).toMatchObject({ created: true });
    expect(await stateOf(task)).toMatchObject({ status: "done", results: 1, links: 1 });
  });

  it("closes without a message too, with its result and no link", async () => {
    const task = await newTask();
    const closed = (await callTool("complete_task", context(), { task, outcome: "Done by phone" })) as unknown as Closed;
    expect(closed.ok).toBe(true);
    expect(closed.decision).toMatchObject({ title: "Done by phone", body: null });
    expect(closed.link).toBeNull();
    expect(await stateOf(task)).toMatchObject({ status: "done", results: 1, links: 0 });
  });

  it("an agent's closing carries its label on the task and on the result", async () => {
    const task = await newTask();
    const agent: ToolContext = { db: serviceClient(), ownerId: user!.id, source: "agent", agentLabel: "Laptop", mail: gmailMailSource(deps) };
    const closed = await callTool("complete_task", agent, { task, outcome: "Approved" });
    expect(closed).toMatchObject({ ok: true, item: { changedSource: "agent", changedAgentLabel: "Laptop" }, decision: { source: "agent", agentLabel: "Laptop" } });
  });

  it("a reply already linked closes all the same, and says this closing did not link it", async () => {
    const task = await newTask();
    const linked = await user!.client.from("mail_links").insert({ owner_id: user!.id, account_id: account, message_id: stored.id, item_id: task });
    expect(linked.error).toBeNull();
    const closed = await close(task);
    expect(closed.link).toMatchObject({ created: false });
    expect(await stateOf(task)).toMatchObject({ status: "done", results: 1, links: 1 });
  });

  it("the decision failing leaves the task open and without a link", async () => {
    const task = await newTask();
    const db = changingCall("complete_task", (args) => ({ ...args, p_outcome: "   " }));
    const closed = await close(task, db);
    expect(closed.ok, "the failure is said").toBe(false);
    leftAsItWas(await stateOf(task));
  });

  it("the link failing leaves the task open and without a result", async () => {
    const task = await newTask();
    
    const db = changingCall("complete_task", (args) => ({ ...args, p_account: foreignAccount }));
    const closed = await close(task, db);
    expect(closed.ok, "the failure is said").toBe(false);
    leftAsItWas(await stateOf(task));
  });

  it("its twin: the same failure across separate writes leaves the task done, and the check says so", async () => {
    const task = await newTask();
    const done = await callTool("update_item", context(), { id: task, status: "done" });
    expect(done.ok).toBe(true);
    const decision = await user!.client.from("items").insert({ owner_id: user!.id, node_id: client, parent_item_id: task, type: "decision", title: "   " });
    expect(decision.error?.code, "the decision was refused").toBe("23514");
    const state = await stateOf(task);
    expect(() => leftAsItWas(state)).toThrow("a closing that failed leaves the task open");
  });

  it("a task closed meanwhile writes nothing more", async () => {
    const task = await newTask();
    await close(task);
    
    const again = await user!.client.rpc("complete_task", {
      p_owner: user!.id,
      p_item: task,
      p_outcome: "Rejected",
      p_body: null as unknown as string,
      p_account: null as unknown as string,
      p_message: null as unknown as string,
      p_source: "manual",
      p_agent_label: null as unknown as string,
    });
    expect({ error: again.error, data: again.data }).toEqual({ error: null, data: null });
    expect(await stateOf(task)).toMatchObject({ results: 1 });
  });

  it("does not reach another person's task through the function", async () => {
    const task = await newTask();
    const crossed = await other!.client.rpc("complete_task", {
      p_owner: other!.id,
      p_item: task,
      p_outcome: "Stolen",
      p_body: null as unknown as string,
      p_account: null as unknown as string,
      p_message: null as unknown as string,
      p_source: "manual",
      p_agent_label: null as unknown as string,
    });
    expect({ error: crossed.error, data: crossed.data }).toEqual({ error: null, data: null });
    leftAsItWas(await stateOf(task));
  });
});

describe("what a closing reads of the message", () => {
  it("asks Gmail for its headers alone", async () => {
    reads.length = 0;
    const closed = await close(await newTask());
    expect(closed.ok).toBe(true);
    expect(reads, "one read, of its metadata").toEqual(["metadata"]);
  });

  it("its twin: reading the message whole, as the viewer does, asks for its body, and the check would see it", async () => {
    reads.length = 0;
    const read = await reachableMessage(context(), account, stored.id);
    expect(read.ok).toBe(true);
    expect(reads).toEqual(["full"]);
  });

  it("a message the account no longer holds stops everything before a write", async () => {
    const task = await newTask();
    const closed = await close(task, undefined, "approved", { account, id: "deleted-message" });
    expect(closed).toMatchObject({ ok: false, code: "not_found" });
    leftAsItWas(await stateOf(task));
  });

  it("an account out of reach stops everything before a write, without reading Gmail", async () => {
    const task = await newTask();
    reads.length = 0;
    const closed = await close(task, undefined, "approved", { account: foreignAccount, id: stored.id });
    expect(closed).toMatchObject({ ok: false, code: "not_found" });
    expect(reads).toEqual([]);
    leftAsItWas(await stateOf(task));
  });
});

describe("taking a closing back", () => {
  it("opens the task, takes its result off, and unlinks the reply this closing linked, in one call", async () => {
    const task = await newTask();
    const closed = await close(task);
    const back = await callTool("reopen_task", context(), { task, decision: closed.decision.id, reply: { account, id: stored.id } });
    expect(back.ok).toBe(true);
    leftAsItWas(await stateOf(task));
    const decision = await user!.client.from("items").select("deleted_at").eq("id", closed.decision.id).single();
    expect(decision.data?.deleted_at, "the result goes to the trash, as a deletion does").not.toBeNull();
  });

  it("keeps a link that was there before the closing", async () => {
    const task = await newTask();
    const linked = await user!.client.from("mail_links").insert({ owner_id: user!.id, account_id: account, message_id: stored.id, item_id: task });
    expect(linked.error).toBeNull();
    const closed = await close(task);
    const back = await callTool("reopen_task", context(), { task, decision: closed.decision.id });
    expect(back.ok).toBe(true);
    expect(await stateOf(task)).toMatchObject({ status: "open", results: 0, links: 1 });
  });

  it("leaves a decision that hangs from another task", async () => {
    const task = await newTask();
    const closed = await close(await newTask("Another task"));
    const back = await callTool("reopen_task", context(), { task, decision: closed.decision.id });
    expect(back.ok).toBe(true);
    const decision = await user!.client.from("items").select("deleted_at").eq("id", closed.decision.id).single();
    expect(decision.data?.deleted_at).toBeNull();
  });
});
