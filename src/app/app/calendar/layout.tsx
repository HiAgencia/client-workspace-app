import type { Metadata } from "next";

// The page runs in the browser, so its title is declared here.
export const metadata: Metadata = { title: "Calendar" };

export default function CalendarLayout({ children }: LayoutProps<"/app/calendar">) {
  return children;
}
