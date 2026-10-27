# client-workspace

> Working name. Built for the Meta Global AI Developer Hackathon (Indie Developer Track, "Build for Your World").
> Status: in development.

A task manager where **the project is the unit**, not the account. Anyone who runs many clients and projects works
with many identities at once — a shared mailbox per client, the client's own workspace, the agency's accounts — each
in its own browser profile, each with its own calendar. Keeping up means checking every one of them, every day.

This puts everything current in one place:

- **A client → project → subproject tree** with tasks, priorities, decisions, links, and things to review. Useful
  without AI: open it, write it down, keep going.
- **Google accounts and calendars attached to each node**, with inheritance: an agency account shows in every
  project, an account shared with a client shows in that client's projects, a project's own account only there.
- **A chat on Meta's models that acts on the project**: it creates tasks, records decisions, looks up what is
  pending, and advises — from text, voice, or a screenshot.
- **An MCP server per project** for the developer's coding agent: "what's new from the client since my last
  session?", read and written back.
- **One tool layer** behind the screens, the chat, and the MCP server, so everything lands in the same place.

## Meta models

| Model | Used for |
|---|---|
| `muse-spark-1.3` | The chat: tool calling over the project, image understanding |
| `muse-voice-transcribe-1.0` | Voice notes into the chat |

## Built during the event

Everything in this repository was written during the hackathon (October 26 – November 4, 2026); the commit history
starts on day one. Open-source dependencies are used under their licenses.

## Run it locally

The app runs as a Cloudflare Worker built with OpenNext, against a Supabase project.

1. `pnpm install --frozen-lockfile`
2. Create `.dev.vars` from `.dev.vars.example`: the Supabase URL and keys, a Google OAuth client to connect
   calendars, a 32-byte base64 `TOKEN_ENCRYPTION_KEY`, and `MODEL_PROVIDER` (`simulated` runs the chat with no API
   spend; `meta` calls Meta Model API with `MODEL_API_KEY`).
3. Apply the schema: `pnpm db:push` (Supabase CLI linked to the project).
4. `pnpm preview` builds the Worker and serves it at `http://localhost:8787`, exactly as it is deployed.
5. To connect a coding agent, open a project, choose "Connect your agent", issue a token, and copy the `.mcp.json`
   block into the repository; the token goes in the `CLIENT_WORKSPACE_TOKEN` environment variable.

`pnpm check` runs route typegen, TypeScript, ESLint, the design system's guard (`scripts/check-system.mjs`), and the
tests (the integration tests use the Supabase project with throwaway users). `pnpm icons` draws the site's icons from
the brand mark.

Press Ctrl+K (Cmd+K on a Mac) anywhere in the workspace to find a project, a task, or an action.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): data, tool layer, chat, MCP, Google accounts, demo, screens, and the design
  system.
