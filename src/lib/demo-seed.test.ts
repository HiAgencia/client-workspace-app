import { describe, expect, it } from "vitest";
import { DEMO_FIRST_STEP } from "./demo";
import { demoSeedTree } from "./demo-seed";

// The path the first screen points at is the one the seed plants: the landing, the demo's guide and the seed cannot drift.
function paths(nodes: ReturnType<typeof demoSeedTree>, parent = ""): string[] {
  return nodes.flatMap((node) => {
    const path = parent ? `${parent} / ${node.name}` : node.name;
    return [path, ...paths(node.children ?? [], path)];
  });
}

describe("the demo's first step", () => {
  it("is a project the seed plants", () => {
    expect(paths(demoSeedTree("2026-10-27"))).toContain(DEMO_FIRST_STEP);
  });
});
