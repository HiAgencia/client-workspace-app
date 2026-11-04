import type { Metadata } from "next";
import { SCREEN_TITLES } from "../screen-titles";

export const metadata: Metadata = { title: SCREEN_TITLES["/app/profile"] };

export default function ProfileLayout({ children }: LayoutProps<"/app/profile">) {
  return children;
}
