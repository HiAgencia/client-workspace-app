import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChat, systemPrompt } from "@/lib/chat/run";
import { simulatedModel } from "@/lib/chat/simulated";
import { loadHistory, withoutEarlierFiles } from "@/lib/chat/history";
import { dailyCap, takeUsage, takeUsageFor } from "@/lib/chat/usage";
import { encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import { demoMailSource, holdsEveryWord, type MailMessage, type MailSource } from "@/lib/mail/source";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { createAnonymousUser, createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The chat against the scripted model and the real database: what a request does lands in the node with source
// "chat", the daily cap stops at its limit, and a provider failure arrives as a readable error in the stream.

let user: DisposableUser | undefined;
let clientId: string;
let nodeId: string;

beforeAll(async () => {
  user = await createDisposableUser("chat");
  const client = await user.client
    .from("nodes")
    .insert({ owner_id: user.id, kind: "client", name: "Acme" })
    .select("id")
    .single();
  if (client.error) throw new Error(client.error.message);
  clientId = client.data.id;
  const project = await user.client
    .from("nodes")
    .insert({ owner_id: user.id, kind: "project", name: "Web", parent_id: client.data.id })
    .select("id")
    .single();
  if (project.error) throw new Error(project.error.message);
  nodeId = project.data.id;
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

function ctx(): ToolContext {
  return { db: user!.client, ownerId: user!.id, scopeNodeId: nodeId, source: "chat" };
}

function ask(text: string, extra: UIMessage["parts"] = []): UIMessage[] {
  return [{ id: "m1", role: "user", parts: [...extra, { type: "text", text }] }];
}

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<{ chunks: UIMessageChunk[]; message: UIMessage | undefined }> {
  const chunks: UIMessageChunk[] = [];
  const [forChunks, forMessage] = stream.tee();
  const reader = forChunks.getReader();
  let message: UIMessage | undefined;
  const reading = (async () => {
    for await (const value of readUIMessageStream({ stream: forMessage })) message = value;
  })();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await reading;
  return { chunks, message };
}

describe("the chat with the simulated model", () => {
  it("a request to create a task ends in create_task on the open node, recorded as written by the chat", async () => {
    let stored: UIMessage | undefined;
    const stream = await runChat({
      ctx: ctx(),
      model: simulatedModel(),
      messages: ask("Create a task to send the invoice to Acme"),
      timeZone: "America/Argentina/Buenos_Aires",
      onEnd: ({ responseMessage }) => {
        stored = responseMessage;
      },
    });
    const { message } = await drain(stream);
    const toolPart = message?.parts.find((part) => part.type === "tool-create_task") as { state: string; output: { ok: boolean; item: { title: string; nodeId: string; source: string } } } | undefined;
    expect(toolPart?.state).toBe("output-available");
    expect(toolPart?.output).toMatchObject({ ok: true, item: { title: "Send the invoice to Acme", nodeId, source: "chat" } });
    expect(message?.parts.some((part) => part.type === "text" && part.text.startsWith("Done"))).toBe(true);
    expect(stored?.role).toBe("assistant");
    const { data } = await user!.client.from("items").select("title, source").eq("node_id", nodeId);
    expect(data).toContainEqual({ title: "Send the invoice to Acme", source: "chat" });
  });

  it("an image becomes a task, and asking what is pending reads the node", async () => {
    const image = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" };
    const withImage = await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask("Here is what the client sent", [image]), timeZone: "UTC" }));
    expect(withImage.message?.parts.some((part) => part.type === "tool-create_task")).toBe(true);
    const pending = await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask("What is pending?"), timeZone: "UTC" }));
    const answer = pending.message?.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" ");
    expect(answer).toContain("Send the invoice to Acme");
  });

  it("a provider failure reaches the panel as a readable error, not an exception", async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw Object.assign(new Error("upstream exploded"), { statusCode: 500 });
      },
    });
    const { chunks } = await drain(await runChat({ ctx: ctx(), model: failing, messages: ask("Hello"), timeZone: "UTC" }));
    const error = chunks.find((chunk) => chunk.type === "error") as { errorText: string } | undefined;
    expect(error?.errorText).toBe("The model did not answer. Try again.");
  });
});

