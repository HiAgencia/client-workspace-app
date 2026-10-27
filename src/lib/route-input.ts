import { z } from "zod";
import { problem, sameOrigin } from "@/lib/http";

const MAX_BODY = 64 * 1024;

// The shared entry of the screens' writing routes: same origin, a bounded JSON body, and the shape validated.
export async function readInput<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; value: z.output<S> } | { ok: false; response: Response }> {
  if (!sameOrigin(request)) return { ok: false, response: problem(403, "requests must come from this site") };
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, response: problem(413, "the request is too large") };
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: problem(400, "the body must be JSON") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: problem(422, z.prettifyError(parsed.error)) };
  return { ok: true, value: parsed.data };
}
