import type { Metadata } from "next";
import { SCREEN_TITLES } from "../screen-titles";


export const metadata: Metadata = { title: SCREEN_TITLES["/app/calendar"] };

export default function CalendarLayout({ children }: LayoutProps<"/app/calendar">) {
  return children;
}