describe("the workspace's own chat, with no node open", () => {
  const wide = (): ToolContext => ({ db: user!.client, ownerId: user!.id, source: "chat" });

  it("a request that names its project lands there, and asking what is pending reads every project", async () => {
    const { message } = await drain(
      await runChat({ ctx: wide(), model: simulatedModel(), messages: ask("Create a task in Acme / Web to call the printer"), timeZone: "UTC" }),
    );
    const toolPart = message?.parts.find((part) => part.type === "tool-create_task") as { output: { ok: boolean; item: { title: string; nodeId: string } } } | undefined;
    expect(toolPart?.output).toMatchObject({ ok: true, item: { title: "Call the printer", nodeId } });
    const pending = await drain(await runChat({ ctx: wide(), model: simulatedModel(), messages: ask("What is pending?"), timeZone: "UTC" }));
    expect(pending.message?.parts.some((part) => part.type === "tool-browse_items")).toBe(true);
    const answer = pending.message?.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" ");
    expect(answer).toContain("Call the printer");
  });

  it("«Did anything arrive for my tasks?» reads the possible replies of the tasks that wait for mail, and closes none", async () => {
    // An account of Acme, which Web sees, and a mail source that holds what the bank sent after the wait began.
    const key = await importKey(newKeyBase64());
    const service = serviceClient();
    const account = await service
      .from("google_accounts")
      .insert({
        owner_id: user!.id,
        email: "studio@example.com",
        refresh_token: await encrypt(key, "refresh"),
        access_token: await encrypt(key, "access"),
        access_token_expires_at: "2099-01-01T00:00:00Z",
        scopes: ["openid", "email"],
        status: "active",
      })
      .select("id")
      .single();
    if (account.error) throw new Error(account.error.message);
    const attached = await service.from("node_accounts").insert({ node_id: clientId, account_id: account.data.id });
    if (attached.error) throw new Error(attached.error.message);
    const transfer: MailMessage = {
      id: "transfer",
      threadId: "transfer",
      accountId: account.data.id,
      accountEmail: "studio@example.com",
      from: { name: "Bayside Bank", email: "alerts@bayside.example" },
      to: ["studio@example.com"],
      subject: "Transfer received",
      snippet: "The transfer arrived.",
      receivedAt: new Date(Date.now() + 60_000).toISOString(),
      unread: true,
      important: false,
    };
    const mail: MailSource = { ...demoMailSource(), candidates: async ({ words }) => ({ messages: holdsEveryWord(transfer, words) ? [transfer] : [], failures: [], nextPageToken: null }) };
    const withMail: ToolContext = { ...wide(), mail };
    const task = (await callTool("create_task", withMail, { node: nodeId, title: "Wait for the transfer" })) as unknown as { ok: boolean; item: { id: string } };
    expect(task.ok).toBe(true);
    expect((await callTool("set_task_mail", withMail, { task: task.item.id, words: "Bayside Bank" })).ok).toBe(true);

    const { message } = await drain(await runChat({ ctx: withMail, model: simulatedModel(), messages: ask("Did anything arrive for my tasks?"), timeZone: "UTC" }));
    const read = message?.parts.find((part) => part.type === "tool-list_task_replies") as { output: { ok: boolean; replies: Array<{ id: string }> } } | undefined;
    expect(read?.output).toMatchObject({ ok: true, replies: [{ id: "transfer" }] });
    const answer = message?.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" ");
    expect(answer).toContain('"Wait for the transfer": 1 possible reply, the latest "Transfer received" from Bayside Bank.');
    // The chat reads; the person decides which message answers the task.
    const after = await user!.client.from("items").select("status").eq("id", task.item.id).single();
    expect(after.data?.status).toBe("open");
  });

  it("closes the task the person names with the result they say, and nothing they did not name", async () => {
    const named = (await callTool("create_task", ctx(), { title: "Wait for the signed contract" })) as unknown as { ok: boolean; item: { id: string } };
    const other = (await callTool("create_task", ctx(), { title: "Wait for the signed invoice" })) as unknown as { ok: boolean; item: { id: string } };
    expect(named.ok && other.ok).toBe(true);
    const status = async (id: string) => (await user!.client.from("items").select("status").eq("id", id).single()).data?.status;

    // A title that names no open task closes nothing.
    await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask('Close "Wait for the signed lease" as approved'), timeZone: "UTC" }));
    expect([await status(named.item.id), await status(other.item.id)]).toEqual(["open", "open"]);

    const { message } = await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask('Close "Wait for the signed contract" as approved'), timeZone: "UTC" }));
    const closed = message?.parts.find((part) => part.type === "tool-complete_task") as { output: { ok: boolean; decision: { title: string } } } | undefined;
    expect(closed?.output).toMatchObject({ ok: true, decision: { title: "Approved" } });
    expect([await status(named.item.id), await status(other.item.id)]).toEqual(["done", "open"]);
  });

  it("keeps its conversation apart from each node's", async () => {
    const rows = ["workspace one", "workspace two"].map((text, i) => ({ node_id: null, role: i === 0 ? "user" : "assistant", parts: [{ type: "text", text }] }));
    const { error } = await user!.client.from("chat_messages").insert(rows);
    expect(error).toBeNull();
    const workspace = await loadHistory(user!.client, null);
    expect(workspace.map((m) => (m.parts[0] as { text: string }).text)).toEqual(["workspace one", "workspace two"]);
    const node = await loadHistory(user!.client, nodeId);
    expect(node.some((m) => (m.parts[0] as { text?: string }).text?.startsWith("workspace"))).toBe(false);
  });
});

