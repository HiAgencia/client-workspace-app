import { secondsToNextDay } from "@/lib/chat/usage";
import { json } from "@/lib/http";
import type { ToolError, ToolResult } from "@/lib/tools/result";

// A tool result as an HTTP answer. A failure of the database or the code is logged whole and reaches the browser as
// a fixed phrase; a failure the person can fix (not found, ambiguous, invalid) goes back as the tool said it.
export function toolResponse(what: string, result: ToolResult<unknown> | ToolError): Response {
  if (result.ok) return json(result);
  if (result.code === "db_error" || result.code === "internal") {
    console.error(`${what}: ${result.code} ${result.message}`);
    return json({ ok: false, code: result.code, message: "the change could not be saved: try again" }, 500);
  }
  if (result.code === "cap") return json(result, 429, { "Retry-After": String(secondsToNextDay()) });
  return json(result, 422);
}
