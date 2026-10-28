# Architecture

How the product is built: data, the shared tool layer, the chat, the MCP server, Google accounts, the public demo,
and the screens. When the code changes a decision described here, this document changes in the same commit.

## Principles

- **Useful without AI.** Everything the chat or a coding agent can do, a person can do by hand on screen.
- **One tool layer.** The screens, the chat, and the MCP server write through the same functions, so whatever is
  noted by hand, by the chat, or by an agent ends up in the same place, tagged with its source.
- **Derived data is computed, not stored.** Account inheritance, counters, and "what's new" come from queries.
- **The model sits behind an interface.** With `MODEL_PROVIDER=simulated` the chat and voice run against a
  simulator, with no API spend; with `meta`, against Meta Model API.

## Stack

- Next.js (App Router), React, TypeScript, and Tailwind, deployed to Cloudflare Workers with OpenNext. The interface is
  the product's own design system (§The design system); Base UI gives the dropdown and the date popover their behavior.
- Supabase: Postgres for all data, row-level security per owner, and Auth with Google for identity only.
- Meta models through the Vercel AI SDK with `@ai-sdk/openai` pointed at `https://api.meta.ai/v1` (Responses API);
  voice through `POST /v1/asr/transcribe`. `MODEL_API_KEY` lives only on the server.
- MCP: the official TypeScript SDK (`@modelcontextprotocol/server`), Streamable HTTP, served by the same app.

## Data

| Table | Holds | Key columns |
|---|---|---|
| `nodes` | The tree: clients and the person's own projects at the root, a client's projects, subprojects below a project | `id`, `owner_id`, `parent_id` (null at the root), `kind` (`client` · `project` · `subproject`), `name`, `position`, `archived_at` |
| `items` | What lives in a node or under a task: tasks and subtasks, notes, decisions, links, and items to review | `id`, `node_id`, `parent_item_id` (null when it hangs from the node), `type` (`task` · `note` · `decision` · `link` · `review`), `title`, `body` (rich text), `url`, `status` (`open` · `done`), `priority` (1–4, tasks only), `due_on` (tasks only), `source` and `agent_label` (who created it), `changed_source` and `changed_agent_label` (who made the last change), `created_at`, `updated_at`, `completed_at`, `deleted_at` |
| `events` | The workspace's own events, apart from Google's | `id`, `node_id`, `title`, `body`, `all_day`, `starts_on`/`ends_on` (a whole day, the last included) or `starts_at`/`ends_at`, `source`, `agent_label`, `changed_source`, `changed_agent_label`, `created_at`, `updated_at`, `deleted_at` |
| `item_events` | The event a task lives in | `item_id` (the key: one event per task), and either `event_id` (the workspace's own) or `account_id` + `calendar_id` + `google_event_id` |
| `revisions` | Every version an item or an event left | `id`, `item_id` or `event_id` (exactly one), `snapshot` (the versioned columns before the change), `source` and `agent_label` (who changed it), `created_at` |
| `saved_views` | A person's saved views of the Overview | `id`, `owner_id`, `name`, `query` (the board's URL parameters), `position` |
| `google_accounts` | Each connected Google account | `id`, `owner_id`, `email`, encrypted `refresh_token`, encrypted `access_token` and its expiry, `scopes`, `status`, `is_demo` |
| `node_accounts` | Which node an account hangs from | `node_id`, `account_id` |
| `account_calendars` | Which calendars of each account are shown | `account_id`, `calendar_id`, `summary`, `color`, `selected` |
| `agent_tokens` | A coding agent's access to a node | `id`, `node_id`, `token_hash`, `label`, `created_at`, `last_used_at`, `revoked_at` |
| `chat_messages` | The chat conversations: one per node, and the whole workspace's own | `id`, `seq` (insertion order), `owner_id` (the signed-in person by default), `node_id` (null for the workspace's conversation), `role`, `parts` (jsonb), `created_at` |
| `usage_counters` | The daily cap on chat messages and transcriptions | `owner_id`, `day`, `kind`, `count` |

