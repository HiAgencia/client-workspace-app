import type { Db } from "@/lib/db/client";
import { inlineLink } from "@/lib/inline-links";
import { workingMinutesBefore } from "@/lib/working-time";

// The demo workspace each visitor gets as their own copy: a small agency with three clients and their projects, and
// projects of its own beside them —its website, its operations, a component library it reuses—, and the general work that
// belongs to no client or project. It carries the work such a team has in a normal week: tasks due around today and some
// late, one at an hour, tasks without a date in the order the person set by hand, a task with its subtasks and notes,
// notes in nodes, in tasks, and loose, links over the words of a note, decisions, a review a coding agent asked for,
// events of the workspace's own, one of them linked to a project, and an item that already left a version, written over
// the past working days by hand, by the chat, and by a coding agent whose tokens Settings lists. Each item the chat wrote
// has the conversation that wrote it. It also carries the gaps a real workspace has: a client with one project, a project
// with no notes, tasks without a date or a description. The shape lives here for the tests and the landing; the database
// plants it through `public.seed_demo`, one statement and one round trip, and a test keeps both sides equal.

export type SeedSource = { source: "chat" } | { source: "agent"; agentLabel: string };

// The chat turn that wrote an item: the person's request a minute before, and the answer with the tool call at its moment.
// `workspace` puts it in the workspace's own conversation instead of the node's.
export type SeedChat = { ask: string; answer: string; workspace?: true };

export type SeedItem = {
  tool: "create_task" | "add_note" | "add_decision" | "request_review";
  input: Record<string, unknown>;
  // What hangs from a task.
  children?: SeedItem[];
  // A title the item had before: its first version.
  was?: string;
  // How many working minutes (weekdays 09:00–18:00 in the visitor's zone) before the visitor's now it was written, and,
  // for a finished task, completed (`src/lib/working-time.ts`).
  ago: number;
  doneAgo?: number;
  // Who wrote it, when it was not the person by hand.
  by?: SeedSource;
  chat?: SeedChat;
  // Its place in the manual order of the tasks without a date, 1 first.
  rank?: number;
  // The message it waits for: the account it arrives in, and words of the sender.
  waitsFor?: { account: string; from: string };
};

// A sample message of a demo account: who sent it, what it says, and how many working minutes ago it arrived.
export type SeedMail = {
  from: { name: string; email: string };
  subject: string;
  snippet: string;
  text: string;
  ago: number;
  unread: boolean;
  important: boolean;
};

// A sample account of the demo, attached to the node it is declared on, with its messages (none, for one of them).
export type SeedAccount = { email: string; mail: SeedMail[] };

// An event of the workspace's own, a whole day, and the clients or projects it is linked to besides the node it lives in.
export type SeedEvent = { title: string; day: string; linkedTo?: string[] };

export type Seed = {
  name: string;
  // A root is a client or a project of the agency's own; below a client every node is a project, below a project a
  // subproject.
  kind?: "client" | "project";
  // A color the person gave it, from the product's palette; its subprojects show it.
  color?: string;
  children?: Seed[];
  items?: SeedItem[];
  events?: SeedEvent[];
  // The coding agent's tokens issued on this node: their label, and how many working minutes ago each was issued and last
  // used. Their hash is of bytes nobody holds, so none can be used.
  tokens?: SeedToken[];
  // The sample accounts attached here.
  accounts?: SeedAccount[];
};

export type SeedToken = { label: string; issued: number; lastUsed: number };

const AGENT_LABEL = "Laptop";
const AGENT = { source: "agent", agentLabel: AGENT_LABEL } as const;
const CHAT = { source: "chat" } as const;

const task = (input: Record<string, unknown>, extra: Omit<SeedItem, "tool" | "input">): SeedItem => ({ tool: "create_task", input, ...extra });
const note = (text: string, ago: number): SeedItem => ({ tool: "add_note", input: { text }, ago });
const decision = (title: string, rationale: string, ago: number): SeedItem => ({ tool: "add_decision", input: { decision: title, rationale }, ago });
// A link is a note whose text is the link: rich text the editor shows as a link, and a title that keeps it over its words.
const linkNote = (url: string, words: string, ago: number): SeedItem => note(`<p><a href="${url}">${words}</a></p>`, ago);

