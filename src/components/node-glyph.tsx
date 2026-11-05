import {
  AccountIcon,
  CalendarIcon,
  ClientIcon,
  MailIcon,
  NoteIcon,
  OwnProjectIcon,
  PlaceIcon,
  TaskIcon,
  type Icon,
  type IconProps,
} from "@/components/ui/icons";
import { shownIcon, type NodeIconName } from "@/lib/node-icons";

const GLYPHS: Record<NodeIconName, Icon> = {
  client: ClientIcon,
  project: OwnProjectIcon,
  place: PlaceIcon,
  task: TaskIcon,
  calendar: CalendarIcon,
  mail: MailIcon,
  note: NoteIcon,
  account: AccountIcon,
};

export function glyphOf(name: NodeIconName): Icon {
  return GLYPHS[name];
}

export function NodeGlyph({ kind, icon, ...props }: { kind?: string | null; icon?: string | null } & IconProps) {
  const Glyph = GLYPHS[shownIcon(kind, icon)];
  return <Glyph {...props} />;
}
