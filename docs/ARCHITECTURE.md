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
| `nodes` | The tree: clients and the person's own projects at the root, a client's projects, subprojects below a project | `id`, `owner_id`, `parent_id` (null at the root), `kind` (`client` · `project` · `subproject`), `name`, `position`, `color` (optional, from the product's palette), `archived_at` |
| `items` | Tasks and subtasks, notes, and decisions, each with an optional place | `id`, `owner_id`, `node_id` (null for General: a general task, a loose note), `parent_item_id` (null when it hangs from its place), `type` (`task` · `note` · `decision`), `title`, `body` (rich text), `status` (`open` · `done`), `priority` (1–4, tasks only), `due_on` and `due_time` (tasks only; the hour only with its day), `position` (the manual order), `source` and `agent_label` (who created it), `changed_source` and `changed_agent_label` (who made the last change; `review` for the daily review), `created_at`, `updated_at`, `completed_at`, `deleted_at` |
| `events` | The workspace's own events, apart from Google's | `id`, `owner_id`, `node_id` (null for an event of no node), `title`, `body`, `all_day`, `starts_on`/`ends_on` (a whole day, the last included) or `starts_at`/`ends_at`, `source`, `agent_label`, `changed_source`, `changed_agent_label`, `created_at`, `updated_at`, `deleted_at` |
| `item_events` | The event a task lives in | `item_id` (the key: one event per task), and either `event_id` (the workspace's own) or `account_id` + `calendar_id` + `google_event_id` |
| `node_events` | The events a client or a project is linked to | `id`, `node_id`, and either `event_id` or `account_id` + `calendar_id` + `google_event_id`; each pair once |
| `revisions` | Every version an item or an event left | `id`, `item_id` or `event_id` (exactly one), `snapshot` (the versioned columns before the change), `source` and `agent_label` (who changed it), `created_at` |
| `demo_mail` | The demo's sample messages, apart from every real datum; written only by the seed | `owner_id`, `account_id` (a sample account), `gmail_id`, `thread_id`, `from_name`, `from_email`, `to_emails`, `subject`, `snippet`, `html`, `text_body`, `received_at`, `unread`, `important` |
| `mail_links` | A message linked to a task, or to a client or project | `owner_id`, `account_id`, `message_id`, and either `item_id` or `node_id`; each pair once |
| `mail_opened` | What the person opened here (Gmail is read only and keeps its own state) | `owner_id`, `account_id`, `message_id`, `opened_at` |
| `task_mail` | The mail a task waits for and what the daily review wrote | `item_id` (the key), `owner_id`, `account_id` (null for every account of its place), `expect_from` (words of the sender), `status` (`waiting` · `met` · `not_met`), `sentence`, `decided_account_id` + `decided_message_id`, `checked_at` |
| `daily_reviews` | Each run of the daily review | `owner_id`, `day`, `instruction`, `requested` (asked for on purpose; the day's own run is once per person and day), `task_ids`, `provider` (`simulated` · `meta`), `finished_at` (null while it runs or after it stopped), `failures` (the steps that failed, a stop included), `attempt_started_at` (when the attempt under way started) and `heartbeat_at` (its last beat; both cleared by a stop, and the next call decides with the beat) |
| `review_actions` | Each thing a run did, for its undo | `review_id`, `owner_id`, `item_id`, `kind` (`mail_status` · `complete`), `before`, `after`, `undone_at` (the only column a person changes) |
| `preferences` | One row per person | `owner_id`, `boards` (per page —`overview`, `tasks`, `node:<id>`— the order of its boxes and the hidden ones), `layouts` (per page, `list` or `board`), `daily_review` (on by default), `daily_review_instruction` |
| `google_accounts` | Each connected Google account | `id`, `owner_id`, `email`, encrypted `refresh_token`, encrypted `access_token` and its expiry, `scopes`, `status`, `is_demo` |
| `node_accounts` | Which node an account hangs from | `node_id`, `account_id` |
| `account_calendars` | Which calendars of each account are shown | `account_id`, `calendar_id`, `summary`, `color`, `selected` |
| `agent_tokens` | A coding agent's access to a node | `id`, `node_id`, `token_hash`, `label`, `created_at`, `last_used_at`, `revoked_at` |
| `chat_messages` | The chat conversations: one per node, and the whole workspace's own | `id`, `seq` (insertion order), `owner_id` (the signed-in person by default), `node_id` (null for the workspace's conversation), `role`, `parts` (jsonb), `created_at` |
| `usage_counters` | The daily cap on chat messages, transcriptions, and daily reviews read by Meta's model | `owner_id`, `day`, `kind`, `count` |

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
- **An optional place**: an item, like an event, belongs to its person (`owner_id`) and lives in a node or in none
  —General—. A node's rows are referenced together with its owner, so a row never mixes owners, and row-level security
  reads the row's own owner; a write into a node also needs that node to be the person's, so it is refused by the policy
  (`42501`). Writing with the server's key, the node gives the owner.
- **The tree of items**: before a write, a trigger keeps a parent a live task and refuses a cycle, and only a task keeps
  children; after the statement, a second one keeps every item where its parent lives —the same node, or none— so a
  branch moves in one statement (`public.move_item_branch`) and a parent never moves without what hangs from it. A
  subtask is a task with a parent; a note or a decision hangs from a node, from a task at any level, or from nothing.
- **The kinds**: a task, a note, and a decision —a note marked as one—. The links became notes whose body holds the link
  as rich text and whose title keeps it over its words, and the items to review became tasks, with their origin
  (20261031010000, 20261031070000); the enum keeps both values and a check refuses them on every write.
- **Links over words**: a title keeps a link as `[words](address)` and the screen paints it (`src/lib/inline-links.ts`);
  a body keeps it as rich text, an `<a href>`. Plain text written with `[words](address)` becomes that link in the body
  (`writtenBody`), and a note's title, its body's first line, keeps the link over its words (`noteTitle`).
- **The initial capital**: a name or a title someone writes is kept with its first letter in capital, whoever writes it
  —a screen, the chat, an agent—: the tool layer sets it on every write of an item's title (a note's text included, whose
  first line is its title), an event's title (Google's included), and a node's name, and the agent tokens' route sets it on
  a token's label (`src/lib/initial-capital.ts`). Only that letter changes; the marks that open the text (`[`, `¿`, a quote) are
  skipped, and a text that opens with a number or an address stays as it is. A first word that already carries a capital
  after its first letter is a brand written that way on purpose —`iOS`, `eBay`, `macOS`— and stays as it was written.
