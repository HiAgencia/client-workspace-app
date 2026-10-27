import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChat } from "@/lib/chat/run";
import { simulatedModel } from "@/lib/chat/simulated";
import { takeUsage } from "@/lib/chat/usage";
import type { ToolContext } from "@/lib/tools/context";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

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
    expect(toolPart?.output).toMatchObject({ ok: true, item: { title: "send the invoice to Acme", nodeId, source: "chat" } });
    expect(message?.parts.some((part) => part.type === "text" && part.text.startsWith("Done"))).toBe(true);
    expect(stored?.role).toBe("assistant");
    const { data } = await user!.client.from("items").select("title, source").eq("node_id", nodeId);
    expect(data).toContainEqual({ title: "send the invoice to Acme", source: "chat" });
  });

  it("an image becomes a task, and asking what is pending reads the node", async () => {
    const image = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" };
    const withImage = await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask("Here is what the client sent", [image]), timeZone: "UTC" }));
    expect(withImage.message?.parts.some((part) => part.type === "tool-create_task")).toBe(true);
    const pending = await drain(await runChat({ ctx: ctx(), model: simulatedModel(), messages: ask("What is pending?"), timeZone: "UTC" }));
    const answer = pending.message?.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" ");
    expect(answer).toContain("send the invoice to Acme");
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

describe("the daily cap", () => {
  it("takes units up to the cap and then refuses, per person, kind, and day", async () => {
    const service = serviceClient();
    const day = new Date("2026-01-15T12:00:00Z");
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: true, count: 1 });
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: true, count: 2 });
    expect(await takeUsage(service, user!.id, "transcription", 2, day)).toEqual({ allowed: false, reason: "cap" });
    expect(await takeUsage(service, user!.id, "chat_message", 2, day)).toEqual({ allowed: true, count: 1 });
    expect(await takeUsage(service, user!.id, "transcription", 2, new Date("2026-01-16T00:00:01Z"))).toEqual({ allowed: true, count: 1 });
  });

  it("a signed-in person cannot take units for themselves", async () => {
    const { error } = await user!.client.rpc("take_usage", { p_owner: user!.id, p_kind: "chat_message", p_day: "2026-01-15", p_cap: 1000 });
    expect(error?.code).toBe("42501");
  });
});