function dayCounter(today: string) {
  return (offset: number): string => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
}

// The work that belongs to no client or project: general tasks, with and without a date, one at an hour, one with its
// subtasks and a note; loose notes, the person's general notepad; and an event of no node, linked to a project.
export function demoGeneral(today: string): { items: SeedItem[]; events: SeedEvent[] } {
  const day = dayCounter(today);
  return {
    items: [
      task({ title: "Call the bank about the card limit", priority: 2, dueOn: day(0), dueTime: "11:30" }, { ago: 212 }),
      task({ title: "Book the dentist appointment", priority: 3, dueOn: day(3) }, { ago: 1388 }),
      task({ title: "Renew the passport before the trip", priority: 3 }, { ago: 2954, rank: 1 }),
      task({ title: "Check the flight prices to Lisbon", priority: 4 }, { ago: 1730, rank: 3 }),
      task(
        { title: "Plan the team offsite", priority: 3 },
        {
          ago: 3305,
          rank: 5,
          children: [
            task({ title: "Pick three possible dates", priority: 3 }, { ago: 3301 }),
            task({ title: "Ask the team about the budget", priority: 4 }, { ago: 3299 }),
            note("<p>Somewhere reachable by train.</p>", 2780),
          ],
        },
      ),
      note("<p><strong>Ideas for the November newsletter</strong></p><ul><li>The Larkspur launch</li><li>Three tips for a faster site</li></ul>", 604),
      note("<p>Ask the accountant whether the new laptop counts as an expense.</p>", 1975),
    ],
    events: [{ title: "Call with Studio Atlas", day: day(1), linkedTo: ["Studio Atlas / Brand refresh"] }],
  };
}

