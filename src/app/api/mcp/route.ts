import { googleDeps } from "@/lib/google/deps";
import { googleCalendarWriter, googleEventsSource } from "@/lib/google/events";
import { mcpEndpoint } from "@/lib/mcp/server";
import { serviceClient } from "@/lib/supabase/server";


async function serve(request: Request): Promise<Response> {
  const deps = await googleDeps();
  return mcpEndpoint({
    service: serviceClient(),
    events: deps ? googleEventsSource(deps) : undefined,
    calendar: deps ? googleCalendarWriter(deps) : undefined,
  })(request);
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
