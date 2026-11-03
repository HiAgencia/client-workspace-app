import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetLastNode, lastNode, rememberLastNode } from "./last-node";


const store = new Map<string, string>();
let cookie = "";
function signedInAs(id: string | null) {
  cookie = id ? `sb-project-auth-token=${encodeURIComponent(JSON.stringify({ user: { id } }))}; other=1` : "other=1";
}

beforeEach(() => {
  store.clear();
  Object.assign(globalThis, {
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
    document: {
      get cookie() {
        return cookie;
      },
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "document");
});

describe("where a session resumes", () => {
  it("resumes on the last node its own person opened", () => {
    signedInAs("person-a");
    rememberLastNode("node-1");
    expect(lastNode()).toBe("node-1");
  });

  it("does not resume on a node of another session, such as the demo's before signing in with Google", () => {
    signedInAs("demo-session");
    rememberLastNode("demo-node");
    signedInAs("person-a");
    expect(lastNode()).toBeNull();
  });

  it("reads a value kept before it carried its owner, or one forgotten, as none", () => {
    signedInAs("person-a");
    store.set("client-workspace:last-node", "node-1");
    expect(lastNode()).toBeNull();
    rememberLastNode("node-2");
    forgetLastNode();
    expect(lastNode()).toBeNull();
  });
});
