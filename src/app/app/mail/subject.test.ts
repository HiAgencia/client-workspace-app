import { describe, expect, it } from "vitest";
import { subjectOf, taskLine } from "./subject";

describe("what a message says of the task it is linked to", () => {
  it("says nothing without a task", () => {
    expect(taskLine({ tasks: [] })).toBeNull();
  });

  it("names the open task", () => {
    expect(taskLine({ tasks: [{ title: "Send the draft", status: "open" }] })).toEqual({ text: "For: Send the draft", done: false });
  });

  it("names a task already done as done", () => {
    expect(taskLine({ tasks: [{ title: "Send the draft", status: "done" }] })).toEqual({ text: "Completed task: Send the draft", done: true });
  });

  it("prefers the open task, wherever it sits", () => {
    expect(
      taskLine({
        tasks: [
          { title: "Send the draft", status: "done" },
          { title: "Book the photographer", status: "open" },
        ],
      }),
    ).toEqual({ text: "For: Book the photographer", done: false });
  });

  it("reads a title's link as its words", () => {
    expect(taskLine({ tasks: [{ title: "[Review](https://example.com/1) the draft", status: "open" }] })?.text).toBe("For: Review the draft");
  });
});

describe("a message without a subject", () => {
  it("says so in the same words", () => {
    expect(subjectOf({ subject: "  " })).toBe("(No subject)");
    expect(subjectOf({ subject: "Hola" })).toBe("Hola");
  });
});
