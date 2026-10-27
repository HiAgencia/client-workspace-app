import { z } from "zod";

// A tool never throws toward its caller: a model reads the failure as data and can correct itself.
export const errorCodes = [
  "invalid_input",
  "not_found",
  "ambiguous",
  "node_required",
  "since_required",
  "db_error",
  "internal",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const candidateSchema = z.object({ id: z.string(), path: z.string(), kind: z.string() });

export const toolErrorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(errorCodes),
  message: z.string(),
  ambiguous: z.literal(true).optional(),
  candidates: z.array(candidateSchema).optional(),
});

export type ToolError = z.infer<typeof toolErrorSchema>;
export type Ok<T> = { ok: true } & T;
export type ToolResult<T> = Ok<T> | ToolError;

export function ok<T extends object>(value: T): Ok<T> {
  return { ok: true, ...value };
}

export function fail(code: ErrorCode, message: string, extra?: Pick<ToolError, "ambiguous" | "candidates">): ToolError {
  return { ok: false, code, message, ...extra };
}

export function isError<T>(result: ToolResult<T> | ToolError): result is ToolError {
  return result.ok === false;
}

// `supabase-js` answers `{ data, error }` and does not throw: every call goes through here.
export function dbFail(what: string, error: { message: string }): ToolError {
  return fail("db_error", `${what}: ${error.message}`);
}
