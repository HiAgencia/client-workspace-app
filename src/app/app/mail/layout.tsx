import type { Metadata } from "next";

// The page runs in the browser, so its title is declared here.
export const metadata: Metadata = { title: "Mail" };

export default function MailLayout({ children }: LayoutProps<"/app/mail">) {
  return children;
}
