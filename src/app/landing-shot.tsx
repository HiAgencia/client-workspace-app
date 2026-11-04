import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import {
  AccountIcon,
  AddIcon,
  ByAgentIcon,
  ByChatIcon,
  CalendarIcon,
  ChatIcon,
  CopiedIcon,
  DateIcon,
  DownIcon,
  FilterIcon,
  MailIcon,
  MenuIcon,
  MoreIcon,
  NextIcon,
  NoteIcon,
  OpenIcon,
  OverviewIcon,
  PauseIcon,
  PlaceIcon,
  PlayIcon,
  PriorityIcon,
  RepliesIcon,
  RescheduleIcon,
  SearchIcon,
  SettingsIcon,
  SignOutIcon,
  SubtasksIcon,
  TasksIcon,
  TimeIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { GitHubMark, GoogleCalendarMark, type Mark } from "@/components/ui/brands";
import { count } from "@/lib/count";
import type { DemoOverview } from "@/lib/demo-seed";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { cx } from "@/lib/utils";
import { PathText, SenderMark } from "./app/item-parts";
import { Scene, VisitorDay, VisitorWeek, type Frame, type SceneGlyphs } from "./landing-motion";

const FRAMES: readonly Frame[] = [
  { set: ["back"], ms: 1600 },
  { set: ["arrived", "arriving"], ms: 1200 },
  { set: ["arrived", "found", "fresh"], ms: 1400 },
  { set: ["arrived", "found"], ms: 1500 },
  { set: ["arrived", "found", "done"], ms: 3400 },
  { set: ["arrived", "found", "done", "quiet"], ms: 1400 },
];
const STILL = 3;
const GLYPHS: SceneGlyphs = { pause: <PauseIcon />, play: <PlayIcon /> };

const WAITING = "Wait for the app review approval";

type Place = { path: string; color?: string };

type Row = {
  title: string;
  priority: 1 | 2 | 3 | 4;
  when?: { label: string; tone: "overdue" | "today"; hour?: boolean };
  subtasks?: string;
  notes?: number;
  waiting?: boolean;
  by?: { words: string; agent?: boolean };
  link?: Mark;
  live?: boolean;
  place: Place;
};

const OPERATIONS: Place = { path: "Operations" };
const WEBSITE: Place = { path: "Larkspur Bakery / Website", color: "amber" };

const OVERDUE: Row[] = [
  { title: WAITING, priority: 3, when: { label: "Yesterday", tone: "overdue" }, waiting: true, place: OPERATIONS, live: true },
  { title: "Send the October invoices", priority: 2, when: { label: "Yesterday", tone: "overdue" }, notes: 1, place: OPERATIONS },
];

export const TODAY: Row[] = [
  { title: "Send the homepage draft for review", priority: 1, when: { label: "4:00 PM", tone: "today", hour: true }, subtasks: "1/3", place: WEBSITE },
  { title: "Chase the Studio Atlas payment", priority: 2, by: { words: `By ${ASSISTANT_NAME}` }, place: OPERATIONS },
  { title: "Wait for the bank transfer", priority: 3, waiting: true, place: OPERATIONS },
  {
    title: "Review the checkout pull request",
    priority: 3,
    by: { words: "By Laptop", agent: true },
    link: GitHubMark,
    place: { path: "Larkspur Bakery / Website / Ordering flow", color: "amber" },
  },
];

const CLIENTS = [
  { name: "Larkspur Bakery", color: "amber", open: 7, holds: true },
  { name: "Lumen Dental", open: 2, holds: true },
  { name: "Studio Atlas", color: "violet", open: 4, holds: true },
];

const PROJECTS = [
  { name: "Agency website", color: "blue", open: 3, holds: true },
  { name: "Component library", open: 2 },
  { name: "Operations", open: 7 },
];

const EVENTS = [
  { at: "9:30 AM", title: "Weekly planning", where: "Operations" },
  { at: "2:00 PM", title: "Photo review with Maya", where: "Larkspur Bakery", color: "amber" },
  { at: "5:00 PM", title: "Logo directions with Ana", where: "Studio Atlas", color: "violet" },
];

function Swap({ children }: { children: ReactNode }) {
  return <span className="shot-swap">{children}</span>;
}

function PlaceName({ place }: { place: Place }) {
  return (
    <span className="task-place-name" data-color={place.color}>
      <PathText path={place.path} />
    </span>
  );
}

function LinkTitle({ mark: Glyph, title }: { mark: Mark; title: string }) {
  const [first, ...rest] = title.split(" ");
  return (
    <span className="link inline-link">
      <span className="link-lead">
        <Glyph className="link-mark" />
        {first}
      </span>
      {rest.length > 0 && ` ${rest.join(" ")}`}
    </span>
  );
}

export function TaskRow({ row, show, className }: { row: Row; show?: string; className?: string }) {
  return (
    <li className={cx("task-item", className)} data-live={row.live ? "" : undefined} data-show={show}>
      <div className="task" data-layout="list">
        <span className="task-circle task-check" data-priority={row.priority} />
        <p className="task-title t-value">{row.link ? <LinkTitle mark={row.link} title={row.title} /> : row.title}</p>
        <div className="task-meta t-meta">
          {row.when && (
            <span className="task-when" data-when={row.when.tone}>
              <span className="picker chip-picker task-when-trigger" data-tone={row.when.tone === "overdue" ? "alert" : "accent"}>
                {row.when.hour ? <TimeIcon className="picker-icon" /> : <DateIcon className="picker-icon" />}
                <span className="picker-value">{row.when.label}</span>
              </span>
            </span>
          )}
          {row.subtasks && (
            <span className="task-subtasks-toggle">
              <SubtasksIcon />
              {row.subtasks}
            </span>
          )}
          {row.priority === 1 && (
            <span className="task-priority" data-priority={1}>
              <PriorityIcon />
              Urgent
            </span>
          )}
          {row.waiting && (
            <span className="task-mail" data-mail="waiting">
              <MailIcon />
              Waiting for mail
            </span>
          )}
          {row.notes && (
            <span className="task-notes">
              <NoteIcon />
              {count(row.notes, "note", "notes")}
            </span>
          )}
          {row.by && (
            <span className="task-source">
              {row.by.agent ? <ByAgentIcon /> : <ByChatIcon />}
              {row.by.words}
            </span>
          )}
          <span className="task-place">
            <PlaceName place={row.place} />
          </span>
        </div>
      </div>
    </li>
  );
}

function HeadLink() {
  return (
    <div className="box-tools">
      <span className="btn btn-quiet btn-sm head-action head-link">
        <span className="btn-label">Open</span>
        <OpenIcon />
      </span>
    </div>
  );
}

function Sidebar({ due, unread }: { due: number; unread: number }) {
  const branch = (node: { name: string; color?: string; open: number; holds?: boolean }) => (
    <li key={node.name}>
      <div className="tree-row">
        <span className={node.holds ? "tree-toggle" : "tree-toggle-slot"} />
        <span className="side-link" data-depth="1">
          <span className="side-mark" data-color={node.color} />
          <span className="side-link-name">{node.name}</span>
          <span className="side-count">{node.open}</span>
        </span>
      </div>
    </li>
  );
  return (
    <div className="shot-side">
      <div className="side-nav">
        <div className="side-top">
          <span className="brand side-brand">
            <BrandMark className="brand-mark" />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
        </div>
        <div className="side-actions">
          <span className="btn btn-primary side-add-task">
            <AddIcon />
            <span className="btn-label side-link-name">Add task</span>
            <kbd className="kbd side-key">Q</kbd>
          </span>
          <span className="field side-search">
            <SearchIcon />
            <span className="side-link-name">Search</span>
            <kbd className="kbd side-key">Ctrl K</kbd>
          </span>
        </div>
        <div className="side-scroll">
          <div className="side-main">
            <ul className="side-list">
              <li>
                <span className="side-link side-view" aria-current="page">
                  <OverviewIcon className="side-icon" />
                  <span className="side-view-text">
                    <span className="side-link-name">Overview</span>
                  </span>
                </span>
              </li>
              <li>
                <span className="side-link side-view">
                  <TasksIcon className="side-icon" />
                  <span className="side-view-text">
                    <span className="side-link-name">Tasks</span>
                  </span>
                  <span className="side-count">{due} due</span>
                </span>
              </li>
              <li>
                <span className="side-link side-view">
                  <CalendarIcon className="side-icon" />
                  <span className="side-view-text">
                    <span className="side-link-name">Calendar</span>
                  </span>
                </span>
              </li>
              <li>
                <span className="side-link side-view">
                  <MailIcon className="side-icon" />
                  <span className="side-view-text">
                    <span className="side-link-name">Mail</span>
                  </span>
                  <span className="side-count">
                    <Swap>
                      <span data-hide="arrived">{unread - 1}</span>
                      <span data-show="arrived">{unread}</span>
                    </Swap>
                  </span>
                </span>
              </li>
            </ul>
            <div className="side-group">
              <span className="side-toggle">Clients</span>
              <div className="side-group-body">
                <ul className="tree">{CLIENTS.map(branch)}</ul>
              </div>
            </div>
            <div className="side-group">
              <span className="side-toggle">Projects</span>
              <div className="side-group-body">
                <ul className="tree">{PROJECTS.map(branch)}</ul>
              </div>
            </div>
          </div>
        </div>
        <div className="side-foot">
          <span className="side-link">
            <TrashIcon className="side-icon" />
            <span className="side-link-name">Trash</span>
          </span>
          <span className="side-link">
            <SettingsIcon className="side-icon" />
            <span className="side-link-name">Settings</span>
          </span>
          <div className="side-account">
            <span className="side-avatar">D</span>
            <span className="t-meta side-who">Demo session</span>
            <span className="btn btn-quiet btn-sm btn-icon side-sign-out">
              <SignOutIcon />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Strip() {
  return (
    <section className="reply-strip">
      <div className="reply-strip-head">
        <span className="reply-strip-icon">
          <RepliesIcon />
        </span>
        <p className="t-title reply-strip-title">Possible replies</p>
        <span className="btn btn-quiet btn-sm reply-strip-more head-action">
          <span className="btn-label">
            <span className="shot-swap">
              <span data-hide="found">Show the tasks</span>
              <span data-show="found" data-hide="done">
                Show 1 more task
              </span>
              <span data-show="done">Show the task</span>
            </span>
          </span>
          <DownIcon />
        </span>
      </div>
      <div className="shot-stack" data-live="">
        <p className="t-help reply-strip-note" data-hide="found">
          2 tasks wait for mail, and nothing arrived for them yet.
        </p>
        <div className="reply-entry" data-show="found" data-hide="done">
          <span className="reply-entry-task">
            <span className="reply-entry-title">{WAITING}</span>
            <span className="pill reply-entry-tally" data-tone="accent">
              1 possible reply
            </span>
          </span>
          <span className="reply-entry-mail">
            <span className="reply-entry-from">Developer Platform</span>
            <span className="reply-entry-subject">Your app review was approved</span>
            <span className="reply-entry-when">10:12 AM</span>
          </span>
          <span className="reply-entry-go">
            Open the task
            <NextIcon />
          </span>
        </div>
        <p className="t-help reply-strip-note" data-show="done">
          One task waits for mail, and nothing arrived for it yet.
        </p>
      </div>
    </section>
  );
}

function TasksBox({ figures }: { figures: DemoOverview }) {
  return (
    <section className="box" data-shown="" data-shot-box="tasks">
      <header className="box-head">
        <span className="box-icon">
          <TasksIcon />
        </span>
        <p className="t-title box-title">Tasks</p>
        <span className="box-count">{figures.overdue + figures.today} due</span>
        <HeadLink />
      </header>
      <div className="box-body">
        <div className="box-read">
          <div className="groups" data-mode="box" data-layout="list">
            <section className="group">
              <div className="group-head">
                <p className="group-title" data-when="overdue">
                  Overdue
                </p>
                <span className="group-count">{count(figures.overdue, "task", "tasks")}</span>
                <div className="group-action">
                  <span className="picker chip-picker reschedule head-action">
                    <RescheduleIcon className="picker-icon" />
                    <span className="picker-value">Reschedule</span>
                  </span>
                </div>
              </div>
              <div className="task-group-body">
                <ul className="task-list" data-layout="list">
                  {OVERDUE.map((row) => (
                    <TaskRow key={row.title} row={row} />
                  ))}
                </ul>
              </div>
            </section>
            <section className="group">
              <div className="group-head">
                <p className="group-title" data-when="today">
                  Today
                </p>
                <span className="group-count">{count(figures.today, "task", "tasks")}</span>
                <div className="group-action">
                  <span className="btn btn-quiet btn-sm head-action">
                    <AddIcon />
                    <span className="btn-label">Add task</span>
                  </span>
                </div>
              </div>
              <div className="task-group-body">
                <ul className="task-list" data-layout="list">
                  {TODAY.map((row) => (
                    <TaskRow key={row.title} row={row} />
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function MailBox({ unread }: { unread: number }) {
  return (
    <section className="box" data-shown="" data-shot-box="mail">
      <header className="box-head">
        <span className="box-icon">
          <MailIcon />
        </span>
        <p className="t-title box-title">Mail</p>
        <span className="box-count">
          <Swap>
            <span data-hide="arrived">{unread - 1} unread</span>
            <span data-show="arrived">{unread} unread</span>
          </Swap>
        </span>
        <HeadLink />
      </header>
      <div className="box-body">
        <div className="box-read">
          <ul className="mail-list shot-mail">
            <li data-arriving="">
              <span className="mail-row" data-unread="">
                <SenderMark name="Developer Platform" email="noreply@developers.example" />
                <span className="mail-from">Developer Platform</span>
                <span className="mail-side">
                  <span className="mail-when">10:12 AM</span>
                </span>
                <span className="mail-subject">Your app review was approved</span>
                <span className="mail-for">
                  <Swap>
                    <span data-show="found" data-hide="done">1 possible reply for “{WAITING}”</span>
                    <span data-show="done">Completed task: {WAITING}</span>
                  </Swap>
                </span>
              </span>
            </li>
            <li>
              <span className="mail-row" data-unread="">
                <SenderMark name="Maya Chen" email="maya@larkspur.example" />
                <span className="mail-from">Maya Chen</span>
                <span className="mail-side">
                  <span className="pill mail-important" data-tone="warn">
                    Important
                  </span>
                  <span className="mail-when">9:48 AM</span>
                </span>
                <span className="mail-subject">New photos for the homepage</span>
                <span className="mail-for">For: Collect product photos from the client</span>
              </span>
            </li>
            <li>
              <span className="mail-row" data-unread="">
                <SenderMark name="Ana Ruiz" email="ana@studioatlas.example" />
                <span className="mail-from">Ana Ruiz</span>
                <span className="mail-side">
                  <span className="mail-when">9:05 AM</span>
                </span>
                <span className="mail-subject">Survey results</span>
                <span className="mail-for">
                  <PlaceName place={{ path: "Studio Atlas", color: "violet" }} />
                </span>
              </span>
            </li>
            <li>
              <span className="mail-row">
                <SenderMark name="Coworking Hub" email="billing@coworkinghub.example" />
                <span className="mail-from">Coworking Hub</span>
                <span className="mail-side">
                  <span className="mail-when">Yesterday</span>
                </span>
                <span className="mail-subject">Your October invoice is ready</span>
                <span className="mail-for">
                  <PlaceName place={OPERATIONS} />
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function CalendarBox() {
  return (
    <section className="box" data-shown="" data-shot-box="calendar">
      <header className="box-head">
        <span className="box-icon">
          <CalendarIcon />
        </span>
        <p className="t-title box-title">Calendar</p>
        <HeadLink />
      </header>
      <div className="box-body">
        <div className="box-read">
          <VisitorWeek />
          <div className="day-events">
            <p className="group-title" data-when="today">
              Today
            </p>
            <ul className="event-list">
              {EVENTS.map((event) => (
                <li key={event.title} className="event-row">
                  <span className="event-when">{event.at}</span>
                  <span className="event-what" data-color={event.color}>
                    <span className="event-title">{event.title}</span>
                    <span className="event-where">{event.where}</span>
                    <GoogleCalendarMark className="event-source" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingShot({ figures, caption }: { figures: DemoOverview; caption: string }) {
  const due = figures.overdue + figures.today;
  return (
    <figure className="landing-shot enter" aria-labelledby="shot-caption" data-landing-shot>
      <Scene frames={FRAMES} still={STILL} glyphs={GLYPHS} className="shot-scene" label="In the picture, a message from Developer Platform arrives, it shows as a possible reply for the task that waits for it, and the task is closed as approved.">
        <div className="shot">
          <Sidebar due={due} unread={figures.unread} />
          <div className="shot-topbar topbar">
            <span className="btn btn-quiet btn-icon">
              <MenuIcon />
            </span>
            <span className="brand">
              <BrandMark className="brand-mark" />
              <span className="brand-name">{PRODUCT_NAME}</span>
            </span>
          </div>
          <div className="shot-page">
            <header className="page-header">
              <div className="page-header-text">
                <p className="t-h1 page-title">Overview</p>
                <p className="page-count">
                  <VisitorDay />
                </p>
              </div>
              <div className="page-tools">
                <div className="page-filters">
                  <div className="named filter">
                    <span className="t-label named-label">
                      <PlaceIcon className="filter-icon" />
                    </span>
                    <span className="picker field">
                      <span className="picker-value">All clients and projects</span>
                    </span>
                  </div>
                  <div className="named filter">
                    <span className="t-label named-label">
                      <AccountIcon className="filter-icon" />
                    </span>
                    <span className="picker field">
                      <span className="picker-value">All accounts</span>
                    </span>
                  </div>
                </div>
                <span className="btn page-filter-open">
                  <FilterIcon />
                  <span className="btn-label">Filter</span>
                </span>
                <span className="btn">
                  <ChatIcon />
                  <span className="btn-label">Chat</span>
                </span>
                <span className="btn btn-icon">
                  <MoreIcon />
                </span>
              </div>
            </header>
            <Strip />
            <div className="shot-boxes">
              <div className="shot-col">
                <TasksBox figures={figures} />
                <div className="shot-foot">
                  <div className="notice shot-notice">
                    <span className="notice-mark" aria-hidden="true">
                      <CopiedIcon />
                    </span>
                    <span className="t-value notice-text">Closed “{WAITING}”: Approved</span>
                    <span className="btn btn-primary btn-sm">
                      <span className="btn-label">Undo</span>
                    </span>
                  </div>
                  <span className="btn btn-primary shot-add-task">
                    <AddIcon />
                    <span className="btn-label">Add task</span>
                  </span>
                </div>
              </div>
              <div className="shot-col">
                <MailBox unread={figures.unread} />
                <CalendarBox />
              </div>
            </div>
          </div>
        </div>
      </Scene>
      <figcaption id="shot-caption" className="t-meta shot-caption">
        {caption}
      </figcaption>
    </figure>
  );
}
