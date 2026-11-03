import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  AtSign,
  Bold,
  Briefcase,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  CircleAlert,
  CircleCheck,
  Circle,
  CirclePlus,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  Flag,
  GripVertical,
  Handshake,
  History,
  House,
  Image as ImageGlyph,
  ImagePlus,
  Inbox,
  Italic,
  Info,
  KeyRound,
  Layers,
  Link as LinkGlyph,
  List as ListGlyph,
  ListChecks,
  ListOrdered,
  LogOut,
  Mail,
  MailCheck,
  Menu as MenuGlyph,
  MessageSquare,
  MessageSquareText,
  Mic,
  Moon,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Reply,
  RotateCcw,
  Scale,
  Search,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  StickyNote,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { cx } from "@/lib/utils";





export type Icon = (props: LucideProps) => React.ReactElement;



type Motion = "forward" | "back" | "up" | "down" | "turn" | "turn-back" | "out";

function named(Glyph: LucideIcon, motion?: Motion): Icon {
  function ProductIcon({ className, ...props }: LucideProps) {
    return <Glyph aria-hidden="true" focusable="false" strokeWidth={1.75} className={cx("icon", motion && `icon-${motion}`, className)} {...props} />;
  }
  ProductIcon.displayName = `Icon(${Glyph.displayName ?? "glyph"})`;
  return ProductIcon;
}


export const OverviewIcon = named(House);
export const TasksIcon = named(CircleCheck);

export const TaskIcon = named(Circle);
export const CalendarIcon = named(Calendar);
export const MailIcon = named(Mail);
export const TrashIcon = named(Trash2);
export const SettingsIcon = named(Settings);
export const GeneralIcon = named(Inbox);
export const PlaceIcon = named(Layers);

export const ClientIcon = named(Handshake);
export const OwnProjectIcon = named(Briefcase);
export const AccountIcon = named(AtSign);
export const NoDateIcon = named(CalendarOff);


export const AddIcon = named(Plus, "turn");
export const AddCircleIcon = named(CirclePlus);
export const SearchIcon = named(Search);
export const ChatIcon = named(MessageSquare);
export const MoreIcon = named(Ellipsis);
export const CloseIcon = named(X);
export const EditIcon = named(Pencil);
export const DuplicateIcon = named(Copy);
export const DeleteIcon = named(Trash2);
export const CopyIcon = named(Copy);
export const CopiedIcon = named(Check);
export const MoveIcon = named(ArrowRight, "forward");

export const OpenIcon = named(ArrowRight, "forward");
export const RepliesIcon = named(MailCheck);
export const LinkIcon = named(LinkGlyph);
export const ExternalIcon = named(ExternalLink, "out");
export const ReplyIcon = named(Reply);
export const UndoIcon = named(Undo2, "turn-back");
export const RestoreIcon = named(RotateCcw, "turn-back");
export const SignOutIcon = named(LogOut, "forward");

export const SwitchAccountIcon = named(ArrowRightLeft);
export const FilterIcon = named(SlidersHorizontal);
export const MenuIcon = named(MenuGlyph);
export const SendIcon = named(ArrowUp, "up");
export const MicIcon = named(Mic);
export const AttachImageIcon = named(ImagePlus);
export const ImageIcon = named(ImageGlyph);
export const NewEventIcon = named(CalendarPlus);
export const EventIcon = named(CalendarDays);
export const RescheduleIcon = named(CalendarClock);
export const PreviousIcon = named(ChevronLeft, "back");
export const NextIcon = named(ChevronRight, "forward");
export const UpIcon = named(ChevronUp, "up");
export const DownIcon = named(ChevronDown, "down");


export const DateIcon = named(Calendar);
export const TimeIcon = named(Clock);
export const SubtasksIcon = named(ListChecks);
export const PriorityIcon = named(Flag);
export const NoteIcon = named(StickyNote);
export const DecisionIcon = named(Scale);

export const ByChatIcon = named(MessageSquareText);
export const ByAgentIcon = named(SquareTerminal);
export const ActivityIcon = named(Activity);
export const VersionsIcon = named(History);
export const ColorIcon = named(Palette);
export const TokenIcon = named(KeyRound);

export const GripIcon = named(GripVertical);


export const BoldIcon = named(Bold);
export const ItalicIcon = named(Italic);
export const BulletsIcon = named(ListGlyph);
export const NumbersIcon = named(ListOrdered);


export const LightIcon = named(Sun);
export const DarkIcon = named(Moon);
export const AlertIcon = named(CircleAlert);
export const InfoIcon = named(Info);


export const EnterKeyIcon = named(CornerDownLeft);

export const PauseIcon = named(Pause);
export const PlayIcon = named(Play);
