import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChat } from "@/lib/chat/run";
import { simulatedModel } from "@/lib/chat/simulated";
import { loadHistory, withoutEarlierFiles } from "@/lib/chat/history";
import { dailyCap, takeUsage, takeUsageFor } from "@/lib/chat/usage";
import type { ToolContext } from "@/lib/tools/context";
import { createAnonymousUser, createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The chat against the scripted model and the real database: what a request does lands in the node with source
// "chat", the daily cap stops at its limit, and a provider failure arrives as a readable error in the stream.

let user: DisposableUser | undefined;
let nodeId: string;

beforeAll(async () => {
  user = await createDisposableUser("chat");
  const client = await user.client
    .from("nodes")
    .insert({ owner_id: user.id, kind: "client", name: "Acme" })
    .select("id")
    .single();
  if (client.error) throw new Error(client.error.message);
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

  it("«Review my day» runs the daily review through its tool, on purpose, for the person's day", async () => {
    const zone = "America/Argentina/Buenos_Aires";
    const { message } = await drain(await runChat({ ctx: wide(), model: simulatedModel(), messages: ask("Review my day"), timeZone: zone }));
    const toolPart = message?.parts.find((part) => part.type === "tool-run_daily_review") as
      | { input: { today: string; zone: string }; output: { ok: boolean; ran: boolean; review: { requested: boolean; day: string } } }
      | undefined;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(toolPart?.input).toEqual({ today, zone });
    expect(toolPart?.output).toMatchObject({ ok: true, ran: true, review: { requested: true, day: today } });
    const answer = message?.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" ");
    expect(answer).toContain("I reviewed your day");
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
