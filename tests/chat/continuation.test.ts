import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { isToolUIPart, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHistory } from "@/lib/chat/history";
import { leftUnfinished, MAX_READ_ANSWER } from "@/lib/chat/browser-reads";
import type { Json } from "@/lib/db/types";
import type { ToolContext } from "@/lib/tools/context";
import { createAnonymousUser, createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";





let user: DisposableUser | undefined;
let stranger: DisposableUser | undefined;
const calls: LanguageModelV4CallOptions[] = [];

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};
const answering: LanguageModelV4StreamPart[] = [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Here is what arrived." },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
];
let script = answering;

let steps: LanguageModelV4StreamPart[][] | null = null;
let pace: number | null = null;

vi.mock("@/lib/session-context", () => ({
  sessionContext: async () => {
    const ctx: ToolContext = { db: user!.client, ownerId: user!.id, source: "chat" };
    return { ok: true, ctx, user: { id: user!.id, isAnonymous: false } };
  },
}));
vi.mock("@/lib/chat/model", () => ({
  AI_OFF_MESSAGE: "off",
  chatProvider: () => "simulated",
  chatModel: () => ({
    providerOptions: undefined,
    model: new MockLanguageModelV4({
      doStream: async (options) => {
        calls.push(options);
        return { stream: simulateReadableStream({ chunks: steps?.[calls.length - 1] ?? script, chunkDelayInMs: pace }) };
      },
    }),
  }),
}));

const SITE = "http://localhost:8796";
const READ = { type: "tool-list_mail", toolCallId: "read-1", input: {} };
const WRITTEN = { type: "tool-create_task", toolCallId: "write-1", state: "output-available", input: { title: "Call the bank" }, output: { ok: true, item: { id: "x" } } };
const openTurn = (steps = 1) => [...Array.from({ length: steps - 1 }, () => ({ type: "step-start" })), { type: "step-start" }, { ...READ, state: "input-available" }];


async function leaveOpen(taken = 1, before: Json[] = []) {
  const service = serviceClient();
  const gone = await service.from("chat_messages").delete().eq("owner_id", user!.id);
  if (gone.error) throw new Error(gone.error.message);
  const rows = [
    { owner_id: user!.id, node_id: null, role: "user", parts: [{ type: "text", text: "Read my mail" }] },
    { owner_id: user!.id, node_id: null, role: "assistant", parts: [...before, ...openTurn(taken)] },
  ];
  
  for (const row of rows) {
    const saved = await service.from("chat_messages").insert(row);
    if (saved.error) throw new Error(saved.error.message);
  }
}


const writesThenTalks = (): LanguageModelV4StreamPart[][] => [
  [
    { type: "tool-call", toolCallId: "write-2", toolName: "create_task", input: JSON.stringify({ title: "Call the bank" }) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ],
  answering,
];


async function cutOnceWritten(answer: Response, cut: AbortController): Promise<boolean> {
  const reader = answer.body!.getReader();
  let aborted = false;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const text = new TextDecoder().decode(chunk.value);
    if (text.includes("tool-output-available")) cut.abort();
    if (text.includes('"abort"')) aborted = true;
  }
  return aborted;
}

async function newMessage(signal?: AbortSignal) {
  const { POST } = await import("@/app/api/chat/route");
  return POST(
    new Request(`${SITE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" },
      body: JSON.stringify({ nodeId: null, timeZone: "UTC", message: { id: "new", role: "user", parts: [{ type: "text", text: "Add a task to call the bank" }] } }),
      signal,
    }),
  );
}

function goesOn(output: unknown, signal?: AbortSignal) {
  const message = { id: "browser-message", role: "assistant", parts: [{ type: "step-start" }, { ...READ, state: "output-available", output }] };
  return new Request(`${SITE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" },
    body: JSON.stringify({ nodeId: null, timeZone: "UTC", message }),
    signal,
  });
}

const history = async (): Promise<UIMessage[]> => loadHistory(user!.client, null);
const toolPart = (message: UIMessage | undefined) => message?.parts.find(isToolUIPart);

beforeAll(async () => {
  user = await createDisposableUser("continuation");
  stranger = await createDisposableUser("continuation-stranger");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user, stranger]);
}, 60_000);

beforeEach(() => {
  calls.length = 0;
});

