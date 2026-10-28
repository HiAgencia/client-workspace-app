import { z } from "zod";
import { seedDemo } from "@/lib/demo-seed";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";

// The visitor's calendar day, so what the demo makes due "today" is due on their Today screen. It is required: the
// server's own day is another zone's, and a demo dated from it would put "today" on the visitor's yesterday or tomorrow.
const input = z.strictObject({ today: z.iso.date() });

// "Try the demo": the anonymous visitor's own copy of the demo workspace, planted once.
export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  if (!session.user.isAnonymous) return problem(403, "the demo workspace is planted only for demo sessions");
  try {
    return json({ ok: true, ...(await seedDemo(session.ctx.db, body.value.today)) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return problem(500, "the demo could not be prepared: reload to try again");
  }
}
