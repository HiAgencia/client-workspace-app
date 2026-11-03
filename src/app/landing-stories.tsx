import type { CSSProperties, ReactNode } from "react";
import {
  AddIcon,
  AttachImageIcon,
  CloseIcon,
  CopiedIcon,
  DateIcon,
  MailIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  PriorityIcon,
  SendIcon,
  TasksIcon,
  TimeIcon,
  UndoIcon,
} from "@/components/ui/icons";
import { GoogleCalendarMark, GoogleMark, MetaMark } from "@/components/ui/brands";
import { mcpJson } from "@/lib/agent-token";
import { count } from "@/lib/count";
import { ASSISTANT_MODELS, ASSISTANT_NAME } from "@/lib/product";
import { PathText, SenderMark } from "./app/item-parts";
import { TaskRow, TODAY } from "./landing-shot";
import { RevealColumn, Scene, VisitorStamp, type Frame, type SceneGlyphs } from "./landing-motion";






const GLYPHS: SceneGlyphs = { pause: <PauseIcon />, play: <PlayIcon /> };

function Story({ id, title, children, text, scene }: { id: string; title: string; children: ReactNode; text?: ReactNode; scene: ReactNode }) {
  return (
    <section className="story" aria-labelledby={id}>
      <div className="story-text">
        <h2 id={id} className="story-title">
          {title}
        </h2>
        <p className="story-body">{children}</p>
        {text}
      </div>
      {scene}
    </section>
  );
}



type PlaceView = {
  key: "1" | "2" | "3";
  trail: string;
  name: string;
  color?: string;
  account: string;
  task: { title: string; priority: 1 | 2 | 3; when: { label: string; tone: "overdue" | "today" | "tomorrow"; hour?: boolean }; where?: string };
  event: { at: string; title: string };
  mail: { from: string; email: string; subject: string };
};

const PLACES: readonly PlaceView[] = [
  {
    key: "1",
    trail: "Clients",
    name: "Larkspur Bakery",
    color: "amber",
    account: "hello@larkspur.example",
    task: { title: "Send the homepage draft for review", priority: 1, when: { label: "4:00 PM", tone: "today", hour: true }, where: "Website" },
    event: { at: "2:00 PM", title: "Photo review with Maya" },
    mail: { from: "Maya Chen", email: "maya@larkspur.example", subject: "New photos for the homepage" },
  },
  {
    key: "2",
    trail: "Clients",
    name: "Studio Atlas",
    color: "violet",
    account: "atlas@harborline.example",
    task: { title: "Present two logo directions", priority: 3, when: { label: "Tomorrow", tone: "tomorrow" }, where: "Brand refresh" },
    event: { at: "5:00 PM", title: "Logo directions with Ana" },
    mail: { from: "Ana Ruiz", email: "ana@studioatlas.example", subject: "Survey results" },
  },
  {
    key: "3",
    trail: "Projects",
    name: "Operations",
    account: "ops@harborline.example",
    task: { title: "Send the October invoices", priority: 2, when: { label: "Yesterday", tone: "overdue" } },
    event: { at: "9:30 AM", title: "Weekly planning" },
    mail: { from: "Developer Platform", email: "noreply@developers.example", subject: "Your app review was approved" },
  },
];

const SIDE = [
  { group: "Clients", rows: [{ name: "Larkspur Bakery", color: "amber", open: 7, at: "1" }, { name: "Lumen Dental", open: 2 }, { name: "Studio Atlas", color: "violet", open: 4, at: "2" }] },
  { group: "Projects", rows: [{ name: "Agency website", color: "blue", open: 3 }, { name: "Component library", open: 2 }, { name: "Operations", open: 7, at: "3" }] },
];

const PLACE_FRAMES: readonly Frame[] = [
  { set: ["at-1"], ms: 3600 },
  { set: ["at-2"], ms: 3600 },
  { set: ["at-3"], ms: 3600 },
];

