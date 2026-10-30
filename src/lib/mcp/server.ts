import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import type { Db } from "@/lib/db/client";
import { demoMailSource, type MailSource } from "@/lib/mail/source";
import type { CalendarWriter, EventsSource, ToolContext } from "@/lib/tools/context";
import { agentTools, callTool } from "@/lib/tools/registry";
import { authenticateAgent, type AgentAccess } from "./auth";

type Dependencies = { service: Db; events?: EventsSource; calendar?: CalendarWriter; mail?: MailSource };



const OPEN_WORLD = new Set([
  "list_events",
  "browse_events",
  "create_google_event",
  "update_google_event",
  "delete_google_event",
  "list_mail",
  "get_mail",
  "link_mail",
  "create_task_from_mail",
  "search_items",
  "get_item",
  "list_tree",
]);

function contextFor(access: AgentAccess, deps: Dependencies): ToolContext {
  return {
    db: deps.service,
    ownerId: access.ownerId,
    scopeNodeId: access.nodeId,
    source: "agent",
    agentLabel: access.label,
    
    updatesSince: access.lastReadAt ?? "1970-01-01T00:00:00Z",
    events: deps.events,
    calendar: deps.calendar,
    mail: deps.mail ?? demoMailSource(),
  };
}



async function markRead(deps: Dependencies, access: AgentAccess, until: string): Promise<void> {
  const { error } = await deps.service.from("agent_tokens").update({ last_used_at: until }).eq("id", access.tokenId);
  if (error) console.error("mcp: moving the token's read mark failed", error.message);
}



function buildServer(access: AgentAccess, deps: Dependencies): McpServer {
  const server = new McpServer({ name: "client-workspace", version: "1.0.0" });
  const ctx = contextFor(access, deps);
  for (const definition of agentTools) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: definition.readOnly,
          
          
          destructiveHint: definition.name === "delete_google_event",
          
          
          openWorldHint: OPEN_WORLD.has(definition.name),
        },
      },
      async (input: unknown) => {
        const result = await callTool(definition.name, ctx, input);
        if (definition.name === "get_updates_since" && result.ok) {
          await markRead(deps, access, (result as unknown as { until: string }).until);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: !result.ok,
        };
      },
    );
  }
  return server;
}

export function mcpEndpoint(deps: Dependencies) {
  const handler = createMcpHandler(({ authInfo }) => {
    const access = authInfo?.extra?.access as AgentAccess | undefined;
    if (!access) throw new Error("the MCP handler ran without an authenticated token");
    return buildServer(access, deps);
  });

  
  
  return async function serve(request: Request): Promise<Response> {
    const outcome = await authenticateAgent(request, deps.service);
    if (!outcome.ok) {
      return Response.json(
        { error: outcome.message },
        {
          status: outcome.status,
          headers: outcome.status === 401 ? { "WWW-Authenticate": 'Bearer realm="client-workspace"' } : {},
        },
      );
    }
    const authInfo: AuthInfo = {
      token: "verified",
      clientId: outcome.access.label,
      scopes: ["node"],
      extra: { access: outcome.access },
    };
    return handler.fetch(request, { authInfo });
  };
}
