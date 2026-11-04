import { afterEach, describe, expect, it, vi } from "vitest";
import { today } from "@/lib/dates";
import { toolKey } from "./client-api";
import { EARLY_TREE, treeInput } from "./early-reads";

afterEach(() => {
  vi.unstubAllGlobals();
});

function runScript() {
  const fetched = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ ok: true }));
  const window = { AbortSignal } as unknown as { __cwEarly?: Record<string, Promise<Response>> };
  vi.stubGlobal("window", window);
  vi.stubGlobal("fetch", fetched);
  new Function(EARLY_TREE)();
  return { fetched, started: window.__cwEarly ?? {} };
}

describe("the read the page's HTML starts", () => {
  it("is the very read the shell asks for the person's day, under the name the app looks it up by", () => {
    const { fetched, started } = runScript();
    expect(Object.keys(started)).toEqual([toolKey("list_tree", treeInput(today()))]);
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe("/api/tools/list_tree");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(treeInput(today()));
  });

  it("never stops the page when it cannot start", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", () => {
      throw new Error("no fetch here");
    });
    expect(() => new Function(EARLY_TREE)()).not.toThrow();
  });
});
