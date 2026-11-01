import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { continuedTurn, leftUnfinished, openCall, stepsTaken, turnGoesOn, whatWasDone } from "./browser-reads";

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

  it("names the call left open as the database holds it, and a turn with nothing open has none to take", () => {
    expect(openCall(stored)).toEqual({ toolCallId: "1", state: "input-available" });
    expect(() => openCall(assistant("r", written("w")))).toThrow();
  });
});

describe("a turn left unfinished", () => {
  it("is one whose last step called a tool, answered or not", () => {
    expect(leftUnfinished(assistant("m", { type: "step-start" }, read("1")))).toBe(true);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, answer("1")))).toBe(true);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, written("w")))).toBe(true);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, written("w"), { type: "step-start" }, answer("1")))).toBe(true);
  });

  it("is one whose last step says nothing, or was still saying it", () => {
    expect(leftUnfinished(assistant("m", { type: "step-start" }))).toBe(true);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, written("w"), { type: "step-start" }))).toBe(true);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, { type: "text", text: "Here is", state: "streaming" }))).toBe(true);
  });

  it("is not one that answered in words, nor a person's message", () => {
    expect(leftUnfinished(assistant("m", { type: "step-start" }, answer("1"), { type: "step-start" }, { type: "text", text: "Done", state: "done" }))).toBe(false);
    expect(leftUnfinished(assistant("m", { type: "step-start" }, { type: "text", text: "Done" }))).toBe(false);
    expect(leftUnfinished({ id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] })).toBe(false);
  });
});

describe("what a turn did", () => {
  const thought = { type: "reasoning", text: "Thinking", state: "done" } as UIMessage["parts"][number];
  const said = { type: "text", text: "Here is", state: "streaming" } as UIMessage["parts"][number];
  const types = (message: UIMessage) => message.parts.map((part) => part.type);

  it("keeps the calls that have their answer and what it said, and drops the ones left open", () => {
    const done = whatWasDone(assistant("m", { type: "step-start" }, answer("1"), read("2"), written("w"), { type: "step-start" }, said));
    expect(done.parts.map((part) => ("toolCallId" in part ? part.toolCallId : part.type))).toEqual(["step-start", "1", "w", "step-start", "text"]);
  });

  it("drops a reasoning with nothing after it in its step, however many came together", () => {
    expect(types(whatWasDone(assistant("m", { type: "step-start" }, thought, read("1"))))).toEqual(["step-start"]);
    expect(types(whatWasDone(assistant("m", { type: "step-start" }, thought, thought)))).toEqual(["step-start"]);
    expect(types(whatWasDone(assistant("m", { type: "step-start" }, thought, { type: "step-start" }, said)))).toEqual(["step-start", "step-start", "text"]);
  });

  it("keeps a reasoning followed by what the step did", () => {
    expect(types(whatWasDone(assistant("m", { type: "step-start" }, thought, written("w"), read("1"))))).toEqual(["step-start", "reasoning", "tool-create_task"]);
    expect(types(whatWasDone(assistant("m", { type: "step-start" }, thought, said)))).toEqual(["step-start", "reasoning", "text"]);
    expect(types(whatWasDone(assistant("m", thought, thought, said)))).toEqual(["reasoning", "reasoning", "text"]);
  });

  it("leaves a person's message as it came", () => {
    const person: UIMessage = { id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] };
    expect(whatWasDone(person)).toBe(person);
  });
});

describe("the bound of a turn", () => {
  it("counts the steps a turn already took, and none for a person's new message", () => {
    expect(stepsTaken([assistant("m", { type: "step-start" }, read("1"), { type: "step-start" }, read("2"))])).toBe(2);
    expect(stepsTaken([{ id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] }])).toBe(0);
  });
});
