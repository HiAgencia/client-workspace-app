import type { Metadata } from "next";
import { SCREEN_TITLES } from "../screen-titles";


export const metadata: Metadata = { title: SCREEN_TITLES["/app/settings"] };

export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return children;
}
