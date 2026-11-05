import { describe, expect, it } from "vitest";
import { linesOf, taskPayload } from "./create-task";

describe("creating a task", () => {
  it("keeps a written day, place and priority in the title", () => {
    const payload = taskPayload({
      title: "Call the printer tomorrow 4pm #Website p2",
      day: null,
      time: null,
      placeId: null,
      priority: 4,
      description: "",
      subtasks: [],
      notes: [],
    });
    expect(payload.title).toBe("Call the printer tomorrow 4pm #Website p2");
    expect(payload.node).toBeNull();
    expect(payload.priority).toBe(4);
    expect(payload.dueOn).toBeUndefined();
    expect(payload.dueTime).toBeUndefined();
  });

  it("sends only what the dropdowns and the fields hold", () => {
    const payload = taskPayload({
      title: "  Call the printer  ",
      day: "2026-11-05",
      time: "16:00",
      placeId: "website",
      parentId: "parent",
      priority: 2,
      description: " Menu cards ",
      subtasks: ["Confirm the stock", "  "],
      notes: ["Ask for the proof"],
    });
    expect(payload).toEqual({
      title: "Call the printer",
      node: "website",
      parent: "parent",
      priority: 2,
      notes: "Menu cards",
      dueOn: "2026-11-05",
      dueTime: "16:00",
      subtasks: ["Confirm the stock"],
      notesToAdd: ["Ask for the proof"],
    });
  });

  it("reads one line per subtask or note", () => {
    expect(linesOf(" One \n\nTwo ")).toEqual(["One", "Two"]);
  });
});