- **The manual order**: a new item's `position` is the moment it is written, so it is last in any group it joins; a
  reorder deals out the positions the group already holds in the order given (`public.reorder_item_positions`, in SQL,
  so a position never passes through a JavaScript number, which holds fewer digits than one written by the clock), so
  nothing outside the group moves, and it moves neither `updated_at` nor any version.
- **Colors**: a node's `color` is a role name of a closed palette (`src/lib/node-colors.ts`, the same list as the check
  `nodes_color_palette`); a node without one shows its nearest ancestor's when the tree is read.
- **Rich text**: a body is HTML from a closed list —paragraph, bold, italic, lists, a link (`http`, `https`, `mailto`)
  and a color as a class of a fixed palette that follows the theme (`tc-red`, `tc-amber`, `tc-green`, `tc-blue`,
  `tc-violet`), never a `style`—. `src/lib/rich-text.ts` sanitizes it without a DOM (a streaming parser, so it runs in
  the Worker): the tool layer on every write and the screen on every paint. Text that opens no tag of the list is plain
  text —"Vec<String>" stays whole—, a paragraph per line. A note's `title` is its first line in plain text, which search, the palette, and the lists read. The editor
  is Tiptap, the same for a note, a decision, and a task.
- **Versions**: an `after update` trigger writes a revision whenever a versioned column changes —an item's title, body,
  status, priority, due date, hour, parent, or deletion; an event's title, body, moment, or deletion—, with who changed
  it, so no writer skips it; the trigger's function runs with its owner's rights and the signed-in role only reads.
  Restoring writes the snapshot back over the row, which leaves its own version; the deletion is not part of it (a branch
  is deleted and restored only whole), and a restored subtask brings back its deleted parent's branch first, so a live
  item never hangs from a deleted one. The screens read the items' versions; the events' are recorded for the same
  restore.
- **A node's number** is what the groups of `get_tasks` show in it and everything below it: an open task that hangs
  from no task, and an open subtask with a day; a subtask without a day counts inside its task's row («1/3») and not in
  the number (`shownAsRow`, the same criterion as `groupOf`). The same in the sidebar, on its card, in its page's header,
  and in `list_tree`, whose day figures (overdue, today) count the same rows. `list_tree` and `get_board` count it with
  one walk (`countInSubtrees`, `src/lib/tools/rows.ts`), so no two places can disagree.
- UUIDs generated by the database; timestamps in UTC, shown in the browser's time zone.
- Migrations live in `supabase/migrations/`; `public.seed_demo(p_today, p_zone)` plants the demo's whole workspace —a small
  agency with three clients (Larkspur Bakery, Studio Atlas, Lumen Dental) and projects of its own (Agency website,
  Operations, Component library), a few with a color, and the general work of no client or project; tasks due around
  today and some late, one at an hour, tasks without a date in an order set by hand, a task with its subtasks and notes,
  notes in nodes, in tasks, and loose, links over the words of a note, decisions, a review a coding agent asked for as a
  task of the day, events of its own, one of no node linked to a project, an item with a version, four sample mail
  accounts on the nodes they serve with their messages (some unread, one important, one account with none), a task
  waiting for an approval that already arrived —the daily review completes it when the demo opens— and one waiting for
  a message that has not, and items written by hand, by the chat (each with the conversation that wrote it), and by a
  coding agent whose two tokens, labeled `Laptop`, Settings lists; with a real workspace's gaps (a client with one
  project, a project with no notes, tasks without a description)— in one security-invoker function
  called through `POST /api/demo` with the visitor's calendar day (required) and zone, so a new session gets its copy in
  one transaction. Every moment it writes is a number of working minutes (Monday to Friday, 09:00–18:00 in the visitor's
  zone) before now, through `public.working_minutes_before`, so the activity reads as working days at any hour of the
  visit; `src/lib/working-time.ts` holds the same rule. The tokens' hash is of bytes nobody holds, so none can be used;
  the person's role may write only a token's node, hash, and label, so the route dates the tokens afterwards with the
  server's client, filtering by the owner (`settleDemoTokens`). The renamed item's version keeps the moment of the seed,
  which the revisions trigger stamps. The TypeScript tree it mirrors is `demoSeedTree`, and a test compares both, the
  working minutes of each moment included; the general work is `demoGeneral`.

- **The mail** comes from a source the tools are given (`src/lib/mail/source.ts`), as the events do: the demo's sample
  accounts read their rows of `demo_mail`; a real account answers as not read until the Gmail source (`gmail.readonly`)
  is configured. A place's accounts are those visible from its node, inherited included, every account over
  everything, and none for General. A list reads the latest messages of each account (`MAIL_LIMIT` by default), so an
  account with much mail leaves the others their share. A message is "for your tasks" when an open task is linked to it
  or waits for it: in its own account, or in every account its place sees (General's tasks, in every account of the
  owner), its sender holding the task's `expect_from`, arrived after the task existed. "Unread" is unread in Gmail and
  not opened here, and its count (`list_mail.unread`, `list_tree` with `withMail`) is every unread message of the
  accounts, listed or not. An access scoped to a node reads in a message only the tasks and the nodes it reaches.
  Waiting for another account or another sender starts the wait over (`waiting`, the deciding message forgotten), and a
  task moved to a place that does not see its account waits in every account of its new place. The HTML that leaves the server is sanitized (`src/lib/mail/sanitize.ts`): no scripts, forms and their
  controls, frames, embedded objects, handlers, active links, or style rules that load or run something; remote images
  are counted so the viewer loads them only when asked; a style is tested as the browser reads it, its CSS escapes
  decoded and its comments out. The demo's sample accounts and their messages are planted by
  `public.plant_demo_accounts` and `public.plant_demo_mail`, only for a demo (anonymous) session and on its own nodes,
  accounts marked as the demo's without tokens, once.
