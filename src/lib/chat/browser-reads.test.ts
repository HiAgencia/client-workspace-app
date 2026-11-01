import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { continuedTurn, stepsTaken, turnGoesOn } from "./browser-reads";

const read = (toolCallId: string, extra: Record<string, unknown> = { state: "input-available" }) => ({ type: "tool-list_mail", toolCallId, input: { account: "a" }, ...extra }) as unknown as UIMessage["parts"][number];
const written = (toolCallId: string) => ({ type: "tool-create_task", toolCallId, input: {}, state: "output-available", output: { ok: true } }) as UIMessage["parts"][number];
const answer = (toolCallId: string, output: unknown = { ok: true }) => read(toolCallId, { state: "output-available", output });
const assistant = (id: string, ...parts: UIMessage["parts"]): UIMessage => ({ id, role: "assistant", parts });

describe("whether the browser sends the turn on", () => {
  it("does when every call of a step that asked for a read has its answer", () => {
    expect(turnGoesOn({ messages: [assistant("m", { type: "step-start" }, answer("1"), answer("2"))] })).toBe(true);
    expect(turnGoesOn({ messages: [assistant("m", { type: "step-start" }, answer("1"), read("2"))] })).toBe(false);
  });

  it("does not for a step whose tools all ran on the server: that would answer the same turn twice", () => {
    expect(turnGoesOn({ messages: [assistant("m", { type: "step-start" }, written("1"))] })).toBe(false);
    expect(turnGoesOn({ messages: [assistant("m", { type: "step-start" }, written("1"), { type: "step-start" }, { type: "text", text: "Done" })] })).toBe(false);
  });

  it("does not for an earlier step's read once a later one answered", () => {
    expect(turnGoesOn({ messages: [assistant("m", { type: "step-start" }, answer("1"), { type: "step-start" }, { type: "text", text: "Nothing new" })] })).toBe(false);
  });
});

describe("the turn the browser continues", () => {
  const stored = assistant("row", { type: "step-start" }, written("w"), read("1"), read("2"));

  it("takes only the answers of the reads left open, over what was stored", () => {
    const sent = assistant("screen", { type: "text", text: "made up by the browser" }, answer("1", { ok: true, n: 1 }), answer("2", { ok: true, n: 2 }), written("w"));
    const merged = continuedTurn(stored, sent);
    expect(merged?.id).toBe("screen");
    expect(merged?.parts).toEqual([{ type: "step-start" }, written("w"), answer("1", { ok: true, n: 1 }), answer("2", { ok: true, n: 2 })]);
  });

  it("refuses a read without its answer, a message with nothing open, and a write left open", () => {
    expect(continuedTurn(stored, assistant("s", answer("1")))).toBeNull();
    expect(continuedTurn(assistant("r", written("w")), assistant("s", written("w")))).toBeNull();
    expect(continuedTurn(undefined, assistant("s", answer("1")))).toBeNull();
    const writeOpen = assistant("r", { type: "tool-create_task", toolCallId: "w", input: {}, state: "input-available" } as UIMessage["parts"][number]);
    expect(continuedTurn(writeOpen, assistant("s", { type: "tool-create_task", toolCallId: "w", input: {}, state: "output-available", output: { ok: true } } as UIMessage["parts"][number]))).toBeNull();
  });
});

describe("the bound of a turn", () => {
  it("counts the steps a turn already took, and none for a person's new message", () => {
    expect(stepsTaken([assistant("m", { type: "step-start" }, read("1"), { type: "step-start" }, read("2"))])).toBe(2);
    expect(stepsTaken([{ id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] }])).toBe(0);
  });
});