function PlacesScene() {
  return (
    <Scene
      frames={PLACE_FRAMES}
      still={0}
      glyphs={GLYPHS}
      className="story-scene places-scene"
      label="In the picture, the sidebar moves from Larkspur Bakery to Studio Atlas and to Operations, and each one's page shows its own account, its next task, its meeting and its mail."
    >
      <div className="story-stage places-stage">
        <div className="places-side side-nav">
          {SIDE.map((part) => (
            <div key={part.group} className="side-group">
              <span className="side-toggle">{part.group}</span>
              <ul className="tree">
                {part.rows.map((row) => (
                  <li key={row.name}>
                    <div className="tree-row">
                      <span className="tree-toggle-slot" />
                      <span className="side-link" data-depth="1" data-at={row.at}>
                        <span className="side-mark" data-color={row.color} />
                        <span className="side-link-name">{row.name}</span>
                        <span className="side-count">{row.open}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="places-page">
          {PLACES.map((place) => (
            <div key={place.key} className="places-view" data-show={`at-${place.key}`}>
              <div className="page-header-text">
                <p className="page-trail">
                  <span className="page-trail-here">{place.trail}</span>
                </p>
                <div className="page-title-line">
                  <span className="page-mark" data-color={place.color}>
                    <span>{place.name.charAt(0)}</span>
                  </span>
                  <p className="t-h1 page-title">{place.name}</p>
                </div>
              </div>
              <div className="node-strip">
                <div className="node-strip-group">
                  <p className="t-label named-label">Accounts</p>
                  <span className="btn node-chip">
                    <span className="node-chip-name t-name">
                      <GoogleMark className="node-chip-mark" />
                      {place.account}
                    </span>
                    <span className="node-chip-detail">1 unread, 1 calendar</span>
                  </span>
                </div>
              </div>
              <div className="box places-box" data-shown="">
                <div className="places-part">
                  <p className="places-kind">
                    <TasksIcon />
                    Tasks
                  </p>
                  <ul className="task-list" data-layout="list">
                    <li className="task-item">
                      <div className="task" data-layout="list">
                        <span className="task-circle task-check" data-priority={place.task.priority} />
                        <p className="task-title t-value">{place.task.title}</p>
                        <div className="task-meta t-meta">
                          <span className="task-when" data-when={place.task.when.tone}>
                            <span className="picker chip-picker task-when-trigger">
                              {place.task.when.hour ? <TimeIcon className="picker-icon" /> : <DateIcon className="picker-icon" />}
                              <span className="picker-value">{place.task.when.label}</span>
                            </span>
                          </span>
                          {place.task.priority === 1 && (
                            <span className="task-priority" data-priority={1}>
                              <PriorityIcon />
                              Urgent
                            </span>
                          )}
                          {place.task.where && (
                            <span className="task-place">
                              <span className="task-place-name" data-color={place.color}>
                                <PathText path={place.task.where} />
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
                <div className="places-part">
                  <p className="places-kind">
                    <DateIcon />
                    Calendar
                  </p>
                  <ul className="event-list">
                    <li className="event-row">
                      <span className="event-when">{place.event.at}</span>
                      <span className="event-what" data-color={place.color}>
                        <span className="event-title">{place.event.title}</span>
                        <span className="event-where">{place.account}</span>
                        <GoogleCalendarMark className="event-source" />
                      </span>
                    </li>
                  </ul>
                </div>
                <div className="places-part">
                  <p className="places-kind">
                    <MailIcon />
                    Mail
                  </p>
                  <ul className="mail-list">
                    <li>
                      <span className="mail-row" data-unread="">
                        <SenderMark name={place.mail.from} email={place.mail.email} />
                        <span className="mail-from">{place.mail.from}</span>
                        <span className="mail-subject">{place.mail.subject}</span>
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Scene>
  );
}



const REPLY_FRAMES: readonly Frame[] = [
  { set: [], ms: 2000 },
  { set: ["aim-yes"], ms: 800 },
  { set: ["aim-yes", "press-yes"], ms: 260 },
  { set: ["asked"], ms: 1900 },
  { set: ["asked", "aim-approved"], ms: 800 },
  { set: ["asked", "aim-approved", "press-approved"], ms: 260 },
  { set: ["asked", "closed"], ms: 3400 },
  { set: ["asked", "closed", "quiet"], ms: 1200 },
];

function RepliesScene() {
  
  const reply = (subject: string, offset: number, aim: boolean) => (
    <>
      <SenderMark name="Developer Platform" email="noreply@developers.example" />
      <span className="task-mail-link">
        <span className="t-value">{subject}</span>
        <span className="t-meta">
          Developer Platform · <VisitorStamp offset={offset} />
        </span>
      </span>
      <span className="task-reply-actions">
        <span className="btn btn-sm" {...(aim ? { "data-aim": "yes" } : {})}>
          <span className="btn-label">Mark as answer</span>
        </span>
        <span className="btn btn-quiet btn-sm">
          <span className="btn-label">Dismiss</span>
        </span>
      </span>
    </>
  );
  
  const card = (twin: boolean) => (
    <div className="card replies-card" data-twin={twin ? "" : undefined} aria-hidden={twin || undefined}>
      <div className="replies-task">
        <span className="task-circle" data-priority={3} />
        <p className="t-title replies-title">Wait for the app review approval</p>
        <span className="task-place-name">
          <PathText path="Operations" />
        </span>
      </div>
      <section className="task-wait replies-wait" data-state="waiting">
        <header className="task-wait-head">
          <MailIcon className="task-wait-icon" />
          <p className="task-wait-title">Waiting for mail</p>
        </header>
        <div className="task-wait-part task-mail-words">
          <span className="t-label">What it waits for</span>
          <span className="field replies-words">Developer Platform</span>
        </div>
        <div className="task-wait-part task-replies">
          <div className="task-replies-head">
            <p className="task-replies-title">
              Possible replies<span className="task-section-count">2</span>
            </p>
            <p className="t-meta">
              What arrived since <VisitorStamp offset={-7} /> with these words. You decide which one answers it.
            </p>
          </div>
          <ul className="task-reply-list">
            {}
            <li className="task-reply">
              {reply("Your app review was approved", 0, true)}
              <span className="task-reply-outcome replies-outcome" data-show="asked">
                <span className="t-label">How did it end?</span>
                <span className="task-reply-actions">
                  <span className="btn btn-sm" data-aim="approved">
                    <span className="btn-label">Approved</span>
                  </span>
                  <span className="btn btn-sm">
                    <span className="btn-label">Rejected</span>
                  </span>
                </span>
              </span>
            </li>
            <li className="task-reply replies-next">{reply("API changes coming in November", -4, false)}</li>
          </ul>
        </div>
      </section>
    </div>
  );
  return (
    <Scene
      frames={REPLY_FRAMES}
      still={3}
      glyphs={GLYPHS}
      className="story-scene replies-scene"
      label="In the picture, the task that waits for the app review shows two possible replies; the first one is chosen, and the task is closed as approved."
    >
      <div className="story-stage replies-stage">
        {}
        <div className="replies-room">
          {card(false)}
          {card(true)}
        </div>
        <div className="notice replies-notice">
          <span className="notice-mark" aria-hidden="true">
            <CopiedIcon />
          </span>
          <span className="t-value notice-text">Closed “Wait for the app review approval”: Approved</span>
          <span className="btn btn-primary btn-sm">
            <span className="btn-label">Undo</span>
          </span>
        </div>
      </div>
    </Scene>
  );
}



const CHAT_FRAMES: readonly Frame[] = [
  { set: [], ms: 1800 },
  { set: ["sent"], ms: 900 },
  { set: ["sent", "typing"], ms: 1500 },
  { set: ["sent", "acted"], ms: 1000 },
  { set: ["sent", "acted", "told"], ms: 4200 },
];

function ChatScene() {
  return (
    <Scene
      frames={CHAT_FRAMES}
      still={4}
      glyphs={GLYPHS}
      className="story-scene chat-scene"
      label={`In the picture, the person asks the chat to remind them to chase the Studio Atlas payment today; ${ASSISTANT_NAME} adds the task, offers its Undo, and says where it put it.`}
    >
      <div className="story-stage chat-stage">
        <div className="card chat landing-chat">
          <div className="chat-head">
            <span className="chat-icon">
              <MetaMark />
            </span>
            <div className="stack chat-title">
              <p className="t-title">{ASSISTANT_NAME}</p>
              <p className="t-meta chat-models">{ASSISTANT_MODELS}</p>
              <p className="t-meta chat-reach">All clients and projects</p>
            </div>
            <span className="btn btn-quiet btn-sm btn-icon">
              <CloseIcon />
            </span>
          </div>
          <div className="chat-log">
            <div className="shot-stack landing-chat-log">
              <p className="inline-note" data-hide="sent">
                Ask what is pending across every client and project, to add a task to one of them by its name, or what arrived for the tasks that wait for mail.
              </p>
              <div className="landing-chat-thread" data-show="sent">
                <div className="msg" data-role="user">
                  <p className="msg-bubble msg-text t-value">Remind me to chase the Studio Atlas payment today.</p>
                </div>
                <div className="msg">
                  <span className="shot-stack">
                    <span className="typing" data-show="typing">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="action-card" data-show="acted">
                      <span className="action-mark">
                        <CopiedIcon />
                      </span>
                      <span className="t-value action-text">Added task “Chase the Studio Atlas payment”</span>
                      <span className="btn btn-quiet btn-sm">
                        <UndoIcon />
                        <span className="btn-label">Undo</span>
                      </span>
                    </span>
                  </span>
                  <p className="msg-text t-body" data-show="told">
                    Added it to Operations, due today, with high priority.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="chat-compose">
            <div className="compose-line">
              <span className="field landing-chat-field">Ask {ASSISTANT_NAME}…</span>
              <span className="btn btn-primary">
                <SendIcon />
                <span className="btn-label">Send</span>
              </span>
            </div>
            <div className="compose-actions">
              <span className="btn btn-quiet btn-sm">
                <AttachImageIcon />
                <span className="btn-label">Attach an image</span>
              </span>
              <span className="btn btn-quiet btn-sm">
                <MicIcon />
                <span className="btn-label">Dictate</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Scene>
  );
}



const AGENT_FRAMES: readonly Frame[] = [
  { set: [], ms: 1500 },
  { set: ["asked-1"], ms: 1100 },
  { set: ["asked-1", "answered-1"], ms: 2400 },
  { set: ["asked-1", "answered-1", "asked-2"], ms: 1100 },
  { set: ["asked-1", "answered-1", "asked-2", "answered-2"], ms: 900 },
  { set: ["asked-1", "answered-1", "asked-2", "answered-2", "added"], ms: 3800 },
];

function AgentScene() {
  return (
    <Scene
      frames={AGENT_FRAMES}
      still={5}
      glyphs={GLYPHS}
      className="story-scene agent-scene"
      label="In the picture, a coding agent asks the workspace what changed since its last session, then asks for a review of a pull request, and the review lands among today's tasks marked as the agent's."
    >
      <div className="story-stage agent-stage">
        <pre className="read-block t-code agent-log">
          <code>
            <span className="code-line agent-line agent-where">~/code/larkspur-website</span>
            {}
            <span className="shot-stack">
              <span className="code-line" data-hide="asked-1">
                <span className="agent-prompt">›</span> <span className="agent-caret" />
              </span>
              <span className="code-line" data-show="asked-1">
                <span className="agent-prompt">›</span> What changed in this project since my last session?
              </span>
            </span>
            <span className="code-line agent-line agent-tool" data-show="answered-1">
              <span className="agent-dot" />client-workspace · get_updates_since
            </span>
            <span className="code-line agent-line agent-said" data-show="answered-1">
              Maya sent new photos for the homepage, and its draft is due today at 4:00 PM.
            </span>
            <span className="code-line agent-line" data-show="asked-2">
              <span className="agent-prompt">›</span> Ask for a review of the checkout pull request.
            </span>
            <span className="code-line agent-line agent-tool" data-show="answered-2">
              <span className="agent-dot" />client-workspace · request_review
            </span>
          </code>
        </pre>
        <div className="box agent-box" data-shown="">
          <div className="group">
            <div className="group-head">
              <p className="group-title" data-when="today">
                Today
              </p>
              <span className="group-count">
                <span className="shot-swap">
                  <span data-hide="added">{count(TODAY.length - 1, "task", "tasks")}</span>
                  <span data-show="added">{count(TODAY.length, "task", "tasks")}</span>
                </span>
              </span>
              <div className="group-action">
                <span className="btn btn-quiet btn-sm head-action">
                  <AddIcon />
                  <span className="btn-label">Add task</span>
                </span>
              </div>
            </div>
            {}
            <ul className="task-list" data-layout="list">
              {TODAY.map((row, index) =>
                index === TODAY.length - 1 ? <TaskRow key={row.title} row={row} show="added" className="agent-row" /> : <TaskRow key={row.title} row={row} />,
              )}
            </ul>
          </div>
        </div>
      </div>
    </Scene>
  );
}

export function LandingStories({ endpoint }: { endpoint: string }) {
  
  return (
    <RevealColumn className="stories">
      <Story id="story-places" title="Every client keeps its own accounts." scene={<PlacesScene />}>
        Hang a Google account on the client or project it serves. Its calendar and its mail land there, beside the tasks, and an
        account on a client reaches every one of its projects.
      </Story>
      <Story id="story-replies" title="The workspace finds the reply. You decide." scene={<RepliesScene />}>
        Say in your words what a task waits for. What arrives with those words shows up as a possible reply, and the task stays
        open until you say which one answered it and how it ended.
      </Story>
      <Story id="story-chat" title="A chat that acts only when you ask." scene={<ChatScene />}>
        It runs on {ASSISTANT_MODELS}, with the tools you use: it adds tasks, records decisions and tells you
        what is pending. It takes your voice and your screenshots too, and every change it makes comes with its Undo.
      </Story>
      <Story
        id="story-agent"
        title="Your coding agent works on the same projects."
        scene={<AgentScene />}
        text={
          <div className="agent-config">
            <p className="t-meta agent-config-name">
              .mcp.json
            </p>
            <pre className="read-block t-code agent-config-block">
              <code>
                {}
                {mcpJson(endpoint)
                  .split("\n")
                  .map((line, index) => (
                    <span key={index} className="code-line" style={{ "--indent": line.length - line.trimStart().length } as CSSProperties}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
              </code>
            </pre>
          </div>
        }
      >
        Issue a token on a client or a project and add one block to the repository’s .mcp.json. The agent asks what changed
        since its last session, and what it adds shows up marked as its own.
      </Story>
    </RevealColumn>
  );
}