describe("the conversation the model reads", () => {
  it("is the node's latest messages in the order they were written, built on the server", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      node_id: nodeId,
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `turn ${i}` }],
    }));
    const { error } = await user!.client.from("chat_messages").insert(rows);
    expect(error).toBeNull();
    const history = await loadHistory(user!.client, nodeId, 4);
    expect(history.map((m) => (m.parts[0] as { text: string }).text)).toEqual(["turn 2", "turn 3", "turn 4", "turn 5"]);
  });

  it("carries an image only in the turn it arrives", () => {
    const image = { type: "file" as const, mediaType: "image/png", filename: "shot.png", url: "data:image/png;base64,AAAA" };
    const messages = withoutEarlierFiles([
      { id: "1", role: "user", parts: [image, { type: "text", text: "earlier" }] },
      { id: "2", role: "user", parts: [image, { type: "text", text: "now" }] },
    ]);
    expect(messages[0].parts[0]).toEqual({ type: "text", text: "[an attachment was sent here: shot.png]" });
    expect(messages[1].parts[0]).toEqual(image);
  });
});

describe("the daily cap", () => {
  it("a demo session has its own small cap, and all demo sessions share the day's total", async () => {
    const service = serviceClient();
    const day = new Date("2026-02-20T12:00:00Z");
    // A demo session of the pool: written down while it is this run's, and its usage refilled before each use.
    const demoUser = await createAnonymousUser("chat-cap");
    try {
      const results = [];
      for (let i = 0; i < dailyCap("demoSession", "transcription") + 1; i++) {
        results.push(await takeUsageFor(service, { id: demoUser.id, isAnonymous: true }, "transcription", day));
      }
      expect(results.at(-2)).toMatchObject({ allowed: true });
      expect(results.at(-1)).toEqual({ allowed: false, reason: "cap" });
      const total = await service.rpc("anonymous_usage", { p_kind: "transcription", p_day: "2026-02-20" });
      expect(Number(total.data)).toBeGreaterThanOrEqual(dailyCap("demoSession", "transcription"));
      const { error } = await user!.client.rpc("anonymous_usage", { p_kind: "transcription", p_day: "2026-02-20" });
      expect(error?.code).toBe("42501");
    } finally {
      await deleteDisposableUsers([demoUser]);
    }
  });

  it("takes units up to the cap and then refuses, per person, kind, and day", async () => {
    const service = serviceClient();
    const day = new Date("2026-01-15T12:00:00Z");
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: true, count: 1 });
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: true, count: 2 });
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: false, reason: "cap" });
    expect(await takeUsage(service, user!.id, "chat_message", 2, day)).toEqual({ allowed: true, count: 1 });
    expect(await takeUsage(service, user!.id, "transcription", 2, new Date("2026-01-16T00:00:01Z"))).toEqual({ allowed: true, count: 1 });
  });

  it("a failing cap read refuses the model call rather than lets it through", async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as ReturnType<typeof serviceClient>;
    expect(await takeUsage(broken, user!.id, "chat_message", 60)).toEqual({ allowed: false, reason: "error" });
    expect(await takeUsageFor(broken, { id: user!.id, isAnonymous: true }, "chat_message")).toEqual({ allowed: false, reason: "error" });
  });

  it("a signed-in person cannot take units for themselves", async () => {
    const { error } = await user!.client.rpc("take_usage", { p_owner: user!.id, p_kind: "chat_message", p_day: "2026-01-15", p_cap: 1000 });
    expect(error?.code).toBe("42501");
  });
});

describe("what the model knows before it reads", () => {
  it("names each place with its open tasks, one of them in the singular", async () => {
    const solo = await user!.client.from("nodes").insert({ owner_id: user!.id, kind: "client", name: "Solo" }).select("id").single();
    if (solo.error) throw new Error(solo.error.message);
    const task = await user!.client.from("items").insert({ owner_id: user!.id, node_id: solo.data.id, type: "task", title: "Call the printer" });
    if (task.error) throw new Error(task.error.message);
    const prompt = await systemPrompt({ db: user!.client, ownerId: user!.id, source: "chat" }, "UTC");
    expect(prompt).toMatch(/^- Solo \(1 open task\)$/m);
  });
});