- **The daily review** (`src/lib/review/`) walks the person's overdue tasks, today's, and every open task that waits for
  a message whatever its date; for each that waits, it reads what arrived in its accounts since the task exists (each
  account read once, from the oldest wait that reads it), and only from its sender when it names one (`fromExpected`).
  A judge decides with two tools only, bound to the tasks of the run: write the state of a task's mail (with a sentence
  that quotes the deciding line and, for `met` and `not_met`, the message that decides it: one that arrived for that
  task, from its sender, or about it when it names none), and complete a task this run wrote as `met`. Each writes
  its action in the same statement (`public.review_write_mail_status`, `public.review_complete_task`), and neither
  throws: a failure is counted in the run's `failures` and said in the answer. A run counts as the day's once it
  finishes. A run under way writes its heartbeat (`heartbeat_at`) as the judge takes each task and on each step of the
  model, and the next call decides with it: a run whose last beat is older than the floor —one task's read with room to
  spare— is taken over in one statement, as a worker that died, and one that keeps beating is another call's, however
  long its attempt has been going (`attempt_started_at` is when that attempt began). So of two calls at once one resumes
  it and the other answers `skipped: "running"`; a stop clears both marks, so the next call picks it up at once, and a
  stop that cannot be recorded is logged and said in the answer. A run read by Meta's model takes a unit of the person's day first (§The cap); without the cap
  it does not run. The
  simulated judge follows fixed rules —the sender, and the words of the subject and the text: a refusal first, then an
  approval—; Meta's judge (`MODEL_PROVIDER=meta`) reads the same data with a prompt that fences the messages as data. A
  change that is already the state is no action, so running again repeats nothing; every action is a row with what was
  there before, and undoing writes it back, unless the person changed the state after the review: then the undo is
  refused and their state stays. Each action carries its task (`title`, `nodeId`, `path`, `status`), read once.

## The tool layer (`src/lib/tools/`)