// Days are counted from the visitor's own calendar day, the one the Overview uses, not from the server's.
export function demoSeedTree(today: string): Seed[] {
  const day = dayCounter(today);
  return [
    {
      name: "Larkspur Bakery",
      kind: "client",
      color: "amber",
      accounts: [
        {
          email: "hello@larkspur.example",
          mail: [
            {
              from: { name: "Maya Chen", email: "maya@larkspur.example" },
              subject: "New photos for the homepage",
              snippet: "Here are the new product photos for the homepage: the croissants and the sourdough came out well.",
              text: "Hi!\n\nHere are the new product photos for the homepage: the croissants and the sourdough came out well.\n\nMaya",
              ago: 97,
              unread: true,
              important: true,
            },
            {
              from: { name: "Maya Chen", email: "maya@larkspur.example" },
              subject: "Re: Delivery date",
              snippet: "We would like the site live before the holiday orders start.",
              text: "We would like the site live before the holiday orders start.\n\nMaya",
              ago: 1652,
              unread: false,
              important: false,
            },
          ],
        },
      ],
      children: [
        {
          name: "Website",
          tokens: [{ label: AGENT_LABEL, issued: 1400, lastUsed: 326 }],
          items: [
            task(
              {
                title: "Send the homepage draft for review",
                notes: "<p>Use the <strong>approved</strong> photos only.</p>",
                priority: 1,
                dueOn: day(0),
                dueTime: "16:00",
              },
              {
                ago: 2294,
                children: [
                  task({ title: "Write the hero copy", priority: 2, dueOn: day(0) }, { ago: 2292 }),
                  task({ title: "Pick the three featured products", priority: 3 }, { ago: 2291 }),
                  task({ title: "Compress the hero photos", priority: 3 }, { ago: 2289, doneAgo: 431 }),
                  note("<p>The client prefers a warm, plain tone.</p>", 1907),
                  linkNote("https://www.figma.com/design/q7RkLm2XvT9bWc4NsYp1Ha/Larkspur-homepage", "Homepage draft", 791),
                ],
              },
            ),
            task({ title: "Collect product photos from the client", priority: 2, dueOn: day(-1) }, { ago: 3046 }),
            task(
              { title: "Confirm the delivery date with the client", priority: 3, dueOn: day(1) },
              {
                ago: 41,
                by: CHAT,
                chat: {
                  ask: "Add a task to confirm the delivery date with the client, for tomorrow.",
                  answer: "Added it to Larkspur Bakery / Website, due tomorrow.",
                },
              },
            ),
            task({ title: "Set up the staging site", priority: 3 }, { ago: 3427, doneAgo: 1113 }),
            decision("Online orders go through the existing POS", "<p>Avoids a <strong>second inventory</strong>.</p>", 2671),
            linkNote("https://docs.google.com/document/d/1Kx9vRt-Qm3LpZ7wYc2NbH8sJf5Ud0GaEo4TiWq6Vr_M/edit", "Project brief", 3812),
            note('<p><strong>Kickoff notes</strong></p><ul><li>Launch before the holidays</li><li><span class="tc-red">Orders through the POS</span></li></ul>', 3818),
          ],
          events: [{ title: "Homepage review with the client", day: day(1) }],
          children: [
            {
              name: "Ordering flow",
              items: [
                task({ title: "Map the pickup time slots", priority: 3, dueOn: day(2) }, { ago: 1534 }),
                // What the coding agent asked to look at: a task of the day it asked, in its node.
                {
                  tool: "request_review",
                  input: { title: "Review the checkout pull request", url: "https://github.com/larkspur-bakery/website/pull/48" },
                  ago: 326,
                  by: AGENT,
                },
              ],
            },
          ],
        },
        {
          name: "Social media",
          items: [
            task({ title: "Plan the November posts", priority: 3, dueOn: day(5) }, { ago: 1147 }),
            task({ title: "Draft a posting guide", priority: 4 }, { ago: 4574, rank: 7 }),
          ],
        },
      ],
    },
    {
      name: "Studio Atlas",
      kind: "client",
      color: "violet",
      accounts: [
        {
          email: "atlas@harborline.example",
          mail: [
            {
              from: { name: "Ana Ruiz", email: "ana@studioatlas.example" },
              subject: "Survey results",
              snippet: "The stakeholder survey closed yesterday: the results are in the attached summary.",
              text: "Hello,\n\nThe stakeholder survey closed yesterday: the results are in the attached summary.\n\nAna",
              ago: 301,
              unread: true,
              important: false,
            },
          ],
        },
      ],
      children: [
        {
          name: "Brand refresh",
          items: [
            task({ title: "Send the moodboard", priority: 2, dueOn: day(0) }, { ago: 1913 }),
            task({ title: "Book the photo session", priority: 3, dueOn: day(3) }, { ago: 1529 }),
            decision("Keep the current color palette", "<p>Printed stock is already ordered.</p>", 2283),
            task({ title: "Read the stakeholder survey results", priority: 3, dueOn: day(1) }, { ago: 742 }),
            task({ title: "Present two logo directions", priority: 2, dueOn: day(0) }, { ago: 2301, was: "Present logo directions" }),
          ],
          events: [{ title: "Photo session", day: day(3) }],
        },
      ],
    },
    {
      name: "Lumen Dental",
      kind: "client",
      // An account with no mail at all.
      accounts: [{ email: "lumen@harborline.example", mail: [] }],
      children: [
        {
          name: "Booking page",
          items: [
            task(
              { title: "Ask for the clinic's opening hours", priority: 3, dueOn: day(1) },
              {
                ago: 118,
                by: CHAT,
                chat: {
                  ask: "We need the clinic's opening hours for the booking form. Add a task for tomorrow.",
                  answer: "Added it to Lumen Dental / Booking page, due tomorrow.",
                },
              },
            ),
            task({ title: "Approve the booking form copy", priority: 3, dueOn: day(2) }, { ago: 509 }),
          ],
        },
      ],
    },
    {
      name: "Agency website",
      kind: "project",
      color: "blue",
      items: [
        task(
          { title: "Write the Larkspur case study", priority: 3, dueOn: day(4) },
          {
            ago: 1601,
            children: [
              task({ title: "Ask Larkspur for a short quote", priority: 3 }, { ago: 1598 }),
              task({ title: "Choose the before-and-after shots", priority: 4 }, { ago: 1596 }),
            ],
          },
        ),
        task({ title: "Update the portfolio page", priority: 4 }, { ago: 4763, rank: 4 }),
        decision("Show three case studies, not ten", "<p>Fewer projects, told in depth.</p>", 4127),
        linkNote("https://analytics.google.com/analytics/web/", "Site analytics", 6351),
        note("<p><strong>Ideas for the about page</strong></p><ul><li>How we work, in four steps</li><li>The team, with real photos</li></ul>", 1262),
      ],
      children: [{ name: "Blog", items: [task({ title: "Draft the post on pricing small sites", priority: 3, dueOn: day(6) }, { ago: 958 })] }],
    },
    {
      name: "Operations",
      kind: "project",
      accounts: [
        {
          email: "ops@harborline.example",
          mail: [
            {
              from: { name: "Developer Platform", email: "noreply@developers.example" },
              subject: "Your app review was approved",
              snippet: "Your app review was approved. Your app can now use the permissions it asked for.",
              text: "Hello,\n\nYour app review was approved. Your app can now use the permissions it asked for.\n\nThe Developer Platform team",
              ago: 182,
              unread: true,
              important: false,
            },
            {
              from: { name: "Coworking Hub", email: "billing@coworkinghub.example" },
              subject: "Your October invoice is ready",
              snippet: "Your invoice for October is ready to download.",
              text: "Your invoice for October is ready to download.\n\nCoworking Hub",
              ago: 2205,
              unread: false,
              important: false,
            },
          ],
        },
      ],
      items: [
        task(
          { title: "Send the October invoices", priority: 1, dueOn: day(-1) },
          { ago: 3171, children: [note("<p>Larkspur pays by bank transfer, not by card.</p>", 2410)] },
        ),
        task(
          { title: "Chase the Studio Atlas payment", priority: 2, dueOn: day(0) },
          {
            ago: 67,
            by: CHAT,
            chat: {
              ask: "Remind me to chase the Studio Atlas payment today.",
              answer: "Added it to Operations, due today, with high priority.",
              workspace: true,
            },
          },
        ),
        task({ title: "Renew the agency's domain", priority: 2, dueOn: day(2) }, { ago: 2378 }),
        task({ title: "File the quarterly taxes", priority: 2, dueOn: day(9) }, { ago: 4769 }),
        task(
          { title: inlineLink("Review the new contract template", "https://docs.google.com/document/d/1Zp4HwQe8TnB2xLv-Ka7RcM5yGs3Df9Uj0Nb6Wt_EoXi/edit"), priority: 3 },
          { ago: 437, rank: 2 },
        ),
        // Two tasks that wait for a message in the operations account: the approval already arrived, the transfer has not.
        task({ title: "Wait for the app review approval", priority: 2 }, { ago: 2880, rank: 6, waitsFor: { account: "ops@harborline.example", from: "Developer Platform" } }),
        task({ title: "Wait for the bank transfer", priority: 2, dueOn: day(0) }, { ago: 1490, waitsFor: { account: "ops@harborline.example", from: "Bayside Bank" } }),
        note("<p><strong>Payment terms</strong></p><p>Half up front, half on delivery; invoices due in 15 days.</p>", 7942),
      ],
      events: [
        { title: "Weekly planning", day: day(0) },
        { title: "Accountant call", day: day(2) },
      ],
    },
    {
      name: "Component library",
      kind: "project",
      tokens: [{ label: AGENT_LABEL, issued: 5300, lastUsed: 352 }],
      items: [
        task({ title: "Add the contact form block", priority: 3, dueOn: day(3) }, { ago: 352, by: AGENT }),
        task({ title: "Update the library's dependencies", priority: 3 }, { ago: 503, doneAgo: 466, by: AGENT }),
        task({ title: "Write the setup guide", priority: 4 }, { ago: 5402, rank: 8 }),
        decision("Keep the library on the same stack as client sites", "<p>One stack to maintain and to debug.</p>", 5081),
        linkNote("https://github.com/harborline-studio/component-library", "Component library repository", 5243),
      ],
    },
  ];
}