- **The tree's shape**: a root is a client or a project of the person's own, so someone without clients keeps their
  projects at the root and an agency keeps its own projects beside its clients; a client is always a root, a client's
  child is a project, and a project's or a subproject's child is a subproject. A check constraint and a trigger hold it
  for every writer, and a node keeps the kind it was created with: the trigger refuses a change of kind (`23514`).
- **Account inheritance**: an account attached to a node is visible in that node and all its descendants, computed
  with a recursive query over `parent_id`. The screen tells an own account from an inherited one, and says which
  node it comes from.
- **Deletion is soft** (`deleted_at`): undoing what the chat did and the agent's "what's new" both need it. A branch goes
  together: `public.delete_item_branch` marks the item and every descendant with the same moment and
  `public.restore_item_branch` brings back exactly the rows with that moment, so what was deleted before on its own stays
  deleted; both are one statement with the caller's rights.
- **The tree of items**: a trigger keeps a parent a live task of the same node, refuses a cycle, and lets only a task
  keep children. A subtask is a task with a parent; a note and a link hang from a node or from a task at any level.
- **Rich text**: a body is HTML from a closed list —paragraph, bold, italic, lists, a link (`http`, `https`, `mailto`)
  and a color as a class of a fixed palette that follows the theme (`tc-red`, `tc-amber`, `tc-green`, `tc-blue`,
  `tc-violet`), never a `style`—. `src/lib/rich-text.ts` sanitizes it without a DOM (a streaming parser, so it runs in
  the Worker): the tool layer on every write and the screen on every paint. Text that opens no tag of the list is plain
  text —"Vec<String>" stays whole—, a paragraph per line. A note's `title` is its first line in plain text, which search, the palette, and the lists read. The editor
  is Tiptap, the same for a note, a decision, and a task.
- **Versions**: an `after update` trigger writes a revision whenever a versioned column changes —an item's title, body,
  url, status, priority, due date, parent, or deletion; an event's title, body, moment, or deletion—, with who changed
  it, so no writer skips it; the trigger's function runs with its owner's rights and the signed-in role only reads.
  Restoring writes the snapshot back over the row, which leaves its own version; the deletion is not part of it (a branch
  is deleted and restored only whole), and a restored subtask brings back its deleted parent's branch first, so a live
  item never hangs from a deleted one. The screens read the items' versions; the events' are recorded for the same
  restore.
- **A node's number** is its open tasks, subtasks and those of everything below it included: the same in the sidebar, on
  its card, in its page's header, and in `list_tree`. `list_tree` and `get_board` count it with one walk
  (`countInSubtrees`, `src/lib/tools/rows.ts`), so no two places can disagree.
- UUIDs generated by the database; timestamps in UTC, shown in the browser's time zone.
- Migrations live in `supabase/migrations/`; `public.seed_demo(p_today, p_zone)` plants the demo's whole workspace —a small
  agency with three clients (Larkspur Bakery, Studio Atlas, Lumen Dental) and projects of its own (Agency website,
  Operations, Component library); tasks due around today and some late, a task with its subtasks, note, and link, notes,
  decisions, links, items to review, events of its own, an item with a version, and items written by hand, by the chat
  (each with the conversation that wrote it), and by a coding agent whose two tokens, labeled `laptop`, Settings lists;
  with a real workspace's gaps (a client with one project, a project with no notes)— in one security-invoker function
  called through `POST /api/demo` with the visitor's calendar day (required) and zone, so a new session gets its copy in
  one transaction. Every moment it writes is a number of working minutes (Monday to Friday, 09:00–18:00 in the visitor's
  zone) before now, through `public.working_minutes_before`, so the activity reads as working days at any hour of the
  visit; `src/lib/working-time.ts` holds the same rule. The tokens' hash is of bytes nobody holds, so none can be used;
  the person's role may write only a token's node, hash, and label, so the route dates the tokens afterwards with the
  server's client, filtering by the owner (`settleDemoTokens`). The renamed item's version keeps the moment of the seed,
  which the revisions trigger stamps. The TypeScript tree it mirrors is `demoSeedTree`, and a test compares both, the
  working minutes of each moment included.

## The tool layer (`src/lib/tools/`)