Each tool is a function over a context `{ db, ownerId, scopeNodeId?, source, agentLabel?, updatesSince?, events?, calendar?, mail?, reviewJudge?, reviewQuota? }`,
with zod input and output schemas —strict: a field a tool does not know comes back as an error, never dropped—, a
description, and a read-only flag. `updatesSince` is where "what's new" starts when the caller gives no moment (an MCP
token's previous read); `events` is the source the event reads use and `calendar` where writes to Google go, both
injected so the tests and the demo run without Google. The tree is read once per context (a chat turn, an MCP request,
a route), and shaping the tree forgets that read. `db` is the signed-in user's Supabase client (row-level security)
for the screens and the chat, and the service client for the MCP server; either way the tools filter by owner and by
the scope's subtree in code. A context without a scope reaches General too; one scoped to a node —an agent's token, a
node's chat— reaches only that node and what is below it, never General. One registry exports them and `callTool` validates the input; two adapters publish them,
one for the AI SDK (the chat) and one for the MCP server, which leaves out the tools marked `chatOnly` (`agentTools`); `/api/tools/<name>` leaves them out too.
The screens call the same functions through their routes.
A failure comes back as data (`{ ok: false, code, message }`), never as an exception, so a model can correct itself.

| Tool | Read-only | What it does |
|---|---|---|
| `list_tree` | yes | The tree visible from the scope, each node with its open tasks counting its subtree, the color it shows and the one given to it; with the person's day, how many tasks are overdue and due today over everything in reach; with `withMail`, the unread mail of the accounts in reach; with `withContent` (a week), the nodes that have something to show besides their tasks —mail of an account they see, notes below them, the week's events— and whether General has |
| `get_tasks` | yes | For the person's day, the tasks of everything in reach, of General (`node: null`), or of a node and its subtree, in four groups —`overdue`, `today`, `upcoming` day by day (optionally the nearest days only), `noDate` in the manual order—, each with its count; optionally the finished ones; sorted by date, priority, or by hand. Each row: its title as written, the first line of its notes, day and hour, priority, its place's path and color (null for General), its subtasks done and in all, how many notes it has, who wrote it, its position, and `mail`: what it waits for and the state the daily review wrote, or null. A task is in a group when it has a day or hangs from no task |
| `get_item` | yes | One item by id with what its detail shows: the item with its place, path, and color; its parent; its subtasks as `get_tasks` rows; its notes with their decision mark; the event it is in (the workspace's own with its moment, or a Google one by its ids); the mail it waits for; and the messages linked to it, the one that decided its mail included. A general item is reached only without a scope |
| `list_notes` | yes | The notes of a node and its subtree, the loose ones of General, or a task's, newest first, each saying whether it is a decision; a note of a task reads with its task |
| `get_board` | yes | For the person's day, what is open, late, due today and in a stretch of days (`from`–`through`), and undated, in everything in reach or below one node, and the same figures per node, each counting its subtree |
| `get_overview` | yes | A node: open tasks by priority; the latest notes and decisions of the node and its subtree, each with its path, and how many there are in all; what the nodes below hold; and (unless asked without them) the next seven days of events from its accounts and the workspace's own |
| `browse_items` | yes | Items of a node and its subtree, of General, or of everything, by type, status, priority, origin, text, due range, undated, or parent, with each filter's counts and, for a task with subtasks, how many are open and done; an undated item is outside every range |
| `list_items` | yes | The items of a node or of General filtered by type and status, or what hangs from a task |
| `search_items` | yes | Text search over titles and bodies, and over the mail of the accounts in reach by sender, subject, and text |
| `list_mail` | yes | The latest mail of each account of a place or of one account, newest first, in `forTasks`, `unread`, and `earlier`, each with its count, and `unread`: every unread message of those accounts, with the same count account by account in `unreadByAccount`; each message with its place, its tasks, and its linked nodes |
| `get_mail` | yes | One message whole for the viewer: its sanitized HTML, its plain text, and how many remote images it holds |
| `get_updates_since` | yes | What was created, changed, completed, or deleted since a moment; with no moment, since the token's previous read (the first time, everything in reach), and the read moves the token's mark |
| `list_events` | yes | Events from the accounts visible in a node, between two dates |
| `browse_events` | yes | The events of a range from the Google accounts, the workspace's own (those of no node too, when nothing is scoped), and those linked to the nodes read, each once and saying the nodes linked to it (`linkedNodeIds`) and the live tasks in reach that live in it (`linkedTaskIds`), for an own event and for a Google one by its account, calendar, and id |
| `create_task` | no | Creates a task in a node or in General, or a subtask under a task, with priority, due day and hour, and notes |
| `add_note` | no | Writes a note in a node, under a task, or loose in General |
| `add_decision` | no | Records a decision and its rationale |
| `update_item` | no | Changes title, notes, priority, due day or hour, or status, or marks a note as a decision and back; returns what it replaced |
| `move_item` | no | Moves an item and its branch to another node, to General, or under another task, and returns where it was |
| `reorder_items` | no | Sets the manual order of a group, returning each item's previous position |
| `reschedule_overdue` | no | Moves every overdue task of a view to one day, keeping each hour, and returns each one's previous day |
| `request_review` | no | What an agent asks the person to look at: a task due on the person's day (`today`, required) in its node, with the address over its words |
| `delete_item` | no | Soft delete of the item and its branch (undo) |
| `create_event`, `update_event`, `delete_event` | no | The workspace's own events, in a node or in none; each change records a version, and a deletion is undone |
| `create_google_event`, `update_google_event`, `delete_google_event` | no | A connected account's Google calendar |
| `link_task_event`, `unlink_task_event` | no | Puts a task inside an event of the workspace or of Google, or takes it out; taking it out gives back the link it removed, so an undo puts it back in that event |
| `link_node_event`, `unlink_node_event` | no | Links a client or a project to an event of the workspace or of Google, or takes it off |
| `link_mail`, `unlink_mail` | no | Links a message to a task or to a client or project, or takes it off |
| `create_task_from_mail` | no | A task from a message, where the message's account hangs, with the message linked |
| `set_task_mail` | no | Says that a task waits for a message —in one account or every account of its place, from a sender— or for none |
| `run_daily_review` | no | The chat's "Review my day": the daily review asked for on purpose, over everything; an access scoped to a node does not run it, and neither the MCP server nor the screens' tool route dispatches it (`chatOnly`); its day is checked like `POST /api/review`'s |

- A node is addressed by id or by its readable path ("Acme / Web / Landing", or its last segments, "Web / Landing"),
  ignoring case and accents; a whole path wins, an ambiguous one returns the candidates instead of picking one, and
  one outside the scope is not found. `null` names General. Without a node, a write lands in the scope's node (the open
  node in the chat, the token's node in the MCP server) or, with nothing scoped, in General; a read covers the scope's
  node or, with nothing scoped, everything in reach.
- The screens read `get_tasks`, `list_notes`, `list_tree`, `list_mail`, `get_item`, `get_updates_since`, and
  `browse_events`; no screen reads `get_board`, `get_overview`, or `browse_items` anymore (the chat and the MCP still
  offer them).
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
  change gets back the values `update_item` returned as replaced, a move goes back to where `move_item` said it was, a
  reschedule gives each task its previous day, a deletion is restored, and what the daily review did is one card per
  task, with the line that decided it, undone through the review's own route.
- The conversation is stored per node, and the workspace's own without a node, in `chat_messages` (the person's message
  and the answer, with their parts, encrypted reasoning included, ordered by `seq`) when the answer ends whole; a turn
  cut short is not stored. The
  browser sends only the new message, with at most one image; the server rebuilds the recent turns from what it
  stored, and an image travels to the model only in the turn it arrives (later turns carry a note), so one large
  image never makes the next messages too large.
- **The cap**: `usage_counters` limits messages, transcriptions, and daily reviews read by Meta's model per person and day (cut in UTC), on the server,
  taken before the model is called by `public.take_usage`, one statement that refuses past the cap, so two requests
  at once never both pass the last unit; the answer is 429 with `Retry-After` and a sentence the panel shows. A demo
  session has a smaller cap of its own, and all demo sessions together share a daily total (`public.anonymous_usage`),
  because a new demo session is one click away. Defaults (overridable): 60 messages and 20 notes a day per person
  (`CHAT_DAILY_CAP`, `TRANSCRIPTION_DAILY_CAP`), 20 and 5 per demo session (`DEMO_CHAT_DAILY_CAP`,
  `DEMO_TRANSCRIPTION_DAILY_CAP`), 400 and 60 for all demo sessions (`DEMO_TOTAL_CHAT_DAILY_CAP`,
  `DEMO_TOTAL_TRANSCRIPTION_DAILY_CAP`); daily reviews, 5 per person (`DAILY_REVIEW_DAILY_CAP`), 2 per demo session
  (`DEMO_DAILY_REVIEW_DAILY_CAP`), and 100 for all demo sessions (`DEMO_TOTAL_DAILY_REVIEW_DAILY_CAP`). A tool or a
  route that reaches a cap answers `code: "cap"`, 429 with `Retry-After`. Meta Model API has no hard spend cap of its own.
- **The simulator**: with `MODEL_PROVIDER=simulated` a scripted model (`src/lib/chat/simulated.ts`) calls the tool
  a real model would for a request (create a task —in the node a request names, "in Operations to…"—, record a decision,
  read what is pending in the open node or across everything, and "Review my day" runs `run_daily_review` with the
  person's day and zone read from the system prompt) and transcription returns a fixed sentence, so the whole chat runs
  and is tested without spend.

## The MCP server (`/api/mcp`)

- Stateless SDK server with its `Request`/`Response` handler mounted on a Next route; Streamable HTTP transport.
- **Authentication**: `Authorization: Bearer <token>`. The server stores only the hash, and the token defines the
  reachable node (that node and its descendants). Missing or revoked token: 401. The `Origin` header is validated.
- It publishes every tool but the chat's own (`chatOnly`): the daily review is asked for from the app or the chat,
  and its writes record their owner from the signed-in session, which the service client does not have.
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
  interception file: the Workers adapter in use (`@opennextjs/cloudflare` 1.20.13) does not run Next's `proxy.ts`; a
  release that runs it reopens the choice.
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
  selected calendar of each visible account, merged in time order, each with its calendar's color and its account. The
  demo's sample accounts hold no tokens: nothing is asked of Google for them, and they are no failure.
  The events of a node include those of the accounts it inherits, also for an agent token scoped to it: an inherited
  account is part of what the node shows, while the token still reaches no item or node outside its subtree.
- The Google Cloud app is published without verification: users see Google's unverified-app screen, and
  authorizations do not expire after seven days as they do in testing mode.

## The public demo

- "Try the demo" starts an anonymous Supabase session and copies the seed into a tree of that session's own, so
  each visitor works on their own copy.
- **Starting over**: `DELETE /api/demo` empties the visitor's own copy through `public.reset_demo`, and the next read
  plants it again. A session that is not a demo's is refused (`42501`), and the function is `security definer` with its
  `search_path` empty because it deletes the tables a demo's rows live in without the owner holding a delete policy on
  each one; its only filter is the caller's own owner. The tests and the probe browser keep a few demo sessions and
  reuse them, emptying each before using it, because the project's anonymous sign-ups share a rate limit and a run that
  opened one per step ran into it.
- **The suite's users**: each user a run of the tests creates is written down the moment it exists, in a record of that
  run named by its process and start time (`tests/support/test-users.ts`); the run's global setup (`tests/setup/users.ts`)
  deletes first what a run that no longer lives left, counts the project's users before and after, and fails the run if
  a user it created is still there. That record and the demo pool's file live in `DEMO_POOL_DIR`, the system's
  temporary folder when it is not set.
- The demo is the emulation of a real case —a small agency's week— and opens on its Overview like any workspace, with no
  banner or guide of its own; the landing says what it holds (its clients and its own projects, read from the seed's
  tree) and where to write first.
- The demo does not connect Google accounts; it shows only its sample work, and where connecting is offered it says
  that connecting needs a Google sign-in. A real account is connected when the product is validated with real data,
  never in the demo.
- The chat runs on Meta's models under the daily cap.

## Screens

The screens read and write in the browser through the app's routes, which check the session on every request:
`/api/tools/<name>` runs a tool with source `manual`; shaping the tree (create, rename, color, archive a node), undoing
a deletion, accounts and calendars, agent tokens, the preferences (`/api/preferences`, which also writes the
`cw_layout` cookie the server reads to paint a page in its order; the cookie names its owner, a page reads it only for
that person, and `DELETE /api/preferences` clears it on signing out), the daily review (`POST /api/review` runs the
day's own, once per day, for a day some time zone is living —the UTC day, the one before, or the one after—; a review
asked for on purpose is the chat's tool `run_daily_review`, which `/api/tools/<name>` does not dispatch, checks the same
living day, and takes a unit of the day when Meta's model reads it; `GET /api/review` lists the last days' runs with their actions;
`POST /api/review/actions/<id>/undo` undoes one), and marking a message opened (`POST /api/mail/opened`) have their own
routes, because they are not offered to models.
Every writing route demands this site's `Origin` and a bounded JSON body. The demo's own are `/api/demo`: the `POST` plants
the visitor's copy, and the `DELETE` empties it so the next read plants it again.

1. **Landing**: the brand, a title and a line, "Try the demo" and "Sign in with Google", and what the demo holds; beside
   them a picture of the demo's Overview drawn with the workspace's own pieces (`src/app/landing-preview.tsx`, styled by
   `src/app/styles/landing.css`): the Tasks box with a task the daily review completed, the week —the visitor's own,
   read once the page runs—, the Mail box, and the review's notice. Its figures are the planted demo's, counted from the
   seed (`demoOverview` in `src/lib/demo-seed.ts`), and `tests/demo/overview.test.ts` reads them back from the tools. The
   product's name and its one-line description come from `src/lib/product.ts`, which the brand, the document's title and
   the web manifest read too. Each screen of the workspace declares its title as route metadata («Tasks · Client
   Workspace»), and a client's or a project's page takes its name from the tree in memory in the commit that shows it, so
   Next's route announcer reads the new screen's name and not the one the person left; the page's header keeps the title
   afterwards. A demo whose seed failed is tried again on the same session.
2. **Sidebar**, fixed at the left and as tall as the window, navigation only: its options never change from one screen to
   another. The brand on top, then "Add task" (key Q, outside a field: it opens quick add through
   `src/app/app/quick-add-bus.ts`, in the open client or project when the page is one's) and "Search" (Ctrl/Cmd+K, the
   palette); **Overview**, **Tasks** with what is overdue or due today, **Calendar**, and **Mail** with the unread mail of
   every account in reach (`list_tree` with `withMail`, read with the tree, the number the Mail page says); **Clients** and **Projects** (the person's own, at the root), each a group that folds
   by its name and ends in "Add client" or "Add project", created in place; each place that holds others folds them,
   with each node's open tasks and the color the person gave it (a disc before its name); a root reads the same in both
   groups, and each level below reads quieter; at its foot **Trash**, **Settings**, who is signed in, and "Sign out". A
   node's own actions live in the "More" of its page, not in the sidebar. What is folded open is kept in the browser, and
   visiting a node opens the way to it once per visit. On a phone it lives in a drawer opened from the bar's "Menu", and
   "Add task" stays fixed at the bottom right, clear of the screen's unsafe edges.
   **Every page's header** has one form (`src/app/app/page-header.tsx`): on top where it lives (only on a client or a
   project), its title, and its count in one line; on the right the controls the page has, always in this order and with
   one skin —its filters, "List | Board", "Chat", and "More"—, and no other button. The page's column is centered with
   its widest measure (`--content-w`).
3. **The boxes** (`src/app/app/boxes.tsx`, styled by `src/app/styles/boxes.css`): the Overview and a client's or a
   project's page are boxes the person orders. A box is a surface with its title and its count; its «More» shows with the
   pointer or the focus (always on a touch screen) and holds the box's own entries, «Move up», «Move down», the move to the
   other column —which under 40rem, where the board is one column, says «Move to the end»—, and «Hide this box»; the
   page's «More» → «Customize» shows the hidden ones again and puts the first
   order back. A box is dragged by its head to another place or to the other column, with no edit mode, and travels when
   it moves. The order is one list read from the first column to the second (a `split` mark between them): two columns
   side by side where the board is wide, one column in that same order where it is not, each box as tall as its content.
   It is saved per person and page through `/api/preferences` (`overview`, `node:<id>`), and the page's server component
   reads the `cw_layout` cookie (`src/app/app/saved-layout.ts`), so the page enters already in its order; a page the cookie
   left out reads its order from the route while the board still waits. The board enters whole —once every box in view
   read for the first time or failed, under a cap— in one staggered sequence, so no box pushes another while the page
   arrives. Each box has its states: reading (it says what it reads), empty (it says which empty it is, with its button),
   and failed (it keeps what it showed, says so, and offers «Try again»). The boxes' contents live in
   `src/app/app/box-kinds.tsx`: **Tasks** (Overdue with «Reschedule», Today, and the nearest days of Upcoming with «Show
   all upcoming»; «Add task» at a group's foot adds with that group's day, and a task dragged to another group, or to a
   day of the Calendar box, takes that group's day), **Calendar** (the week, the chosen day's events below, today by
   default), **Mail** (what a task waits for first, then what is unread, «Important» where Gmail says so, «Show all
   mail»; with no account, «Connect Google account»), **No date** (in the order the person drags them into),
   **Activity** (what the daily review, the chat, and an agent did in the last seven days, each with its «Undo»: a review's
   actions are undone through their route, an addition is deleted, a completion opens again, a deletion is restored, a
   change takes back the version it replaced), **Notes** (the loose ones on the Overview, a node's on its page, with
   «Add note»), and **Subprojects** (a node's page: what hangs from it, with «Add project» or «Add subproject»).
4. **Overview** (`/app`): the header with the date, two filters —the place (every place, General, or a client or
   project with what is below it, each saying its open tasks) and the mail account (each saying what the Mail box would
   show)—, «Chat» and «More»; the boxes Tasks, Activity, Calendar, Mail, No date, and Notes. The filters live in the
   address (`place`, `account`); the place filter and the account filter are the workspace's own (`place-filters.tsx`),
   shared with Calendar and Mail.
   **Tasks** (`/app/tasks`): the four groups whole, Upcoming day by day, as a list or a board —each group a column of
   cards—; «More» holds «Show completed» and the order (by date, by priority, or manual: in the manual order every group
   reorders by dragging). The place, the layout, the order, and the completed ones live in the address (`place`,
   `layout`, `sort`, `completed`), and list or board is also remembered for the person (the cookie gives it to the server).
   **A client's or a project's page** (`/app/node/<id>`): where it lives, its title, its open tasks, and the accounts it
   sees; «List | Board», «Chat», and «More» —rename, a new project or subproject, the agent token, the Google accounts,
   its color (the palette of `src/lib/node-colors.ts`, or none: then the one above it shows), and delete (archived, with
   its «Undo»)—; the boxes Tasks, No date, Calendar, Mail, Notes, and Subprojects, in the order saved for that page. In
   «Board» the Tasks box spans the page with its groups as columns. Inside its own page a task's place goes without
   saying; on a node with projects below it, a task of one of them says where it lives from there.
5. **Item detail**: a task opens in its own detail, a dialog at the center (below); a note or a decision opens in a side
   panel —its origin, its rich text saved when typing stops, its versions, and deleting it—, which Escape closes with the
   focus back on the row. A landing on an item —from the palette or a row's path— waits for the page that paints it.
   **The task's pieces** (`task-row.tsx`, `task-detail.tsx`, `quick-add.tsx`, styled by `src/app/styles/task.css`) are
   what the rebuilt pages compose. A task's row reads, always in this order, its circle in its priority's color (it
   completes the task), its title with the links over its words, a line of its description, and a line of data —its day
   or hour in the color and the word of how near it is, its subtasks as «1/3» that unfold inside the row, the priority
   written when it is Urgent or High, its notes, the mail it waits for, and who wrote it when it was not by hand—, with its
   place at the right in a column shared by every row (a subgrid), left out inside its own page. The board's card is the
   same piece in another shape. A press anywhere on the row that is not one of its controls opens its detail, and on a
   touch screen that is how it is used; «More», at the row's end where the pointer or the focus is, holds Priority,
   Move to… (a day or a place), Link to an event…, Duplicate, and Delete. Completing, deleting, moving, and reordering
   show at once and roll back saying so when the server refuses, each with its «Undo»; a group's list travels when it
   reorders. Dragging reorders inside a group that keeps the person's order and takes a task to another group with that
   group's day; the keyboard does the same (Alt with the arrows inside the group, Alt and Shift to the group before or
   after), and so does «Move to…». The detail is a native dialog at the center: on the left the title (edited in place),
   the description, the subtasks with «Add subtask» and the notes with «Add note» —a note is edited in place (Enter saves,
   Escape cancels), marked as a decision and back, or deleted with its «Undo»—; it reads the task by its id
   (`get_item`); on the right Place, Date with its hour,
   Priority, and Event (one of the coming events, a new one, or none), with the place kept for the mail; on top where it
   lives, «Previous» and «Next» through the list it came from, «More» (Duplicate, Versions, Delete), and «Close». The
   quick add reads what is typed (`src/lib/quick-add.ts`): it marks in the field what it understood and repeats it as
   chips —day, place, priority— whose selectors also take a piece out (the words stay in the title); after «#» it offers
   the places; it starts where its caller asks (`openQuickAdd`, `quick-add-bus.ts`), General when nobody asks, and at a
   group's foot it adds with that group's day. A link pasted over selected words, in a title, a note, or the quick add,
   stays on those words. The shell mounts the detail and the quick add once (`<TaskDetail />`, `<QuickAddDialog />`), and
   any row or caller opens them; the shell's `openItem` opens a task in this detail and keeps the side panel for a note or
   a decision.
6. **Chat**, on demand on the Overview and on every client's and project's page: the header's «Chat» docks it beside the
   page where the window holds both, and there it stays open from page to page until it is closed; where the window is
   narrow it opens as a sheet when asked, never by itself on load. It talks about the page's place —everything on the
   Overview, a project on its page— and keeps that place's conversation, with microphone, image attachment, cards for
   what it did, and one close, «Close chat». The workspace's own conversation offers «Review my day», a fixed suggestion
   sent as the person's words, which runs the daily review through `run_daily_review`; a client's or a project's chat does
   not offer it, because the review reads everything and a scoped context does not run it.
   **The daily review on screen** (`src/app/app/review-notice.tsx`, mounted once by the shell): the first time the person
   opens the workspace in their day, the browser posts `/api/review` with the day and the zone, and remembers the person
   and day it asked for, so a reload does not ask again (the server runs it once per person and day anyway); a tab left
   open asks again when it is looked at on another day (`visibilitychange`), and nothing is asked while it is hidden. When
   the run did something, the boxes read again —Activity shows it— and one sentence says what it did with its «Undo» («The
   daily review completed “Wait for the app review approval”: …», the line that decided it), each task named by the
   `task` its action carries (no read per task), once the page's boards entered and played their entrance and no dialog
   is open; it leaves the focus where it is. Its «Undo» undoes each action, what it completed first, through
   `POST /api/review/actions/<id>/undo`. The other answers are said in words: steps that failed (`failures`, with how
   many, and that asking in the chat tries them again), a run that is running (`skipped: "running"`: said once, the day not remembered, and asked again when the tab is looked at again, so a run cut short is picked up), the day's
   limit (429 `cap`: the server's own sentence, which says which limit and when it resets; the day is then remembered),
   and a run that did not run or stopped (its cause once —stopped before it finished, not reached, or a refusal's
   reason— and once that it runs again the next time the workspace opens: not remembered, so a stopped run is picked up
   where it stopped). The chat's cards say the same, and every card names what it wrote from its tool's output
   (`run_daily_review`'s `task`, and the `title` of `reorder_items`, `link_task_event`, `unlink_task_event`,
   `set_task_mail`, and `link_mail`), each with its undo: taking a task out of its event puts it back in the event
   `unlink_task_event` says it was in.
7. **Calendar** (`/app/calendar`, styled by `src/app/styles/calendar.css`): «Week | Month» in the header (the
   header's `views`, in the place «List | Board» takes), with «Previous», «Today», «Next», and «New event» over the
   grid. The week lays its days side by side, a band for whole-day events and tasks without an hour, and the hours of
   the working day widened to whatever falls outside it, overlapping pieces side by side; the month lays its weeks in
   rows with what fits in a day and «N more», which opens that week. On a narrow screen the week is a list of days and
   the month keeps its numbers with what each day holds, the chosen day listed below. Each event and task carries its
   place's color. It reads `browse_events`, `get_tasks` (with the finished ones), and `/api/accounts` once per range,
   and filters in the browser by the header's place and account (`place-filters.tsx`, shared with the other pages): a
   place brings the tasks and own events of its branch, what is linked to its branch, and the events of the accounts it
   sees; the account narrows the events of the connected accounts. Each option says what it brings, the other filter
   applied, and one that brings nothing is not offered. Another range leaves before the next enters (`use-swap.ts`);
   while it is read, what shows dims. A task dragged to a day takes that day, and so does Alt with the arrows (a day,
   or a week) on a focused task, each with «Undo». The week and the month are ARIA grids with one stop in the tab order
   (`grid-keys.ts`): the arrows move between days —and, in the week, between the whole-day band and each hour—, Home and
   End to the row's ends, Ctrl with them to the grid's, Page Up and Page Down by a few rows, and Enter or Space on a day or
   an hour opens the new event there. A press on a day's free space —or «New event»— opens the new event:
   its title, day, hour (or all day), the calendar it goes to (the workspace's own, or a connected account's that can be
   written) and its place. An event opens its detail: when, its place, the tasks and subtasks inside it (read for an
   event of the workspace's own) and the clients and projects linked to it, each taken off in place, «Link…» to add a
   task or a client or project, and «More» with Delete.
   **Mail** (`/app/mail`, styled by `src/app/styles/mail.css`): the list in «For your tasks», «Unread» and «Earlier»,
   each message with its sender, subject, time, and its place or the task that waits for it, «Important» where Gmail
   marks it; it reads `list_mail` over every account once and filters by place and account like the calendar (no
   account hangs from General, so General is not offered). Opening a message calls `POST /api/mail/opened`: it reads as
   read at once and keeps its place until the next read. The viewer (`mail/mail-viewer.tsx`) sits beside the list on a
   computer, sticky with its own scroll, and over it as a sheet of the whole screen on a phone. On top, its inbox row
   (sender, subject, the account it reached with its time, its place), «Light | Dark» and «Previous» and «Next» through
   the list; then the actions —«Create task» (`create_task_from_mail`), «Link to…» a task or a client or project
   (`link_mail`), and «Open in Gmail», disabled with its reason for a sample account— and what it is linked to; then
   the message. The message is painted in an `<iframe srcdoc>` sandboxed without `allow-scripts` (only
   `allow-same-origin`, so the page measures it, and popups that escape the sandbox, so its links open a new tab), under
   a content policy of its own: styles and inline pictures only, network images (`img-src https: http:`) once the person
   asks with «Show images», remembered per sender in the browser. It takes the reader's width; a design wider than that
   is scaled down whole, never scrolled sideways, and its height is the message's, so the viewer scrolls. «Light | Dark»
   opens in the product's theme or the last one chosen; a message with its own dark rules has them rewritten to follow
   the mode, a plain-text one takes the product's colors, and any other keeps its colors on its own paper, inset in a
   dark frame. Another message, mode or set of images fades out before the next fades in.
   **The Mail attribute of a task's detail** reads `get_item` (the mail it waits for, the messages linked to it, and the
   one the daily review decided by): where it waits —no mail, every account of its place, or one account its place
   sees—, from whom, the state and the sentence the review wrote, and «Stop waiting», all through `set_task_mail`; each
   message links to it on the Mail page.
8. **Trash**: what was deleted, each branch once, in one box of the page's column; «Restore» folds the row away and
   brings the whole branch back.
9. **Settings** (styled, with Trash, by `src/app/styles/settings.css`): the page's column of boxes —Theme; **Daily
   review**, a switch on by default and the instruction it follows, both saved as they change through
   `/api/preferences` (an empty instruction is not saved, and one being written is saved on leaving); **Google
   accounts**, each with the clients and projects it is connected to, which calendars are shown, and its mail (how many
   unread, from `list_mail`'s `unreadByAccount`, the count the sidebar adds up; no total of messages, which the list
   stops at its limit per account; or why it could not be read); and **Agent tokens** of every client,
   project, and subproject, issued for the one chosen (a page's «Agent token…» arrives with it chosen), with the
   `.mcp.json` block to copy—. A session opened without an account says that connecting needs a Google sign-in, and
   offers it.

## Interaction principles

- **The main action is one click away**: "Add task" is always visible (the sidebar's, Q, the phone's), and quick add takes priority and due date
  on the same line. What is created inside a node stays in that node.
- **New things are born complete**: a task takes the open node and defaults; a node is created in place in the
  tree; picking a node that does not exist offers to create it with what was typed.
- **No "Save" button**: edits save when typing stops, pending edits save on leaving, and a short accessible notice
  says "Saving… / Saved".
- **A row opens, its detail edits**: a press on a task's row opens its detail, a dialog over the page and not a new page,
  where the title, the description, and every attribute change in place (Enter confirms, Escape cancels); the row keeps
  only its own controls —the circle that completes it, its date, its subtasks, and its «More»—, and Escape closes the
  detail with the focus back on the row.
- **Delete does not ask, it offers undo**: a task is deleted from its «More» or its detail, never by a button of its own
  on the row; the row folds away and "Deleted · Undo" shows for a few seconds; only what cannot be undone asks for
  confirmation.
  What the chat or an agent did undoes the same way.
- **Command palette (Ctrl/Cmd+K)**: finds nodes, items, and actions, tolerates typos, is navigated with arrows and
  Enter, and opening an action lands on the exact place with focus set.
- **Back returns to where you were**, and a session resumes on the last open node.
- **Every empty state says what is missing**, and carries its own button when what fills it is not already in view; "no
  results" is not "nothing yet". One action has one control on screen.
- **Advanced fields appear on demand.**
- **One name per concept**, the same in the sidebar, the page, and the palette: Overview, Clients, Projects, Tasks,
  General (the work of no client or project), Calendar (the page and the box that shows the week), Mail, Activity,
  Notes, Settings, Agent tokens; who wrote something is "By hand", "By the chat", or "By an agent · its token's name"; one verb per action
  ("Added task" in the activity and in the chat's cards); nothing in the navigation repeats a name the page uses for
  something else.
- **A control keeps its words at every width**: a segmented control whose options do not fit on one line takes tighter
  air, and only then puts its options two to a row; a label never breaks and never changes its name.
- **Filters live in the page's header, one per axis**: the place and the mail account on the Overview, the place on
  Tasks; a box carries no filter of its own, and there is no separate filters card.
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
  rail and piece), ink (ink, soft ink, muted), the accent —a deep tone for what reads as text and the focus, a light
  sky-blue fill with navy ink for the main action and the mark— and its tint, the states (alert, warn, info), the colors
  a person gives a client or a project (`--node-*`, named as `src/lib/node-colors.ts`), what a task's state says (its
  date's nearness, `--due-*`; its priority's circle, `--prio-*`; the mail it waits for, `--mail-*`), what the browser
  draws (focus, selection, scrollbar), shadows composed from one ink, four type sizes, space (the sidebar's row and the
  page's column among them), shape, motion, and layers. The palette is cold neutrals with a navy hue and a sky-blue
  accent; every text role reads at 4.5:1 and every control and color mark at 3:1 against each surface it sits on. The
  light and the dark theme —two close navy grays— are two sets of values for the same roles.
- **Primitives** (`src/app/styles/system.css`, `src/components/ui/`): type by role (`.t-h1`, `.t-title`, `.t-label`,
  `.t-value`, `.t-name`, `.t-body`, `.t-help`, `.t-meta`, `.t-code`), the card, the button (control, primary, quiet, danger), the
  field, the dropdown, the date picker with its calendar, the checkbox, pills, the segmented control and tabs whose
  chosen piece travels, the theme switch, skeletons, folds, notices, native dialogs that enter and leave animated, and the
  menu button (`menu.tsx`, WAI-ARIA APG Menu Button over Base UI: a button in words, its options walked with the arrows,
  submenus, and a list that enters and leaves animated). A popup opened inside a modal dialog mounts inside that dialog
  (`popup-layer.tsx`): mounted on the body it would paint behind the dialog's top layer and take no click.
  The frame every page shares —the sidebar, the page's header, the phone's bar and drawer— is in
  `src/app/styles/shell.css`, and the screens (`src/app/styles/screens.css`) compose the rest.
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
- **Where the window is narrow**, the sidebar lives in a drawer opened from the bar's "Menu", "Add task" floats at the
  bottom right, the chat is a sheet over the
  page, and a list's rows stack their controls under the title by the width of the list itself (a container query), so a
  list in a column of the board and a list on a phone arrange the same way.
- **The guard**: `pnpm check` runs `scripts/check-system.mjs`, which counts what escapes the system —stock icons,
  native pickers in the screens, color literals outside the roles, Tailwind sizes and colors instead of roles, and a
  `:hover` outside `@media (hover: hover)`— against caps that only go down.
