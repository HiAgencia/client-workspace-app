import { afterEach, describe, expect, it, vi } from "vitest";
import { tools } from "@/lib/tools/registry";
import { READ_TOOLS } from "@/lib/tools/read-tools";
import { get, post, tool } from "./client-api";


const cut = () => new Response(null, { status: 503 });
const cutWithText = () => new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } });
const fine = () => Response.json({ ok: true, value: 1 });
const ourRefusal = () => Response.json({ ok: false, message: "The session could not be checked. Try again." }, { status: 503 });

function answers(...responses: Array<() => Response>) {
  let call = 0;
  const fetched = vi.fn(async () => responses[Math.min(call++, responses.length - 1)]());
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the screens do with a cut request", () => {
  it("asks a read once more, and the person never hears of the cut", async () => {
    const fetched = answers(cut, fine);
    expect(await tool("get_tasks", {})).toEqual({ ok: true, value: 1 });
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("asks a GET once more, also when the cut comes as plain text", async () => {
    const fetched = answers(cutWithText, fine);
    expect(await get("/api/accounts")).toEqual({ ok: true, value: 1 });
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("says so when the second read is cut too, and does not ask a third time", async () => {
    const fetched = answers(cut, cut, fine);
    expect(await tool("get_tasks", {})).toEqual({ ok: false, message: "The server could not answer. Try again." });
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("never asks a write twice: it may have done its work before the cut", async () => {
    const fetched = answers(cut, fine);
    expect(await tool("create_task", { title: "Once" })).toEqual({ ok: false, message: "The server could not answer. Try again." });
    expect(fetched).toHaveBeenCalledTimes(1);
    const posted = answers(cut, fine);
    expect((await post("/api/nodes", { name: "Once" })).ok).toBe(false);
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it("does not repeat one of the app's own answers: it already said what happened", async () => {
    const fetched = answers(ourRefusal, fine);
    expect(await tool("get_tasks", {})).toEqual({ ok: false, message: "The session could not be checked. Try again." });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("calls a read exactly what the registry calls read-only", () => {
    expect([...READ_TOOLS].sort()).toEqual(tools.filter((t) => t.readOnly).map((t) => t.name).sort());
  });
});