describe("going on with a turn", () => {
  it("goes on once however many requests answer its read at the same moment, and the model is called once", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const answers = await Promise.all(["a", "b", "c"].map((text) => POST(goesOn({ ok: true, text }))));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409]);
    await Promise.all(answers.map((answer) => answer.text()));
    expect(calls).toHaveLength(1);
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(toolPart(rows[1])).toMatchObject({ state: "output-available" });
    expect(rows[1].parts.some((part) => part.type === "text" && part.text === "Here is what arrived.")).toBe(true);
  }, 60_000);

  it("a request cut in the middle leaves nothing to answer again, and the turn keeps what it already did", async () => {
    await leaveOpen(1, [{ type: "step-start" }, WRITTEN]);
    const { POST } = await import("@/app/api/chat/route");
    const cut = new AbortController();
    
    pace = 300;
    let aborted = false;
    try {
      const first = await POST(goesOn({ ok: true }, cut.signal));
      expect(first.status).toBe(200);
      const reader = first.body!.getReader();
      await reader.read();
      cut.abort();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        if (new TextDecoder().decode(chunk.value).includes('"abort"')) aborted = true;
      }
    } finally {
      pace = null;
    }
    expect(aborted).toBe(true);
    const again = await POST(goesOn({ ok: true }));
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(1);
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    const tools = rows[1].parts.filter(isToolUIPart);
    expect(tools.find((part) => part.toolCallId === WRITTEN.toolCallId)).toMatchObject({ state: "output-available", output: WRITTEN.output });
    expect(tools.find((part) => part.toolCallId === READ.toolCallId)).toMatchObject({ state: "output-available" });
    
    expect(leftUnfinished(rows[1])).toBe(true);
  }, 60_000);

  it("a person leaves no read open: going on from a row of their own is refused, and the model is not called", async () => {
    const service = serviceClient();
    await service.from("chat_messages").delete().eq("owner_id", user!.id);
    const parts = openTurn() as Json[];
    expect((await user!.client.from("chat_messages").insert({ node_id: null, role: "assistant", parts })).error?.code).toBe("42501");
    const { POST } = await import("@/app/api/chat/route");
    expect((await POST(goesOn({ ok: true }))).status).toBe(409);

    
    await leaveOpen();
    const stored = (await history())[1];
    expect((await POST(goesOn({ ok: true }))).status).toBe(200);
    expect((await user!.client.from("chat_messages").update({ parts }).eq("id", stored.id)).error?.code).toBe("42501");
    expect((await POST(goesOn({ ok: true }))).status).toBe(409);
    expect(calls).toHaveLength(1);

    
    const demo = await createAnonymousUser("continuation-demo");
    try {
      expect((await demo.client.from("chat_messages").insert({ node_id: null, role: "assistant", parts })).error?.code).toBe("42501");
    } finally {
      await deleteDisposableUsers([demo]);
    }
  }, 60_000);

  it("a turn that goes on and is cut keeps what it did after going on, and says it stopped", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const cut = new AbortController();
    steps = writesThenTalks();
    pace = 300;
    try {
      const answer = await POST(goesOn({ ok: true }, cut.signal));
      expect(answer.status).toBe(200);
      expect(await cutOnceWritten(answer, cut)).toBe(true);
    } finally {
      steps = null;
      pace = null;
    }
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    const tools = rows[1].parts.filter(isToolUIPart);
    expect(tools.find((part) => part.toolCallId === READ.toolCallId)).toMatchObject({ state: "output-available" });
    expect(tools.find((part) => part.toolCallId === "write-2")).toMatchObject({ state: "output-available", output: { ok: true } });
    expect(leftUnfinished(rows[1])).toBe(true);
    const written = await user!.client.from("items").select("title").eq("title", "Call the bank");
    expect(written.data).toHaveLength(1);
    await serviceClient().from("items").delete().eq("owner_id", user!.id).eq("title", "Call the bank");
  }, 60_000);

  it("a first request cut after it wrote keeps the message and what it did; one cut before leaves nothing", async () => {
    await serviceClient().from("chat_messages").delete().eq("owner_id", user!.id);
    const before = new AbortController();
    pace = 300;
    try {
      const answer = await newMessage(before.signal);
      expect(answer.status).toBe(200);
      const reader = answer.body!.getReader();
      await reader.read();
      before.abort();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read());
    } finally {
      pace = null;
    }
    expect(await history()).toEqual([]);

    const cut = new AbortController();
    steps = writesThenTalks();
    calls.length = 0;
    pace = 300;
    try {
      const answer = await newMessage(cut.signal);
      expect(answer.status).toBe(200);
      expect(await cutOnceWritten(answer, cut)).toBe(true);
    } finally {
      steps = null;
      pace = null;
    }
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1].parts.filter(isToolUIPart)).toHaveLength(1);
    expect(rows[1].parts.find(isToolUIPart)).toMatchObject({ toolCallId: "write-2", state: "output-available" });
    expect(leftUnfinished(rows[1])).toBe(true);
    await serviceClient().from("items").delete().eq("owner_id", user!.id).eq("title", "Call the bank");
  }, 60_000);

  it("a call left open and the reasoning that led only to it do not reach the model again", async () => {
    await leaveOpen(1, [{ type: "step-start" }, WRITTEN]);
    const service = serviceClient();
    const thought = { type: "reasoning", text: "I should read the mail", state: "done" };
    const row = await service.from("chat_messages").select("id, parts").eq("owner_id", user!.id).eq("role", "assistant").single();
    const parts = row.data!.parts as Json[];
    await service.from("chat_messages").update({ parts: [...parts.slice(0, -1), thought, parts.at(-1)!] }).eq("id", row.data!.id);
    const answer = await newMessage();
    expect(answer.status).toBe(200);
    await answer.text();
    const prompt = JSON.stringify(calls[0].prompt);
    expect(prompt).toContain(WRITTEN.toolCallId);
    expect(prompt).not.toContain(READ.toolCallId);
    expect(prompt).not.toContain("I should read the mail");
  }, 60_000);

  it("a turn that goes on keeps its place in the conversation", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const first = await POST(goesOn({ ok: true }));
    expect(first.status).toBe(200);
    const elsewhere = await serviceClient().from("chat_messages").insert({ owner_id: user!.id, node_id: null, role: "user", parts: [{ type: "text", text: "From another tab" }] });
    if (elsewhere.error) throw new Error(elsewhere.error.message);
    await first.text();
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "user"]);
    expect(rows[1].parts.some((part) => part.type === "text" && part.text === "Here is what arrived.")).toBe(true);
    expect(leftUnfinished(rows[1])).toBe(false);
  }, 60_000);

  it("another person's turn is neither read nor written", async () => {
    await leaveOpen();
    const stored = (await history())[1];
    expect((await stranger!.client.from("chat_messages").select("id").eq("id", stored.id)).data).toEqual([]);
    expect((await stranger!.client.from("chat_messages").update({ parts: [] }).eq("id", stored.id)).error?.code).toBe("42501");
    expect(toolPart((await history())[1])).toMatchObject({ toolCallId: READ.toolCallId, state: "input-available" });
  }, 60_000);

  it("an answer far larger than a read brings reaches the model as a read that failed, and is not kept", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const answer = await POST(goesOn("x".repeat(MAX_READ_ANSWER + 1)));
    expect(answer.status).toBe(200);
    await answer.text();
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].prompt).length).toBeLessThan(MAX_READ_ANSWER);
    expect(toolPart((await history())[1])).toMatchObject({ state: "output-error" });
  }, 60_000);

  it("a turn at its last step answers without asking for anything more", async () => {
    await leaveOpen(5);
    const { POST } = await import("@/app/api/chat/route");
    const answer = await POST(goesOn({ ok: true }));
    await answer.text();
    expect(calls).toHaveLength(1);
    expect(calls[0].toolChoice).toEqual({ type: "none" });
  }, 60_000);

  it("a model that fails on the way on says so, its read is not answered again, and the next message goes on from there", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    script = [{ type: "error", error: new Error("the model is down") }];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = await POST(goesOn({ ok: true }));
      expect(failed.status).toBe(200);
      expect(await failed.text()).toContain("The model did not answer");
    } finally {
      spy.mockRestore();
      script = answering;
    }
    expect((await POST(goesOn({ ok: true }))).status).toBe(409);
    const next = await POST(
      new Request(`${SITE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" },
        body: JSON.stringify({ nodeId: null, timeZone: "UTC", message: { id: "next", role: "user", parts: [{ type: "text", text: "Try again" }] } }),
      }),
    );
    expect(next.status).toBe(200);
    await next.text();
    expect(calls).toHaveLength(2);
    const last = (await history()).at(-1);
    expect(last?.parts.some((part) => part.type === "text" && part.text === "Here is what arrived.")).toBe(true);
  }, 60_000);

  it("a message that answers no open read is refused, and nothing is taken", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const stranger = new Request(`${SITE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" },
      body: JSON.stringify({ nodeId: null, timeZone: "UTC", message: { id: "x", role: "assistant", parts: [{ type: "text", text: "Hello" }] } }),
    });
    expect((await POST(stranger)).status).toBe(409);
    expect(calls).toHaveLength(0);
    expect((await history()).map((row) => row.role)).toEqual(["user", "assistant"]);
  }, 60_000);
});
