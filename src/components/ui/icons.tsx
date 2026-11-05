import type { SVGProps } from "react";
import { cx } from "@/lib/utils";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string };
export type Icon = (props: IconProps) => React.ReactElement;

type Motion = "forward" | "back" | "up" | "down" | "turn" | "turn-back";

const STROKE = 2.25;

function tile(x: number, y: number, w: number, h: number): string {
  const r = Math.round(((Math.min(w, h) + STROKE) / 4 - STROKE / 2) * 4) / 4;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}
function ring(x: number, y: number, r: number): string {
  return `M${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}Z`;
}
function dot(x: number, y: number): string {
  return ring(x, y, 0.75);
}
function spoke(angle: number, from: number, to: number): string {
  const a = (angle * Math.PI) / 180;
  const p = (r: number) => `${+(12 + r * Math.cos(a)).toFixed(3)} ${+(12 + r * Math.sin(a)).toFixed(3)}`;
  return `M${p(from)}L${p(to)}`;
}

const CALENDAR = [tile(3, 5, 18, 16), "M8 3V6.5", "M16 3V6.5"];
const BUBBLE = "M6 3H18A3 3 0 0 1 21 6V14A3 3 0 0 1 18 17H11L6.5 20.5V17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z";
const ENVELOPE = tile(3, 5, 18, 14);
const HILL = "M3 17L8 13L12.5 16.5L15.5 14L21 17";

