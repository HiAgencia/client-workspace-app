import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/chat/wav";
import { callTool } from "@/lib/tools/registry";
import type { ToolContext } from "@/lib/tools/context";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";





let user: DisposableUser | undefined;

vi.mock("@/lib/session-context", () => ({
  sessionContext: async () => {
    const ctx: ToolContext = { db: user!.client, ownerId: user!.id, source: "chat" };
    return { ok: true, ctx, user: { id: user!.id, isAnonymous: false } };
  },
}));
vi.mock("@/lib/supabase/server", async (actual) => ({
  ...(await actual<typeof import("@/lib/supabase/server")>()),
  userClient: async () => user!.client,
  requireUser: async () => ({ ok: true, user: { id: user!.id, isAnonymous: false } }),
}));

const SITE = "http://localhost:8796";
const realFetch = globalThis.fetch;
const asked: string[] = [];
const toModel = () => asked.filter((url) => url.includes("api.meta.ai"));

function watchRequests() {
  asked.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    if (url.includes("api.meta.ai")) return new Response(JSON.stringify({ transcript: "From the model" }), { status: 200 });
    return realFetch(input, init);
  });
}

function sendsMessage() {
  return new Request(`${SITE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" },
    body: JSON.stringify({ nodeId: null, timeZone: "UTC", message: { id: "m1", role: "user", parts: [{ type: "text", text: "What is pending?" }] } }),
  });
}

function sendsNote() {
  const form = new FormData();
  form.append("audio", new Blob([encodeWav(new Float32Array(2400))], { type: "audio/wav" }), "note.wav");
  return new Request(`${SITE}/api/transcribe`, { method: "POST", headers: { Origin: SITE, Host: "localhost:8796" }, body: form });
}

const usage = async () => (await serviceClient().from("usage_counters").select("kind, count").eq("owner_id", user!.id)).data ?? [];

beforeAll(async () => {
  user = await createDisposableUser("ai-off");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each([
  ["without a value", ""],
  ["with a value it does not know", "Meta"],
])("the AI off, the variable %s", (_name, value) => {
  it("the chat and an image say so, without asking anything of anyone", async () => {
    vi.stubEnv("MODEL_PROVIDER", value);
    const { POST } = await import("@/app/api/chat/route");
    watchRequests();
    const answer = await POST(sendsMessage());
    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ ok: false, code: "off", message: expect.stringMatching(/^Muse is not available/) });
    expect(asked, "no request left the server").toEqual([]);
  });

  it("the voice says so, and its probe hides the microphone, without asking any model", async () => {
    vi.stubEnv("MODEL_PROVIDER", value);
    vi.stubEnv("MODEL_API_KEY", "a-key");
    const { GET, POST } = await import("@/app/api/transcribe/route");
    watchRequests();
    const answer = await POST(sendsNote());
    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ ok: false, code: "off", message: expect.stringMatching(/^Muse is not available/) });
    expect(asked, "no request left the server").toEqual([]);
    expect(await (await GET()).json()).toEqual({ ok: true, available: false });
    expect(toModel()).toEqual([]);
  });

  it("takes no unit of the day and stores no message", async () => {
    vi.stubEnv("MODEL_PROVIDER", value);
    const { POST } = await import("@/app/api/chat/route");
    await POST(sendsMessage());
    expect(await usage()).toEqual([]);
    expect((await user!.client.from("chat_messages").select("id")).data).toEqual([]);
  });

  it("the panel reads the conversation with the sentence that takes the place of its message box", async () => {
    vi.stubEnv("MODEL_PROVIDER", value);
    const { GET } = await import("@/app/api/chat/route");
    const { NextRequest } = await import("next/server");
    const answer = await (await GET(new NextRequest(`${SITE}/api/chat`))).json();
    expect(answer).toMatchObject({ ok: true, messages: [], off: expect.stringMatching(/^Muse is not available/) });
  });

  it("the rest of the app works the same: a task is written and read", async () => {
    vi.stubEnv("MODEL_PROVIDER", value);
    const ctx: ToolContext = { db: user!.client, ownerId: user!.id, source: "manual" };
    const made = await callTool("create_task", ctx, { node: null, title: "Call the bank" });
    expect(made.ok).toBe(true);
    const listed = (await callTool("list_items", ctx, { node: null })) as unknown as { ok: boolean; items: Array<{ title: string }> };
    expect(listed.items.map((item) => item.title)).toContain("Call the bank");
  });
});


describe("its twins, the AI on", () => {
  it("the simulated chat answers the same request", async () => {
    vi.stubEnv("MODEL_PROVIDER", "simulated");
    const { GET, POST } = await import("@/app/api/chat/route");
    const answer = await POST(sendsMessage());
    expect(answer.status).toBe(200);
    await answer.text();
    const { NextRequest } = await import("next/server");
    expect(await (await GET(new NextRequest(`${SITE}/api/chat`))).json()).toMatchObject({ ok: true, off: null });
  });

  it("the same note reaches Meta's model, and the spy sees it", async () => {
    vi.stubEnv("MODEL_PROVIDER", "meta");
    vi.stubEnv("MODEL_API_KEY", "a-key");
    const { GET, POST } = await import("@/app/api/transcribe/route");
    watchRequests();
    const answer = await POST(sendsNote());
    expect(await answer.json()).toEqual({ ok: true, text: "From the model" });
    expect(toModel()).toHaveLength(1);
    expect(await (await GET()).json()).toEqual({ ok: true, available: true });
  });
});
