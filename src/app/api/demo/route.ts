import { after } from "next/server";
import { z } from "zod";
import { resetDemo, seedDemo, settleDemoTokens } from "@/lib/demo-seed";
import { json, problem, sameOrigin } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { serviceClient } from "@/lib/supabase/server";
import { validZone } from "@/lib/working-time";

// The visitor's calendar day, so what the demo makes due "today" is due in the Overview's Tasks of today. It is required:
// the server's own day is another zone's, and a demo dated from it would put "today" on the visitor's yesterday or
// tomorrow. The zone, optional, dates what the demo planted in the visitor's working hours; an unknown one reads as UTC.
const input = z.strictObject({ today: z.iso.date(), zone: z.string().min(1).max(64).optional() });

// "Try the demo": the anonymous visitor's own copy of the demo workspace, planted once.
export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  if (!session.user.isAnonymous) return problem(403, "the demo workspace is planted only for demo sessions");
  let seeded: { planted: boolean };
  try {
    seeded = await seedDemo(session.ctx.db, body.value.today, body.value.zone);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return problem(500, "the demo could not be prepared: reload to try again");
  }
  // The tokens' moments are the server's to write, once the answer left: the visitor goes in on the seed alone, and a demo
  // whose tokens keep their planting moment still works, so a failure here is logged with its count.
  if (seeded.planted) {
    const owner = session.user.id;
    const zone = validZone(body.value.zone);
    after(async () => {
      try {
        const tokens = await settleDemoTokens(serviceClient(), owner, zone);
        if (tokens.failed > 0) console.error(`demo: ${tokens.failed} agent tokens kept the moment they were planted: ${tokens.reasons.join("; ")}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    });
  }
  return json({ ok: true, ...seeded });
}

// A demo starts over: the visitor's own copy is emptied, so the next read plants it again. The tests and the probe browser
// keep a few demo sessions and reuse them, and this is how each use begins from the same workspace (the project's
// anonymous sign-ups share a rate limit, and one session per step ran into it).
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return problem(403, "the request must come from this site");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  if (!session.user.isAnonymous) return problem(403, "only a demo session starts over");
  try {
    await resetDemo(session.ctx.db);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return problem(500, "the demo could not start over");
  }
  return json({ ok: true });
}