const GLYPHS = {
  overview: ["M3.5 10.5L12 3.5L20.5 10.5", "M6 9V18.5A2.5 2.5 0 0 0 8.5 21H15.5A2.5 2.5 0 0 0 18 18.5V9"],
  tasks: [tile(3, 3, 18, 18), "M8 12.5L10.75 15.25L16 9.75"],
  task: [tile(3, 3, 18, 18)],
  calendar: [...CALENDAR, "M7 10.5H17"],
  mail: [ENVELOPE, "M7 9.5L12 13L17 9.5"],
  trash: [
    "M4 6H20",
    "M9 6V4.75A1.5 1.5 0 0 1 10.5 3.25H13.5A1.5 1.5 0 0 1 15 4.75V6",
    "M6 10V18.5A2.5 2.5 0 0 0 8.5 21H15.5A2.5 2.5 0 0 0 18 18.5V10",
  ],
  settings: [ring(12, 12, 6.25), ring(12, 12, 2.25), ...[30, 90, 150, 210, 270, 330].map((a) => spoke(a, 6.25, 9))],
  general: [tile(3, 3, 18, 18), "M3 13H8L9.5 15.5H14.5L16 13H21"],
  place: [tile(3, 3, 18, 18), "M7 8H12", "M9.5 12H14.5", "M12 16H17"],
  client: [ring(12, 7.25, 3.25), "M5 20A5.5 5.5 0 0 1 10.5 14.5H13.5A5.5 5.5 0 0 1 19 20"],
  ownProject: [
    tile(3, 7, 18, 13),
    "M9 7V5.5A1.5 1.5 0 0 1 10.5 4H13.5A1.5 1.5 0 0 1 15 5.5V7",
    "M8 12.5H16",
  ],
  account: [ring(12, 12, 3.5), "M15.5 9V13.25A2.25 2.25 0 0 0 20 13.25V12A8 8 0 1 0 16.8 18.4"],
  noDate: [...CALENDAR, "M15 10.5L9 16.5"],
  add: ["M12 5V19", "M5 12H19"],
  search: [ring(10.5, 10.5, 6.5), "M15.5 15.5L20 20"],
  chat: [BUBBLE],
  more: [dot(6, 12), dot(12, 12), dot(18, 12)],
  close: ["M7 7L17 17", "M17 7L7 17"],
  duplicate: ["M5.25 14A2.25 2.25 0 0 1 3 11.75V5.25A2.25 2.25 0 0 1 5.25 3H11.75A2.25 2.25 0 0 1 14 5.25", tile(10, 10, 11, 11)],
  check: ["M5 12.5L9.5 17L19 7.5"],
  forward: ["M5 12H19", "M13.5 6.5L19 12L13.5 17.5"],
  replies: [ENVELOPE, "M10 9L7.5 11.5L10 14", "M7.5 11.5H13.5A3 3 0 0 1 16.5 14.5"],
  link: ["M10 8H8A4 4 0 0 0 8 16H10", "M14 8H16A4 4 0 0 1 16 16H14", "M9 12H15"],
  undo: ["M8.5 5L4.5 9L8.5 13", "M4.5 9H16.5A3 3 0 0 1 19.5 12V16A3 3 0 0 1 16.5 19H12"],
  restore: [
    "M6.5 14V16A3 3 0 0 0 9.5 19H17.5A3 3 0 0 0 20.5 16V8A3 3 0 0 0 17.5 5H9.5A3 3 0 0 0 6.5 8V10",
    "M4 7.5L6.5 10L9 7.5",
  ],
  signOut: ["M10.5 4H7.5A3.5 3.5 0 0 0 4 7.5V16.5A3.5 3.5 0 0 0 7.5 20H10.5", "M10 12H20", "M16.5 8.5L20 12L16.5 15.5"],
  switchAccount: ["M4 8H17", "M14 5L17 8L14 11", "M20 16H7", "M10 13L7 16L10 19"],
  filter: ["M4 8H10.5", "M15.5 8H20", ring(13, 8, 2.5), "M4 16H6", "M11 16H20", ring(8.5, 16, 2.5)],
  menu: ["M4 7H20", "M4 12H20", "M4 17H20"],
  send: ["M12 19V5", "M6.5 10.5L12 5L17.5 10.5"],
  mic: ["M12 3A3 3 0 0 1 15 6V10A3 3 0 0 1 9 10V6A3 3 0 0 1 12 3Z", "M5 10A7 7 0 0 0 19 10", "M12 17V21"],
  attachImage: [
    "M11 3H7A4 4 0 0 0 3 7V17A4 4 0 0 0 7 21H17A4 4 0 0 0 21 17V12",
    "M18 3V9",
    "M15 6H21",
    HILL,
  ],
  image: [tile(3, 3, 18, 18), dot(8.5, 8), HILL],
  event: [...CALENDAR, "M7 10.5H17", "M7 15.5H12"],
  reschedule: [...CALENDAR, "M7.5 13H16", "M13.5 10.5L16 13L13.5 15.5"],
  previous: ["M15 6L9 12L15 18"],
  next: ["M9 6L15 12L9 18"],
  up: ["M6 15L12 9L18 15"],
  down: ["M6 9L12 15L18 9"],
  time: [ring(12, 12, 9), "M12 7.5V12H15.5"],
  subtasks: ["M4.5 5.5H15.5", "M7.5 5.5V16A3 3 0 0 0 10.5 19H19.5", "M7.5 12H19.5"],
  priority: ["M5.5 3.5V20.5", "M5.5 4.5H18.5L15.5 9L18.5 13.5H5.5"],
  note: [
    "M7 3H17A4 4 0 0 1 21 7V14L14 21H7A4 4 0 0 1 3 17V7A4 4 0 0 1 7 3Z",
    "M14 21V17A3 3 0 0 1 17 14H21",
    "M7.5 8.5H16.5",
    "M7.5 12.5H11.5",
  ],
  decision: [
    "M12 4V20",
    "M8 20H16",
    "M5.5 7H18.5",
    "M5.5 7V13",
    "M18.5 7V13",
    "M3 13H8A2.5 2.5 0 0 1 3 13Z",
    "M16 13H21A2.5 2.5 0 0 1 16 13Z",
  ],
  byChat: [BUBBLE, "M7.5 8H13.5", "M10.5 12H16.5"],
  byAgent: [tile(3, 3, 18, 18), "M7.5 9L10.5 12L7.5 15", "M13.5 15H16.5"],
  activity: ["M3 12H7L9.5 6L14.5 18L17 12H21"],
  versions: [tile(3, 8, 18, 12.5), "M6 4H18"],
  color: ["M12 3.5L17 10A6.5 6.5 0 1 1 7 10Z"],
  token: [ring(7.5, 12, 4), "M11.5 12H20.5", "M16.5 12V15", "M20.5 12V16"],
  grip: [dot(9, 6), dot(15, 6), dot(9, 12), dot(15, 12), dot(9, 18), dot(15, 18)],
  bold: ["M6.5 4.5H12.5A3.75 3.75 0 0 1 12.5 12H6.5Z", "M6.5 12H13.5A3.75 3.75 0 0 1 13.5 19.5H6.5Z"],
  italic: ["M11 4.5H17", "M7 19.5H13", "M14 4.5L10 19.5"],
  bullets: [dot(5, 6.5), dot(5, 12), dot(5, 17.5), "M10 6.5H20", "M10 12H20", "M10 17.5H20"],
  numbers: ["M4.5 5.5L6 4.5V9.5", "M4 15.5A2 2 0 1 1 7.6 16.7L4 20H8", "M12 7H20", "M12 17H20"],
  light: [ring(12, 12, 3), ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => spoke(a, 7, 9))],
  dark: ["M12.12 3.5A8.5 8.5 0 1 0 20.5 11.88A6 6 0 0 1 12.12 3.5Z"],
  alert: [tile(3, 3, 18, 18), "M12 7V11.5", dot(12, 16.25)],
  enterKey: ["M19.5 5.5V12A3 3 0 0 1 16.5 15H5", "M9 11L5 15L9 19"],
  pause: ["M9 6V18", "M15 6V18"],
  play: ["M7 5.5V18.5L18 12Z"],
  help: [ring(12, 12, 9), "M12 11V16.5", dot(12, 8)],
  guide: [ring(12, 12, 8), ring(12, 12, 3.5)],
} satisfies Record<string, string[]>;