Each tool is a function over a context `{ db, ownerId, scopeNodeId?, source, agentLabel?, updatesSince?, events?, calendar? }`,
with zod input and output schemas —strict: a field a tool does not know comes back as an error, never dropped—, a
description, and a read-only flag. `updatesSince` is where "what's new" starts when the caller gives no moment (an MCP
token's previous read); `events` is the source the event reads use and `calendar` where writes to Google go, both
injected so the tests and the demo run without Google. The tree is read once per context (a chat turn, an MCP request,
a route), and shaping the tree forgets that read. `db` is the signed-in user's Supabase client (row-level security)
for the screens and the chat, and the service client for the MCP server; either way the tools filter by owner and by
the scope's subtree in code. One registry exports them and `callTool` validates the input; two adapters publish them,
one for the AI SDK (the chat) and one for the MCP server. The screens call the same functions through their routes.
A failure comes back as data (`{ ok: false, code, message }`), never as an exception, so a model can correct itself.

| Tool | Read-only | What it does |
|---|---|---|
| `list_tree` | yes | The tree visible from the scope, with each node's open tasks and open items to review, each counting its subtree |
| `get_board` | yes | For the person's day, what is open, late, due today and in a stretch of days (`from`–`through`, such as the whole week), undated, and to review, in everything in reach or below one node, and the same figures per node, each counting its subtree |
| `get_overview` | yes | A node: open tasks by priority; the latest notes, decisions, and links of the node and its subtree, each with its path, and how many there are in all; items to review; what the nodes below hold; and (unless asked without them) the next seven days of events from its accounts and the workspace's own |
| `browse_items` | yes | Items of a node and its subtree (or everything) by type, status, priority, origin, text, due range, undated, or parent, with each filter's counts and, for a task with subtasks, how many are open and done; an undated item is outside every range |
| `list_items` | yes | A node's items filtered by type and status, or what hangs from a task |
| `search_items` | yes | Text search over titles and bodies |
| `get_updates_since` | yes | What was created, changed, completed, or deleted since a moment; with no moment, since the token's previous read (the first time, everything in reach), and the read moves the token's mark |
| `list_events` | yes | Events from the accounts visible in a node, between two dates |
| `browse_events` | yes | The events of a range from the Google accounts and the workspace's own, each once, read in parallel |
| `create_task` | no | Creates a task, or a subtask under a task, with priority, due date, and notes |
| `add_note` | no | Writes a note in a node or under a task |
| `update_item` | no | Changes title, body, link, priority, due date, or status |
| `add_decision` | no | Records a decision and its rationale |
| `add_link` | no | Saves a link in a node or under a task |
| `add_review` | no | Records something to review, with an optional link |
| `delete_item` | no | Soft delete of the item and its branch (undo) |
| `create_event`, `update_event`, `delete_event` | no | The workspace's own events; each change records a version, and a deletion is undone |
| `create_google_event`, `update_google_event`, `delete_google_event` | no | A connected account's Google calendar |
| `link_task_event`, `unlink_task_event` | no | Puts a task inside an event of the workspace or of Google, or takes it out |

- A node is addressed by id or by its readable path ("Acme / Web / Landing", or its last segments, "Web / Landing"),
  ignoring case and accents; a whole path wins, an ambiguous one returns the candidates instead of picking one, and
  one outside the scope is not found. Without a node, a tool works on the scope's node (the open node in the chat,
  the token's node in the MCP server).
- Undoing a deletion (`restoreItem`, `restoreEvent`), the versions (`listRevisions`, `restoreRevision`), and the trash
  (`listTrash`) are not offered to models: the screens and the chat's undo button call them.
  `update_item` returns the values it replaced, so undoing a change writes them back.
- Every write stores its `source`, and the MCP also the token's `label`, so the screen says who made it; an item also
  carries who made its last change (`changedSource`, `changedAgentLabel`), which the activity reads for what was
  completed, changed, or deleted.

## The chat (`/api/chat`)

- AI SDK `streamText` with `@ai-sdk/openai` against `https://api.meta.ai/v1` and `muse-spark-1.3` (standard mode:
  the data is the user's), over the Responses API, with `store: false` and the encrypted reasoning replayed across
  turns (`include: ["reasoning.encrypted_content"]`).
- Its tools are the registry's, scoped to the open node —or to everything, on the Overview, where the conversation is
  the workspace's own—; the loop stops after a bounded number of steps.
- The system prompt carries the user's date and time zone, the open node's path (or that none is open, so a write goes
  where the request says), and a summary of the tree. The chat **acts** (creates, records, completes), **looks up**, and
  **advises** from what it reads.
- **Images** travel as file parts of the message, and Muse Spark reads them: a screenshot of a client's message
  becomes tasks.
- **Voice**: the browser records and encodes mono 16-bit PCM WAV at 24 kHz, the format the endpoint accepts;
  `/api/transcribe` sends it to `muse-voice-transcribe-1.0`; the transcript lands in the input box to be reviewed
  before sending, and an empty one is dropped. The microphone shows only when `GET /api/transcribe` says a
  transcription can run.
- Every write the chat makes shows as a card saying what it did, with an undo button: a creation is deleted, a
  change gets back the values `update_item` returned as replaced, a deletion is restored.
- The conversation is stored per node, and the workspace's own without a node, in `chat_messages` (the person's message
  and the answer, with their parts, encrypted reasoning included, ordered by `seq`) when the answer ends whole; a turn
  cut short is not stored. The
  browser sends only the new message, with at most one image; the server rebuilds the recent turns from what it
  stored, and an image travels to the model only in the turn it arrives (later turns carry a note), so one large
  image never makes the next messages too large.
- **The cap**: `usage_counters` limits messages and transcriptions per person and day (cut in UTC), on the server,
  taken before the model is called by `public.take_usage`, one statement that refuses past the cap, so two requests
  at once never both pass the last unit; the answer is 429 with `Retry-After` and a sentence the panel shows. A demo
  session has a smaller cap of its own, and all demo sessions together share a daily total (`public.anonymous_usage`),
  because a new demo session is one click away. Defaults (overridable): 60 messages and 20 notes a day per person
  (`CHAT_DAILY_CAP`, `TRANSCRIPTION_DAILY_CAP`), 20 and 5 per demo session (`DEMO_CHAT_DAILY_CAP`,
  `DEMO_TRANSCRIPTION_DAILY_CAP`), 400 and 60 for all demo sessions (`DEMO_TOTAL_CHAT_DAILY_CAP`,
  `DEMO_TOTAL_TRANSCRIPTION_DAILY_CAP`). Meta Model API has no hard spend cap of its own.
- **The simulator**: with `MODEL_PROVIDER=simulated` a scripted model (`src/lib/chat/simulated.ts`) calls the tool
  a real model would for a request (create a task —in the node a request names, "in Operations to…"—, record a decision,
  read what is pending in the open node or across everything) and transcription returns a fixed sentence, so the whole
  chat runs and is tested without spend.

## The MCP server (`/api/mcp`)

- Stateless SDK server with its `Request`/`Response` handler mounted on a Next route; Streamable HTTP transport.
- **Authentication**: `Authorization: Bearer <token>`. The server stores only the hash, and the token defines the
  reachable node (that node and its descendants). Missing or revoked token: 401. The `Origin` header is validated.
- Read tools carry `readOnlyHint`, so the agent does not ask for approval to read.
- **Each code repository declares it in its `.mcp.json`** with the token in an environment variable (Claude Code
  and Muse Code expand `${VAR}`); Settings issues the token once, for the client or project chosen, and shows the block
  to copy.

## Google accounts

- **Sign-in** is Supabase Auth with Google, identity scopes only. Google returns through `/auth/callback`, which
  trades the one-time code for the session cookies.
- **The session** lives in cookies the browser client keeps fresh. Route handlers read it with `auth.getUser()`,
  which asks the auth server, and can write a refreshed session back; pages never read it on the server, because a
  Server Component cannot store a refresh and would spend the refresh token the browser holds. There is no request
  interception file: the Workers adapter does not run Next's `proxy.ts`.
- Server configuration, the Supabase address and publishable key included, is read per request from the Worker's
  variables and handed to the browser by the page, so one build runs anywhere with that place's variables.
- **Connecting an account** is a separate OAuth flow per account, started from the node it hangs from
  (`/api/google/connect?node=` → `/api/google/callback`): `access_type=offline`, `prompt=consent select_account`,
  `include_granted_scopes`, scope `calendar.events` and `calendar.calendarlist.readonly` plus `openid email`; the callback
  refuses an authorization without both calendar permissions. The `state` carries the node, the person,
  an expiry, and a nonce, signed with HMAC under a key derived from `TOKEN_ENCRYPTION_KEY`; the nonce also sits in an
  http-only cookie of the browser that started, and the callback demands both and the same signed-in person. The
  tokens are encrypted with AES-GCM (WebCrypto) under `TOKEN_ENCRYPTION_KEY`, a Worker secret, and only the service
  client reads them. Connecting an account again refreshes its tokens, adds the
  node, and keeps the person's choice of calendars; a new calendar starts shown when it is the primary one or Google
  marks it selected. A demo session does not connect accounts.
- An access token is renewed shortly before it expires; a refresh Google refuses (`invalid_grant`) marks the account
  `revoked`, is not asked again, and the screen asks to connect it again. Every call to Google carries its own
  deadline.
- **Writing**: `events.insert`, `events.patch`, and `events.delete` on a connected account that is not the demo's and
  not revoked; a whole day's end goes to Google as the next day, as it counts it.
- **Events**: `calendarList.list` on connect; `events.list` with `singleEvents=true` and `orderBy=startTime` for each
  selected calendar of each visible account, merged in time order, each with its calendar's color and its account.
  The events of a node include those of the accounts it inherits, also for an agent token scoped to it: an inherited
  account is part of what the node shows, while the token still reaches no item or node outside its subtree.
- The Google Cloud app is published without verification: users see Google's unverified-app screen, and
  authorizations do not expire after seven days as they do in testing mode.

## The public demo

- "Try the demo" starts an anonymous Supabase session and copies the seed into a tree of that session's own, so
  each visitor works on their own copy.
- The demo is the emulation of a real case —a small agency's week— and opens on its Overview like any workspace, with no
  banner or guide of its own; the landing says what it holds (its clients and its own projects, read from the seed's
  tree) and where to write first.
- The demo does not connect Google accounts; it shows only its sample work, and where connecting is offered it says
  that connecting needs a Google sign-in. A real account is connected when the product is validated with real data,
  never in the demo.
- The chat runs on Meta's models under the daily cap.

## Screens

The screens read and write in the browser through the app's routes, which check the session on every request:
`/api/tools/<name>` runs a tool with source `manual`; shaping the tree (create, rename, archive a node), undoing a
deletion, accounts and calendars, and agent tokens have their own routes, because they are not offered to models.
Every writing route demands this site's `Origin` and a bounded JSON body.

1. **Landing**: what it is, what the demo holds and where to write first, "Try the demo", and "Sign in with Google". A
   demo whose seed failed is tried again on the same session.
2. **Sidebar**, fixed: its options never change from one screen to another. Overview on top; **Clients** and
   **Projects** (the person's own, at the root), each a group that folds, with its "New client" or "New project" always
   in view; each client and each project folds its children, with each node's open tasks and a "New project" or "New
   subproject" at the end of what it holds; a root reads the same in both groups, and each level below reads quieter; at
   its foot **Calendar**, **Trash**, and **Settings**. What is folded open is kept in the browser, and visiting a node
   opens the way to it once per visit. On a phone it lives in a drawer opened from the header's "Menu".
3. **Overview** (`/app`), the board where everything is managed at a glance: a header with "Open the chat" and "Issue an
   agent token", and a general bar —which client or project every section shows, and the saved views— reaching every
   section; the figures (late tasks, due today, due this week, items to review, events today), counted over the whole
   universe by `get_board` (events today, over what the Agenda read, saying so when a calendar could not be read), each
   taking the view to the section it filters and counting the same days that section lists —this week is the whole week,
   its first days included—; **Tasks** (today's and late ones, this week, this month, or any date; by priority; open or
   done; with a quick add that says where the task goes) beside the **Agenda** (today, this week, or this month);
   **Clients and projects**, one card each with its open tasks, late, due today, and to review; **To review**; and
   **Activity**, what was added, changed, completed, or deleted in the last days, by hand, by the chat, or by an agent
   and its token's name. Each section carries its own filters in its head, and every filter lives in the URL (`scope`,
   `tasks`, `status`, `priority`, `agenda`, `review`, `who`, `what`, `kind`), so reloading, going back, and a saved view
   return the same board. A section shows what it read with the request that read it: while another scope or filter is
   read, what is on screen dims instead of passing for the new answer. Where the board is narrow the figures are compact
   tiles two to a row.
4. **Client** and **project** pages are composed like the Overview over one node and what is below it, in its order: the
   same Tasks section and its filters (opening on any date) with the Agenda beside it, the node's projects or subprojects
   as cards where the Overview has its clients and projects, To review and Activity, then what the node and those below
   it keep —notes, decisions, and links, each row saying where it lives— and the Google accounts it sees. In Tasks each
   subtask is a row of its own under its task, sharing its columns, and the task says how many of its subtasks are done;
   two levels, deeper ones folded behind a button. The header says what the page is and where it lives ("Project of
   Larkspur Bakery") and its figures, a project naming how many of its open tasks are in its subprojects.
5. **Item detail**, a side panel from any row: its record (status, priority, date, link, origin), its rich text saved
   when typing stops, a task's subtasks, notes, links, and event, its versions, and deleting it; Escape closes it and
   returns the focus to the row. A landing on an item —from the palette or a row's path— opens the tab it lives behind
   (a done task, a reviewed item) and waits for the section that paints it.
6. **Chat**, on demand on the Overview and on every client's and project's page: "Open the chat" docks it beside the
   page where the window holds both, and there it stays open from page to page until it is closed; where the window is
   narrow it opens as a sheet when asked, never by itself on load. It keeps the place's conversation —the workspace's
   own on the Overview—, with microphone, image attachment, and cards for what it did.
7. **Calendar**: a month or a week of days with the tasks due each day and the events of the accounts and the
   workspace's own calendar; a day's detail creates, renames, and deletes events and puts a task inside one.
8. **Trash**: what was deleted, each branch once, restored whole.
9. **Settings**: the theme; the Google accounts, the clients and projects each is connected to, and which calendars are
   shown; and the agent tokens of every client, project, and subproject, issued for the one chosen (a page's "Issue an
   agent token" arrives with it chosen), with the `.mcp.json` block to copy. A session opened without an account says
   that connecting a calendar needs a Google sign-in, and offers it.

## Interaction principles

- **The main action is one click away**: "New task" is always visible, and quick add takes priority and due date
  on the same line. What is created inside a node stays in that node.
- **New things are born complete**: a task takes the open node and defaults; a node is created in place in the
  tree; picking a node that does not exist offers to create it with what was typed.
- **No "Save" button**: edits save when typing stops, pending edits save on leaving, and a short accessible notice
  says "Saving… / Saved".
- **Edit in place**: title, priority, due date, and status change in the row, Enter confirms, Esc cancels; secondary
  detail opens in a side panel, not a new page, where its notes save when typing stops and Escape closes it with the
  focus back on the row.
- **Delete does not ask, it offers undo**: deleting lives in the item's detail, so a row carries no destructive button;
  the row folds away and "Deleted · Undo" shows for a few seconds; only what cannot be undone asks for confirmation.
  What the chat or an agent did undoes the same way.
- **Command palette (Ctrl/Cmd+K)**: finds nodes, items, and actions, tolerates typos, is navigated with arrows and
  Enter, and opening an action lands on the exact place with focus set.
- **Back returns to where you were**, and a session resumes on the last open node.
- **Every empty state says what is missing**, and carries its own button when what fills it is not already in view; "no
  results" is not "nothing yet". One action has one control on screen.
- **Advanced fields appear on demand.**
- **One name per concept**, the same in the sidebar, the page, and the palette: Overview, Clients, Projects, Tasks,
  Agenda (a section's events) and Calendar (the page), To review and its items to review, Activity, Settings, Agent
  tokens; who wrote something is "By hand", "By the chat", or "By an agent · its token's name"; one verb per action
  ("Added task" in the activity and in the chat's cards); nothing in the navigation repeats a name the page uses for
  something else.
- **A control keeps its words at every width**: a segmented control whose options do not fit on one line takes tighter
  air, and only then puts its options two to a row; a label never breaks and never changes its name.
- **Filters live where they act**: the general one in the Overview's bar, a section's own in its head; there is no
  separate filters card.
- **On a phone** the sidebar opens from the header's "Menu" in a drawer and every page takes the full width.

## Visual principles

- **Depth by surfaces, not lines**: a canvas, cards that lift with their shadow, and what is touched inside a card
  in an inner tone; no control repeats its container's background, and hover sinks rather than brightens.
- **Field, control, and read-only text look different at a glance.**
- **Few type sizes; hierarchy by weight and role**: title, fixed label, variable value, proper names, help, and
  metadata each have one style; secondary text stays comfortably legible.
- **Color by role, in light and dark themes**; a state is never color alone, it is written.
- **Rows that read effortlessly**: optical centering, short values never wrap, shared columns to compare states;
  on a phone, tables become cards.
- **Notices weigh by level**: a failure carries more presence than a hint.
- **Everything responds and nothing is abrupt**: two-signal hover, visible focus, the selected piece travels, and
  popovers and dialogs enter and leave animated.
- **Live data does not flicker**: skeletons shaped like what comes and replaced with a fade; refreshed data
  repaints in place; lists reorder by moving. What the chat or an agent writes appears without reloading or
  shifting the rest.
- **Nothing jumps**: the view goes to each action's result, boxes keep their size when they change role, and no
  inner scroll where the page can scroll.
- **What cannot be undone is never one click away**: the dialog opens on "Back", and a bulk change shows its size.

## The design system

The principles above, as code. Components ask for a role, never for a value, so a theme or a size changes in one place.

- **Roles** (`src/app/styles/tokens.css`): surfaces (canvas, card, interior and its sunk hover, field, control, read,
  rail and piece), ink (ink, soft ink, muted), the accent and its tint, the states (alert, warn, info), what the
  browser draws (focus, selection, scrollbar), shadows composed from one ink, four type sizes, space, shape, motion, and
  layers. The light and the dark theme are two sets of values for the same roles.
- **Primitives** (`src/app/styles/system.css`, `src/components/ui/`): type by role (`.t-h1`, `.t-title`, `.t-label`,
  `.t-value`, `.t-name`, `.t-body`, `.t-help`, `.t-meta`, `.t-code`), the card, the button (control, primary, quiet, danger), the
  field, the dropdown, the date picker with its calendar, the checkbox, pills, the segmented control and tabs whose
  chosen piece travels, the theme switch, skeletons, folds, notices, and native dialogs that enter and leave animated.
  The screens (`src/app/styles/screens.css`) compose them.
- **Two families of one design**: Wix Madefor Display for titles, labels, controls, and proper names; Wix Madefor Text
  for what is read and the values a person types.
- **No native picker and no stock icon**: the dropdown, the calendar, and the checkbox are the product's own, with the
  native semantics (combobox and listbox, grid, checkbox); the mark is drawn for the product from its tree
  (`src/components/brand-geometry.json`), and `pnpm icons` draws the site's icons and the web manifest's installable
  sizes from the same geometry and the accent's color; `src/app/manifest.ts` serves the manifest every page links, and a
  test fails when the written icons no longer match them.
- **The theme** is the person's choice, stored in the browser and set on the root before the first paint; without a
  choice it follows the system, also when the system changes; a choice made in another tab reaches every open one, and
  the browser's own bar takes the chosen theme. Switching cross-fades the page.
- **Motion**: page changes cross out and in (React's `ViewTransition`), lists travel when they reorder, a deleted row
  folds away, skeletons are replaced by a fade, and everything honors reduced motion.
- **Where the window is narrow**, the sidebar lives in a drawer opened from the header, the chat is a sheet over the
  page, and a list's rows stack their controls under the title by the width of the list itself (a container query), so a
  list in a column of the board and a list on a phone arrange the same way.
- **The guard**: `pnpm check` runs `scripts/check-system.mjs`, which counts what escapes the system —stock icons,
  native pickers in the screens, color literals outside the roles, Tailwind sizes and colors instead of roles, and a
  `:hover` outside `@media (hover: hover)`— against caps that only go down.
