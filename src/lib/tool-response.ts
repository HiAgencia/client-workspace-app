import { json } from "@/lib/http";
import type { ToolError, ToolResult } from "@/lib/tools/result";



export function toolResponse(what: string, result: ToolResult<unknown> | ToolError): Response {
  if (result.ok) return json(result);
  if (result.code === "db_error" || result.code === "internal") {
    console.error(`${what}: ${result.code} ${result.message}`);
    return json({ ok: false, code: result.code, message: "the change could not be saved: try again" }, 500);
  }
  return json(result, 422);
}
