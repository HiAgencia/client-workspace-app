import type { Metadata } from "next";

// The page runs in the browser, so its title is declared here.
export const metadata: Metadata = { title: "Settings" };

export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return children;
}