// What the landing says the demo holds, read from the same tree.
export function demoShape(): { clients: number; ownProjects: number } {
  const roots = demoSeedTree("2026-01-01");
  return { clients: roots.filter((node) => node.kind === "client").length, ownProjects: roots.filter((node) => node.kind === "project").length };
}

// Plants the demo only into an empty workspace, so reloading never duplicates it. One statement: it plants everything or
// nothing, so a cut in the middle leaves no partial tree to clean up. The zone places what it planted in the visitor's
// working hours; without it the database uses UTC.
export async function seedDemo(db: Db, today: string, zone?: string): Promise<{ planted: boolean }> {
  const { data, error } = await db.rpc("seed_demo", zone ? { p_today: today, p_zone: zone } : { p_today: today });
  if (error) throw new Error(`demo seed: ${error.message}`);
  return { planted: data === true };
}

// Empties a demo's own workspace so it can be planted again: the tests and the probe browser keep a few anonymous sessions
// and reuse them, because the project's anonymous sign-ups share a rate limit. The database refuses it for a session that
// is not a demo's.
export async function resetDemo(db: Db): Promise<{ reset: boolean }> {
  const { data, error } = await db.rpc("reset_demo");
  if (error) throw new Error(`demo reset: ${error.message}`);
  return { reset: data === true };
}

