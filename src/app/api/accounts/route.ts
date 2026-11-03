import { z } from "zod";
import { missingGoogleConfig } from "@/lib/google/deps";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { requireUser, userClient } from "@/lib/supabase/server";




export async function GET() {
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const { user } = who;
  const [accounts, links, calendars] = await Promise.all([
    db.from("google_accounts").select("id, email, status, is_demo, created_at").order("email"),
    db.from("node_accounts").select("account_id, node_id"),
    db.from("account_calendars").select("account_id, calendar_id, summary, color, selected").order("summary"),
  ]);
  if (accounts.error || links.error || calendars.error) {
    console.error("accounts:", (accounts.error ?? links.error ?? calendars.error)?.message);
    return problem(500, "the accounts could not be loaded");
  }
  return json({
    ok: true,
    canConnect: missingGoogleConfig().length === 0 && !user.isAnonymous,
    
    connectBlocked: user.isAnonymous ? "demo" : missingGoogleConfig().length > 0 ? "not_configured" : null,
    accounts: accounts.data.map((account) => ({
      id: account.id,
      email: account.email,
      status: account.status,
      isDemo: account.is_demo,
      nodeIds: links.data.filter((link) => link.account_id === account.id).map((link) => link.node_id),
      calendars: calendars.data
        .filter((calendar) => calendar.account_id === account.id)
        .map((calendar) => ({ id: calendar.calendar_id, name: calendar.summary, color: calendar.color, selected: calendar.selected })),
    })),
  });
}

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select_calendar"), accountId: z.uuid(), calendarId: z.string().min(1), selected: z.boolean() }),
  z.object({ action: z.literal("attach"), accountId: z.uuid(), nodeId: z.uuid() }),
  z.object({ action: z.literal("detach"), accountId: z.uuid(), nodeId: z.uuid() }),
  z.object({ action: z.literal("disconnect"), accountId: z.uuid() }),
]);

export async function POST(request: Request) {
  const input = await readInput(request, action);
  if (!input.ok) return input.response;
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const value = input.value;
  let result: { error: { message: string } | null; count?: number | null };
  switch (value.action) {
    case "select_calendar":
      result = await db
        .from("account_calendars")
        .update({ selected: value.selected }, { count: "exact" })
        .eq("account_id", value.accountId)
        .eq("calendar_id", value.calendarId);
      break;
    case "attach":
      result = await db
        .from("node_accounts")
        .upsert({ node_id: value.nodeId, account_id: value.accountId }, { onConflict: "node_id,account_id", ignoreDuplicates: true });
      break;
    case "detach":
      result = await db
        .from("node_accounts")
        .delete({ count: "exact" })
        .eq("node_id", value.nodeId)
        .eq("account_id", value.accountId);
      break;
    case "disconnect":
      result = await db.from("google_accounts").delete({ count: "exact" }).eq("id", value.accountId);
      break;
  }
  if (result.error) {
    
    console.error(`accounts ${value.action}:`, result.error.message);
    return problem(422, "that change is not possible here");
  }
  if (result.count === 0) return problem(404, "no such account or calendar");
  return json({ ok: true });
}
