import { googleDeps } from "@/lib/google/deps";
import { googleEventsSource } from "@/lib/google/events";
import { mcpEndpoint } from "@/lib/mcp/server";
import { serviceClient } from "@/lib/supabase/server";

// The coding agent's door: Streamable HTTP, stateless, one token per node in `Authorization: Bearer`.
async function serve(request: Request): Promise<Response> {
  const deps = await googleDeps();
  return mcpEndpoint({ service: serviceClient(), events: deps ? googleEventsSource(deps) : undefined })(request);
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
