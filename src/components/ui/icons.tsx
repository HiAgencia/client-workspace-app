import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  AtSign,
  Bold,
  Bot,
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
  CircleAlert,
  CircleCheck,
  CirclePlus,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  Flag,
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
  Mic,
  Moon,
  Palette,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Scale,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { cx } from "@/lib/utils";





export type Icon = (props: LucideProps) => React.ReactElement;

function named(Glyph: LucideIcon): Icon {
  function ProductIcon({ className, ...props }: LucideProps) {
    return <Glyph aria-hidden="true" focusable="false" strokeWidth={1.75} className={cx("icon", className)} {...props} />;
  }
  ProductIcon.displayName = `Icon(${Glyph.displayName ?? "glyph"})`;
  return ProductIcon;
}


export const OverviewIcon = named(House);
export const TasksIcon = named(CircleCheck);
export const CalendarIcon = named(Calendar);
export const MailIcon = named(Mail);
export const TrashIcon = named(Trash2);
export const SettingsIcon = named(Settings);
export const GeneralIcon = named(Inbox);
export const PlaceIcon = named(Layers);
export const AccountIcon = named(AtSign);
export const NoDateIcon = named(CalendarOff);


export const AddIcon = named(Plus);
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
export const MoveIcon = named(ArrowRight);

export const OpenIcon = named(ArrowRight);
export const RepliesIcon = named(MailCheck);
export const LinkIcon = named(LinkGlyph);
export const ExternalIcon = named(ExternalLink);
export const ReplyIcon = named(Reply);
export const UndoIcon = named(Undo2);
export const RestoreIcon = named(RotateCcw);
export const SignOutIcon = named(LogOut);
export const FilterIcon = named(SlidersHorizontal);
export const MenuIcon = named(MenuGlyph);
export const SendIcon = named(ArrowUp);
export const MicIcon = named(Mic);
export const AttachImageIcon = named(ImagePlus);
export const ImageIcon = named(ImageGlyph);
export const NewEventIcon = named(CalendarPlus);
export const EventIcon = named(CalendarDays);
export const RescheduleIcon = named(CalendarClock);
export const PreviousIcon = named(ChevronLeft);
export const NextIcon = named(ChevronRight);
export const UpIcon = named(ChevronUp);
export const DownIcon = named(ChevronDown);


export const DateIcon = named(Calendar);
export const TimeIcon = named(Clock);
export const SubtasksIcon = named(ListChecks);
export const PriorityIcon = named(Flag);
export const NoteIcon = named(StickyNote);
export const DecisionIcon = named(Scale);
export const ByChatIcon = named(Sparkles);
export const ByAgentIcon = named(Bot);
export const ActivityIcon = named(Activity);
export const VersionsIcon = named(History);
export const ColorIcon = named(Palette);
export const TokenIcon = named(KeyRound);


export const BoldIcon = named(Bold);
export const ItalicIcon = named(Italic);
export const BulletsIcon = named(ListGlyph);
export const NumbersIcon = named(ListOrdered);


export const LightIcon = named(Sun);
export const DarkIcon = named(Moon);
export const AlertIcon = named(CircleAlert);
export const InfoIcon = named(Info);
