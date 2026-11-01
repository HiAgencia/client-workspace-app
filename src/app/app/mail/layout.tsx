import type { Metadata } from "next";
import { SCREEN_TITLES } from "../screen-titles";


export const metadata: Metadata = { title: SCREEN_TITLES["/app/mail"] };

export default function MailLayout({ children }: LayoutProps<"/app/mail">) {
  return children;
}
