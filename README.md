# Brief

The live app is [brief.hiagencia.com](https://brief.hiagencia.com).

> Built for the Meta Global AI Developer Hackathon (Indie Developer Track, "Build for Your World"),
> October 26 – November 4, 2026.

A task manager where **the project is the unit**, not the account. Anyone who runs many clients and projects works
with many identities at once — a shared mailbox per client, the client's own workspace, the agency's accounts — each
in its own browser profile, each with its own calendar. Keeping up means checking every one of them, every day.

This puts everything current in one place:

- **Clients and projects of your own**, each project with its subprojects, tasks, priorities, notes, and decisions,
  and an Overview that shows what is late, due, and waiting across all of them. Useful without AI: open it, write it
  down, keep going.
- **Google accounts and calendars attached to each node**, with inheritance: an agency account shows in every
  project, an account shared with a client shows in that client's projects, a project's own account only there. The
  calendar events are read and written, and the mail is read and linked to the task it may answer.
- **A chat on Meta's models that acts on the project when you ask**: it creates tasks, records decisions, looks up
  what is pending, and advises — from text, voice, or a screenshot.
- **An MCP server per project** for the developer's coding agent: "what's new from the client since my last
  session?", read and written back. Its token opens one node of the tree —a client, a project, or a subproject— and
  everything under it.
- **One tool layer** behind the screens, the chat, and the MCP server, so everything lands in the same place.

The product is built to be used by hand first and to include the AI on request: nothing runs on its own, and what can
be decided by a rule lives in the code, not in a model.

## What is in it

- **Overview**: the day across every client and project — tasks due and late, the week, the mail that may answer a
  task that waits for a reply, and the loose notes and activity.
- **Tasks**: the same task by date, as a list or as a board, by place and by priority, with subtasks, notes, decisions,
  link on the words of a title or a note, versions, and Trash.
- **A client's or a project's page**: its own tasks, calendar, mail, notes, and activity, with its color and its mark.
- **Calendar**: the connected accounts' calendars and the tasks of each day, week or month, with events that link
  back to tasks and places.
- **Mail**: the mail of each connected account, read in place, linked to a task, a client, or a project, and the
  possible replies of a task that waits for one — the person decides which message answers it and how it ended.
- **The chat**: Muse Spark on the page's place, with tools over the project, voice dictation, and image input.
- **Settings and Trash**: the theme, the Google accounts, the agent tokens, and what was deleted.
- **The demo**: a public workspace with sample clients, sample accounts, and sample mail, so the product can be tried
  without a Google account.

## Meta models

| Model | Used for |
|---|---|
| `muse-spark-1.3` | The chat: tool calling over the project, image understanding |
| `muse-voice-transcribe-1.0` | Dictation into the chat |

The model contract is exercised with `MODEL_PROVIDER=simulated` while the product is built; `MODEL_PROVIDER=meta`
calls Meta Model API through the Vercel AI SDK. Without a provider the AI is off and the rest of the app keeps working.

## Built during the event

Everything in this repository was written during the hackathon (October 26 – November 4, 2026); the commit history
starts on day one. Open-source dependencies are used under their licenses.

## Stack

- **Next.js** (App Router) + React + TypeScript, with the product's own design system in `src/app/styles/` and Base UI
  for the dropdown and the calendar.
- **Supabase** (Postgres, Auth, RLS) for every row of the product.
- **Cloudflare Workers** with OpenNext for the published app.
- **Meta Model API** for the chat, the voice, and the image input.
- **MCP** over Streamable HTTP for the coding agent.

## Run it locally

The app runs as a Cloudflare Worker built with OpenNext, against a Supabase project.

1. `pnpm install --frozen-lockfile`
2. Create `.dev.vars` from `.dev.vars.example`: the Supabase URL and keys, a Google OAuth client to connect
   calendars, a 32-byte base64 `TOKEN_ENCRYPTION_KEY`, and `MODEL_PROVIDER` (`simulated` runs the chat with no API
   spend; `meta` calls Meta Model API with `MODEL_API_KEY`; without a value the AI is off and the rest of the app works).
3. Apply the schema: `pnpm db:push` (Supabase CLI linked to the project).
4. `pnpm preview` builds the Worker and serves it at `http://localhost:8796`, the port in `wrangler.jsonc`, the same
   build that is deployed.
5. To connect a coding agent, open a client, project, or subproject, choose "Issue an agent token" (it opens Settings
   with that place chosen), issue a token, and copy the `.mcp.json` block into the repository; the token goes in the
   `CLIENT_WORKSPACE_TOKEN` environment variable.

`pnpm check` runs route typegen, TypeScript, ESLint, the design system's guard (`scripts/check-system.mjs`), and the
tests (the integration tests use the Supabase project with throwaway users). `pnpm icons` draws the site's icons from
the brand mark.

Press Ctrl+K (Cmd+K on a Mac) anywhere in the workspace to find a client, a project, a task, or an action.

## Google accounts

Each Google account is connected to one node — a client, a project, or a subproject — and is seen from there down.
The app asks for `calendar.events` and `calendar.calendarlist.readonly` to read and write the events, and
`gmail.readonly` to read the mail and find the messages that may answer a task. The tokens live encrypted on the
server. An account connected to a client is inherited by its projects; a project's account is not seen by its client.

## Structure

```
src/app/          the pages: the landing, the workspace, Overview, Tasks, a node, Calendar, Mail, Settings, Trash
src/app/app/      the screens and their pieces: boxes, rows, the detail, the quick add, the chat, the palette
src/app/styles/   the design system: tokens, system, screens, and one file per screen
src/components/   the primitives: button, field, dropdown, date picker, menu, fold, icons
src/lib/          the domain: tools, chat, Google, mail, demo, Supabase, the MCP server
supabase/         the migrations
tests/            the unit and integration tests
scripts/          the build, the checks, the icons, and the browser verifiers
public/           the icons and the web manifest
```

## Tests

`pnpm check` is the single validation: route typegen, `tsc`, ESLint, the design system's guard, and Vitest. The
integration tests run against the Supabase project with throwaway users and a demo pool that is reused and emptied
before each use.
