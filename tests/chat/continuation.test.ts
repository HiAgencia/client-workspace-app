import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { isToolUIPart, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHistory } from "@/lib/chat/history";
import { leftAtARead, MAX_READ_ANSWER } from "@/lib/chat/browser-reads";
import type { Json } from "@/lib/db/types";
import type { ToolContext } from "@/lib/tools/context";
import { createDisposableUser, deleteDisposableUsers, type DisposableUser } from "../support/supabase";





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
        return { stream: simulateReadableStream({ chunks: script, chunkDelayInMs: pace }) };
      },
    }),
  }),
}));

const SITE = "http://localhost:8796";
const READ = { type: "tool-list_mail", toolCallId: "read-1", input: {} };
const WRITTEN = { type: "tool-create_task", toolCallId: "write-1", state: "output-available", input: { title: "Call the bank" }, output: { ok: true, item: { id: "x" } } };
const openTurn = (steps = 1) => [...Array.from({ length: steps - 1 }, () => ({ type: "step-start" })), { type: "step-start" }, { ...READ, state: "input-available" }];


async function leaveOpen(steps = 1, before: Json[] = []) {
  const gone = await user!.client.from("chat_messages").delete().is("node_id", null);
  if (gone.error) throw new Error(gone.error.message);
  const rows = [
    { node_id: null, role: "user", parts: [{ type: "text", text: "Read my mail" }] },
    { node_id: null, role: "assistant", parts: [...before, ...openTurn(steps)] },
  ];
  
  for (const row of rows) {
    const saved = await user!.client.from("chat_messages").insert(row);
    if (saved.error) throw new Error(saved.error.message);
  }
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
    
    expect(leftAtARead(rows[1])).toBe(true);
  }, 60_000);

  it("a turn that goes on keeps its place in the conversation", async () => {
    await leaveOpen();
    const { POST } = await import("@/app/api/chat/route");
    const first = await POST(goesOn({ ok: true }));
    expect(first.status).toBe(200);
    const elsewhere = await user!.client.from("chat_messages").insert({ node_id: null, role: "user", parts: [{ type: "text", text: "From another tab" }] });
    if (elsewhere.error) throw new Error(elsewhere.error.message);
    await first.text();
    const rows = await history();
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "user"]);
    expect(rows[1].parts.some((part) => part.type === "text" && part.text === "Here is what arrived.")).toBe(true);
    expect(leftAtARead(rows[1])).toBe(false);
  }, 60_000);

  it("another person's turn cannot be written, and only a message's parts can", async () => {
    await leaveOpen();
    const stored = (await history())[1];
    const before = await stranger!.client.from("chat_messages").update({ parts: [] }).eq("id", stored.id).select("id");
    expect(before.error).toBeNull();
    expect(before.data).toEqual([]);
    expect(toolPart((await history())[1])).toMatchObject({ toolCallId: READ.toolCallId, state: "input-available" });
    const moved = await user!.client.from("chat_messages").update({ role: "user" }).eq("id", stored.id);
    expect(moved.error?.code).toBe("42501");
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
