import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoSeedTree, type Seed } from "@/lib/demo-seed";
import { demoSender, nameSeed, portraitOf } from "./sender-art";

function senders(seeds: Seed[]): string[] {
  return seeds.flatMap((seed) => [...(seed.accounts ?? []).flatMap((account) => account.mail.map((message) => message.from.email)), ...senders(seed.children ?? [])]);
}

function plantedSenders(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const last = readdirSync(dir)
    .filter((name) => readFileSync(join(dir, name), "utf8").includes("plant_demo_mail(jsonb_build_array("))
    .sort()
    .at(-1);
  if (!last) return [];
  return [...readFileSync(join(dir, last), "utf8").matchAll(/'from_email', '([^']+)'/g)].map((match) => match[1]);
}

describe("the demo's senders, drawn", () => {
  it("draws every sender of the demo's mail, as the tree and the migration plant it", () => {
    const planted = plantedSenders();
    expect(planted.length).toBeGreaterThan(0);
    const all = [...new Set([...senders(demoSeedTree("2026-01-05")), ...planted])];
    expect(all.filter((email) => demoSender(email) === null)).toEqual([]);
  });

  it("knows a company by its sign and a person by a portrait, whatever the address's capitals", () => {
    expect(demoSender("noreply@developers.example")).toBe("platform");
    expect(demoSender("Maya@Larkspur.example")).toBe("person");
  });

  it("never draws a real sender, however close its name or address", () => {
    expect(demoSender("maya@larkspur.com")).toBeNull();
    expect(demoSender("someone@outlook.com")).toBeNull();
    expect(demoSender("stranger@elsewhere.example")).toBeNull();
    expect(demoSender(null)).toBeNull();
  });

  it("draws the same person for the same name, and reads every trait within its set", () => {
    expect(portraitOf(nameSeed("Maya Chen"))).toEqual(portraitOf(nameSeed("maya chen")));
    for (const name of ["Maya Chen", "Ana Ruiz", "Priya Shah", "Tom", "李雷"]) {
      const { skin, hair, style } = portraitOf(nameSeed(name));
      expect(skin).toBeGreaterThanOrEqual(1);
      expect(skin).toBeLessThanOrEqual(5);
      expect(hair).toBeGreaterThanOrEqual(1);
      expect(hair).toBeLessThanOrEqual(5);
      expect(style).toBeGreaterThanOrEqual(0);
      expect(style).toBeLessThan(5);
    }
  });
});
