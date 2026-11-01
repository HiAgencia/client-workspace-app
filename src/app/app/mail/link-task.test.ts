import { describe, expect, it } from "vitest";
import { tasksMatching } from "./link-task";


const many = Array.from({ length: 500 }, (_, index) => ({ id: `t${index}`, title: `Follow up number ${index}`, path: index % 2 ? "Acme / Web" : null }));
const hidden = { id: "needle", title: "Call the [printer](https://printer.example) about the Invoice", path: "Larkspur Bakery" };
const tasks = [...many, hidden];

describe("finding the task a message links to", () => {
  it("finds any task by typing part of its title, however far it sits", () => {
    expect(tasksMatching(tasks, "printer about").map((task) => task.id)).toEqual(["needle"]);
    expect(tasksMatching(tasks, "INVOICE").map((task) => task.id)).toEqual(["needle"]);
    expect(tasksMatching(tasks, "number 499").map((task) => task.id)).toContain("t499");
  });

  it("finds it by its place, and with a typo in its words", () => {
    expect(tasksMatching(tasks, "Larkspur").map((task) => task.id)).toEqual(["needle"]);
    expect(tasksMatching(tasks, "invioce").map((task) => task.id)).toContain("needle");
  });

  it("with nothing typed offers every task, and each task once", () => {
    expect(tasksMatching(tasks, "  ")).toHaveLength(tasks.length);
    const found = tasksMatching(tasks, "Follow").map((task) => task.id);
    expect(new Set(found).size).toBe(found.length);
    expect(found).toHaveLength(many.length);
  });

  it("its twin: a list cut before the search does not reach the task", () => {
    const cut = (list: typeof tasks, query: string) => tasksMatching(list.slice(0, 40), query);
    expect(cut(tasks, "printer about")).toEqual([]);
    expect(cut(tasks, "number 499")).toEqual([]);
  });
});
