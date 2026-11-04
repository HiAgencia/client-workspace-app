import type { Metadata } from "next";
import { SCREEN_TITLES } from "../screen-titles";

export const metadata: Metadata = { title: SCREEN_TITLES["/app/trash"] };

export default function TrashLayout({ children }: LayoutProps<"/app/trash">) {
  return children;
}
