import { afterEach, describe, expect, it, vi } from "vitest";
import { land } from "./focus-request";




const TITLE = '[data-item="task-1"] [data-item-title]';
const CONTROL = '[aria-controls="fold-1"]';
const CLOSED_FOLD = '.fold[data-open="false"]';
const CLOSED_ROWS = '.first-rows[data-open="false"]';

function page({ opensAfter = 1, folded = true, controlled = true, behindShowMore = false, seen = false } = {}) {
  const log: string[] = [];
  const fold = { id: "fold-1", dataset: { open: folded ? "false" : "true" }, getAnimations: () => [{ finished: Promise.resolve().then(() => log.push("fold opened")) }] };
  const row = { removeAttribute: () => {}, setAttribute: () => {}, offsetWidth: 0 };
  const body = {};
  const doc = {
    activeElement: body as unknown,
    body,
    querySelector: (selector: string) => {
      if (selector === TITLE) return title;
      if (selector === CONTROL && controlled) return control;
      return null;
    },
  };
  const title = {
    closest: (selector: string) => {
      if (selector === CLOSED_FOLD) return !behindShowMore && fold.dataset.open === "false" ? fold : null;
      if (selector === CLOSED_ROWS) return behindShowMore && fold.dataset.open === "false" ? fold : null;
      if (selector === "[data-item]") return row;
      return null;
    },
    
    checkVisibility: () => seen || fold.dataset.open === "true",
    focus: () => {
      log.push("focus");
      if (seen || fold.dataset.open === "true") doc.activeElement = title;
    },
    scrollIntoView: () => log.push("scroll"),
  };
  let frames = 0;
  let pressed = false;
  const control = {
    click: () => {
      log.push("click");
      pressed = true;
    },
  };
  
  const frame = (done: () => void) => {
    if (pressed && ++frames >= opensAfter) fold.dataset.open = "true";
    queueMicrotask(done);
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("requestAnimationFrame", frame);
  return { log, doc, title };
}

const target = { kind: "item", nodeId: "node-1", itemId: "task-1", title: "A task", type: "task" } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("landing on a place", () => {
  it("opens the closed fold that holds it, then focuses it, then scrolls once the room is made", async () => {
    const { log, doc, title } = page();
    await expect(land(target)).resolves.toBe("landed");
    expect(doc.activeElement).toBe(title);
    expect(log.filter((entry) => entry === "click")).toHaveLength(1);
    expect(log.indexOf("click")).toBeLessThan(log.indexOf("focus"));
    expect(log.indexOf("fold opened")).toBeLessThan(log.indexOf("scroll"));
  });

  it("waits the frames the fold takes to open before focusing", async () => {
    const { doc, title } = page({ opensAfter: 4 });
    await expect(land(target)).resolves.toBe("landed");
    expect(doc.activeElement).toBe(title);
  });

  it("presses nothing when the place is not inside a closed fold", async () => {
    const { log } = page({ folded: false });
    await expect(land(target)).resolves.toBe("landed");
    expect(log).not.toContain("click");
  });

  it("says the place is hidden when nothing opens its fold", async () => {
    const { log } = page({ controlled: false });
    await expect(land(target)).resolves.toBe("hidden");
    expect(log).not.toContain("scroll");
  });

  it("says the place is hidden when the fold does not open in time, without waiting for ever", async () => {
    const { log } = page({ opensAfter: 1_000 });
    await expect(land(target)).resolves.toBe("hidden");
    expect(log).toContain("click");
  });

  it("opens the rows a box keeps behind «Show N more» for a place among them", async () => {
    const { log, doc, title } = page({ behindShowMore: true });
    await expect(land(target)).resolves.toBe("landed");
    expect(doc.activeElement).toBe(title);
    expect(log.indexOf("click")).toBeLessThan(log.indexOf("focus"));
    expect(log.indexOf("fold opened")).toBeLessThan(log.indexOf("scroll"));
  });

  it("leaves a long list closed for a place among its first rows, which is in view already", async () => {
    const { log, doc, title } = page({ behindShowMore: true, seen: true });
    await expect(land(target)).resolves.toBe("landed");
    expect(doc.activeElement).toBe(title);
    expect(log).not.toContain("click");
  });

  it("says a place that is not on the page is missing", async () => {
    page();
    await expect(land({ ...target, itemId: "another-task" })).resolves.toBe("missing");
  });
});