// When the demo's tokens were issued and last used. The person's role may write only a token's node, hash and label, so
// the server's client dates them once the seed planted them, filtering by the owner itself; a token it could not date
// is counted with its reason, and keeps the moment it was planted.
export async function settleDemoTokens(
  service: Db,
  ownerId: string,
  zone: string,
  now = new Date(),
): Promise<{ settled: number; failed: number; reasons: string[] }> {
  const { data: nodes, error } = await service.from("nodes").select("id, parent_id, name").eq("owner_id", ownerId);
  if (error) throw new Error(`demo tokens: reading the nodes: ${error.message}`);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pathOf = (id: string): string => {
    const names: string[] = [];
    for (let cursor = byId.get(id); cursor; cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined) names.unshift(cursor.name);
    return names.join(" / ");
  };
  const byPath = new Map(nodes.map((node) => [pathOf(node.id), node.id]));
  const declared: Array<{ path: string; token: SeedToken }> = [];
  const walk = (list: Seed[], parent: string) => {
    for (const node of list) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const token of node.tokens ?? []) declared.push({ path, token });
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(now.toISOString().slice(0, 10)), "");
  // Each token is its own row: they are dated at once.
  const written = await Promise.all(
    declared.map(async ({ path, token }): Promise<{ count: number; reason: string | null }> => {
      const nodeId = byPath.get(path);
      if (!nodeId) return { count: 0, reason: `${path}: no such node` };
      const { data, error: refused } = await service
        .from("agent_tokens")
        .update({ created_at: workingMinutesBefore(now, token.issued, zone).toISOString(), last_used_at: workingMinutesBefore(now, token.lastUsed, zone).toISOString() })
        .eq("node_id", nodeId)
        .eq("label", token.label)
        .select("id");
      if (refused) return { count: 0, reason: `${path}: ${refused.message}` };
      return data?.length ? { count: data.length, reason: null } : { count: 0, reason: `${path}: no token named ${token.label}` };
    }),
  );
  const reasons = written.flatMap((each) => (each.reason ? [each.reason] : []));
  return { settled: written.reduce((sum, each) => sum + each.count, 0), failed: reasons.length, reasons };
}
