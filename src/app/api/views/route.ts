import { z } from "zod";
import { boardQuery } from "@/lib/board-params";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";

// A person's saved views of the Overview: a name and the board's URL parameters, offered in the Overview's own bar.
export async function GET() {
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const { data, error } = await session.ctx.db
    .from("saved_views")
    .select("id, name, query, position")
    .eq("owner_id", session.user.id)
    .order("position")
    .order("name");
  if (error) {
    console.error("saved views:", error.message);
    return problem(500, "the saved views could not be read");
  }
  return json({ ok: true, views: data });
}

const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("save"), name: z.string().trim().min(1).max(80), query: z.string().max(2000) }),
  z.strictObject({ action: z.literal("delete"), id: z.uuid() }),
]);

export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const { db } = session.ctx;
  if (body.value.action === "delete") {
    const { error } = await db.from("saved_views").delete().eq("id", body.value.id).eq("owner_id", session.user.id);
    if (error) return problem(500, "the view could not be deleted");
    return json({ ok: true });
  }
  // Only the board's own parameters are kept, so a saved view reproduces exactly its filters.
  // Saving under a name that exists replaces what it shows.
  const { data, error } = await db
    .from("saved_views")
    .upsert({ owner_id: session.user.id, name: body.value.name, query: boardQuery(body.value.query) }, { onConflict: "owner_id,name" })
    .select("id, name, query, position")
    .single();
  if (error) {
    console.error("saving a view:", error.message);
    return problem(500, "the view could not be saved");
  }
  return json({ ok: true, view: data });
}
