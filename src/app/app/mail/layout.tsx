import type { Metadata } from "next";


export const metadata: Metadata = { title: "Mail" };

export default function MailLayout({ children }: LayoutProps<"/app/mail">) {
  return children;
}
