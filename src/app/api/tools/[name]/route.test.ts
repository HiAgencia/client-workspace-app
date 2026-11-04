import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionContext = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, response: new Response(null, { status: 401 }) })));
vi.mock("@/lib/session-context", () => ({ sessionContext }));

const { POST } = await import("./route");

const NODE = "11111111-2222-4333-8444-555555555555";
const SITE = "http://localhost:8796";

function call(query: string, name = "list_mail") {
  const request = new Request(`${SITE}/api/tools/${name}${query}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE, Host: "localhost:8796" }, body: "{}" });
  return POST(request, { params: Promise.resolve({ name }) });
}

beforeEach(() => {
  sessionContext.mockClear();
});

describe("the reach of a call to a tool", () => {
  it("is everything the person reaches, without a scope", async () => {
    await call("");
    expect(sessionContext).toHaveBeenCalledWith("manual", undefined);
  });

  it("is that node and what is below it, with one", async () => {
    await call(`?scope=${NODE}`);
    expect(sessionContext).toHaveBeenCalledWith("manual", NODE);
  });

  it("is refused for what is no id, before anything reads the session", async () => {
    const answer = await call("?scope=everything");
    expect(answer.status).toBe(400);
    expect(sessionContext).not.toHaveBeenCalled();
  });
});
