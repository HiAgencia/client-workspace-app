import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import type { Db } from "@/lib/db/client";
import { demoMailSource, type MailSource } from "@/lib/mail/source";
import type { CalendarWriter, EventsSource, ToolContext } from "@/lib/tools/context";
import { callTool, tools } from "@/lib/tools/registry";
import { authenticateAgent, type AgentAccess } from "./auth";

type Dependencies = { service: Db; events?: EventsSource; calendar?: CalendarWriter; mail?: MailSource };

// The tools that call Google: the calendar's, and those that read the accounts' mail —its list and count, a message, a
// search, the mail of a task, its possible replies, and the reply that closes it—.
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
  "list_task_replies",
  "complete_task",
]);

function contextFor(access: AgentAccess, deps: Dependencies): ToolContext {
  return {
    db: deps.service,
    ownerId: access.ownerId,
    scopeNodeId: access.nodeId,
    source: "agent",
    agentLabel: access.label,
    // A token that never read starts from the beginning: its first read brings everything in reach.
    updatesSince: access.lastReadAt ?? "1970-01-01T00:00:00Z",
    events: deps.events,
    calendar: deps.calendar,
    mail: deps.mail ?? demoMailSource(),
  };
}

// Reading what is new moves the token's mark to where that read ended, so the next call without a moment starts
// there; other calls leave it, so listing the tools or writing never hides a change from the next read.
async function markRead(deps: Dependencies, access: AgentAccess, until: string): Promise<void> {
  const { error } = await deps.service.from("agent_tokens").update({ last_used_at: until }).eq("id", access.tokenId);
  if (error) console.error("mcp: moving the token's read mark failed", error.message);
}

// One server per request, built for the token that made it: every tool of the registry, the same the chat and the screens
// use, run with the service client but filtered to the token's owner and node subtree by the tools themselves, writing as
// the agent with the token's label.
function buildServer(access: AgentAccess, deps: Dependencies): McpServer {
  const server = new McpServer({ name: "client-workspace", version: "1.0.0" });
  const ctx = contextFor(access, deps);
  for (const definition of tools) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: definition.readOnly,
          // Deleting is logical and undoable on screen, so nothing here destroys data; deleting a Google event is the
          // one write Google keeps in its own trash, outside this product.
          destructiveHint: definition.name === "delete_google_event",
          // What reads or writes a Google calendar, or reads Gmail —whose messages are a third party's content—, reaches
          // outside the workspace.
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

  // The token is checked before the protocol runs: a missing, malformed, or revoked token answers 401 with the
  // Bearer challenge, and a foreign Origin 403.
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
