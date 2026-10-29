import { z } from "zod";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";

// A message the person opened here. Gmail is read only, so this is the product's own mark: it is no longer counted as
// unread here, and Gmail keeps its own state. Opening twice changes nothing.
const input = z.strictObject({ account: z.uuid(), id: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const { error } = await session.ctx.db
    .from("mail_opened")
    .upsert({ owner_id: session.user.id, account_id: body.value.account, message_id: body.value.id }, { onConflict: "account_id,message_id", ignoreDuplicates: true });
  if (error) {
    // Row-level security refuses another person's account with 42501.
    console.error("mail opened:", error.message);
    return problem(422, "that message cannot be marked here");
  }
  return json({ ok: true });
}
