import type { Db } from "@/lib/db/client";







export type SeedItem = {
  tool: "create_task" | "add_note" | "add_decision" | "add_link" | "add_review";
  input: Record<string, unknown>;
  
  children?: SeedItem[];
  
  was?: string;
};

export type Seed = { name: string; children?: Seed[]; items?: SeedItem[]; events?: Array<{ title: string; day: string }> };

const task = (input: Record<string, unknown>, extra: Partial<SeedItem> = {}): SeedItem => ({ tool: "create_task", input, ...extra });



export function demoSeedTree(today: string): Seed[] {
  const day = (offset: number): string => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return [
    {
      name: "Northwind Bakery",
      children: [
        {
          name: "Website",
          items: [
            task(
              { title: "Send the homepage draft for review", notes: "<p>Use the <strong>approved</strong> photos only.</p>", priority: 1, dueOn: day(0) },
              {
                children: [
                  task({ title: "Write the hero copy", priority: 2, dueOn: day(0) }),
                  task({ title: "Pick the three featured products", priority: 3 }),
                  { tool: "add_note", input: { text: "<p>The client prefers a warm, plain tone.</p>" } },
                  { tool: "add_link", input: { url: "https://example.com/northwind/homepage-draft", title: "Homepage draft" } },
                ],
              },
            ),
            task({ title: "Collect product photos from the client", priority: 2, dueOn: day(-1) }),
            { tool: "add_decision", input: { decision: "Online orders go through the existing POS", rationale: "<p>Avoids a <strong>second inventory</strong>.</p>" } },
            { tool: "add_link", input: { url: "https://example.com/northwind/brief", title: "Project brief" } },
            {
              tool: "add_note",
              input: {
                text: '<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>',
              },
            },
          ],
          events: [{ title: "Homepage review with the client", day: day(1) }],
          children: [
            {
              name: "Ordering flow",
              items: [
                task({ title: "Map the pickup time slots", priority: 3, dueOn: day(2) }),
                { tool: "add_review", input: { title: "Client feedback on the checkout mockup", url: "https://example.com/northwind/checkout" } },
              ],
            },
          ],
        },
        {
          name: "Social media",
          items: [task({ title: "Plan the November posts", priority: 3, dueOn: day(5) }), task({ title: "Draft a posting guide", priority: 4 })],
        },
      ],
    },
    {
      name: "Studio Atlas",
      children: [
        {
          name: "Brand refresh",
          items: [
            task({ title: "Send the moodboard", priority: 2, dueOn: day(0) }),
            task({ title: "Book the photo session", priority: 3, dueOn: day(3) }),
            { tool: "add_decision", input: { decision: "Keep the current color palette", rationale: "<p>Printed stock is already ordered.</p>" } },
            { tool: "add_review", input: { title: "Read the stakeholder survey results" } },
            task({ title: "Present two logo directions", priority: 2, dueOn: day(0) }, { was: "Present logo directions" }),
          ],
          events: [{ title: "Photo session", day: day(3) }],
        },
      ],
    },
  ];
}



export async function seedDemo(db: Db, today: string): Promise<{ planted: boolean }> {
  const { data, error } = await db.rpc("seed_demo", { p_today: today });
  if (error) throw new Error(`demo seed: ${error.message}`);
  return { planted: data === true };
}