type GlyphName = keyof typeof GLYPHS;

function named(glyph: GlyphName, motion?: Motion): Icon {
  const paths = GLYPHS[glyph];
  function ProductIcon({ className, size = 24, strokeWidth = STROKE, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cx("icon", motion && `icon-${motion}`, className)}
        {...props}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  ProductIcon.displayName = `Icon(${glyph})`;
  return ProductIcon;
}

export const OverviewIcon = named("overview");
export const TasksIcon = named("tasks");
export const TaskIcon = named("task");
export const CalendarIcon = named("calendar");
export const MailIcon = named("mail");
export const TrashIcon = named("trash");
export const SettingsIcon = named("settings");
export const GeneralIcon = named("general");
export const PlaceIcon = named("place");
export const ClientIcon = named("client");
export const OwnProjectIcon = named("ownProject");
export const AccountIcon = named("account");
export const NoDateIcon = named("noDate");

export const AddIcon = named("add", "turn");
export const SearchIcon = named("search");
export const ChatIcon = named("chat");
export const MoreIcon = named("more");
export const CloseIcon = named("close");
export const DuplicateIcon = named("duplicate");
export const DeleteIcon = named("trash");
export const CopiedIcon = named("check");
export const MoveIcon = named("forward", "forward");
export const OpenIcon = named("forward", "forward");
export const RepliesIcon = named("replies");
export const LinkIcon = named("link");
export const UndoIcon = named("undo", "turn-back");
export const RestoreIcon = named("restore", "turn-back");
export const SignOutIcon = named("signOut", "forward");
export const SwitchAccountIcon = named("switchAccount");
export const FilterIcon = named("filter");
export const MenuIcon = named("menu");
export const SendIcon = named("send", "up");
export const MicIcon = named("mic");
export const AttachImageIcon = named("attachImage");
export const ImageIcon = named("image");
export const EventIcon = named("event");
export const RescheduleIcon = named("reschedule");
export const PreviousIcon = named("previous", "back");
export const NextIcon = named("next", "forward");
export const UpIcon = named("up", "up");
export const DownIcon = named("down", "down");

export const DateIcon = named("calendar");
export const TimeIcon = named("time");
export const SubtasksIcon = named("subtasks");
export const PriorityIcon = named("priority");
export const NoteIcon = named("note");
export const DecisionIcon = named("decision");
export const ByChatIcon = named("byChat");
export const ByAgentIcon = named("byAgent");
export const ActivityIcon = named("activity");
export const VersionsIcon = named("versions");
export const ColorIcon = named("color");
export const TokenIcon = named("token");
export const GripIcon = named("grip");

export const BoldIcon = named("bold");
export const ItalicIcon = named("italic");
export const BulletsIcon = named("bullets");
export const NumbersIcon = named("numbers");

export const LightIcon = named("light");
export const DarkIcon = named("dark");
export const AlertIcon = named("alert");

export const EnterKeyIcon = named("enterKey");
export const PauseIcon = named("pause");
export const PlayIcon = named("play");
export const HelpIcon = named("help");
export const GuideIcon = named("guide");
