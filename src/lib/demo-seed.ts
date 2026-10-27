import type { Db } from "@/lib/db/client";






type Seed = { name: string; children?: Seed[]; items?: Array<[tool: string, input: Record<string, unknown>]> };



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
          ["create_task", { title: "Send the homepage draft for review", priority: 1, dueOn: day(0) }],
          ["create_task", { title: "Collect product photos from the client", priority: 2, dueOn: day(-1) }],
          ["add_decision", { decision: "Online orders go through the existing POS", rationale: "Avoids a second inventory." }],
          ["add_link", { url: "https://example.com/northwind/brief", title: "Project brief" }],
        ],
        children: [
          {
            name: "Ordering flow",
            items: [
              ["create_task", { title: "Map the pickup time slots", priority: 3, dueOn: day(2) }],
              ["add_review", { title: "Client feedback on the checkout mockup", url: "https://example.com/northwind/checkout" }],
            ],
          },
        ],
      },
      {
        name: "Social media",
        items: [["create_task", { title: "Plan the November posts", priority: 3, dueOn: day(5) }]],
      },
    ],
  },
  {
    name: "Studio Atlas",
    children: [
      {
        name: "Brand refresh",
        items: [
          ["create_task", { title: "Present two logo directions", priority: 2, dueOn: day(0) }],
          ["create_task", { title: "Book the photo session", priority: 3, dueOn: day(3) }],
          ["add_decision", { decision: "Keep the current color palette", rationale: "Printed stock is already ordered." }],
          ["add_review", { title: "Read the stakeholder survey results" }],
        ],
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
