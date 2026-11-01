import { after } from "next/server";
import { z } from "zod";
import { resetDemo, seedDemo, settleDemoTokens } from "@/lib/demo-seed";
import { json, problem, sameOrigin } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { serviceClient } from "@/lib/supabase/server";
import { validZone } from "@/lib/working-time";




const input = z.strictObject({ today: z.iso.date(), zone: z.string().min(1).max(64).optional() });


export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  const session = await sessionContext("manual");
  if (!session.ok) return session.response;
  if (!session.user.isAnonymous) return problem(403, "the demo workspace is planted only for demo sessions");
  let seeded: { planted: boolean };
  try {
    seeded = await seedDemo(session.ctx.db, body.value.today, body.value.zone);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return problem(500, "the demo could not be prepared: reload to try again");
  }
  
  
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




export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return problem(403, "the request must come from this site");
  const session = await sessionContext("manual");
  if (!session.ok) return session.response;
  if (!session.user.isAnonymous) return problem(403, "only a demo session starts over");
  try {
    await resetDemo(session.ctx.db);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return problem(500, "the demo could not start over");
  }
  return json({ ok: true });
}
