import type { Metadata } from "next";


export const metadata: Metadata = { title: "Calendar" };

export default function CalendarLayout({ children }: LayoutProps<"/app/calendar">) {
  return children;
}
