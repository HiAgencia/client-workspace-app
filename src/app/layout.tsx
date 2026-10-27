import type { Metadata, Viewport } from "next";
import { Wix_Madefor_Display, Wix_Madefor_Text } from "next/font/google";
import { BROWSER_BAR, THEME_KEY } from "@/lib/theme";
import "./globals.css";

// Two families of one design: the display face for titles, labels, controls, and proper names; the text face for what
// is read and the values a person types.
const display = Wix_Madefor_Display({ variable: "--font-madefor-display", subsets: ["latin"] });
const text = Wix_Madefor_Text({ variable: "--font-madefor-text", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "client-workspace",
  description: "Work organized by project: tasks, decisions, links, and calendars in one tree, with a chat and your coding agent on the same place.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BROWSER_BAR.light },
    { media: "(prefers-color-scheme: dark)", color: BROWSER_BAR.dark },
  ],
};

// The chosen theme is set before the first paint, so no frame shows the other one: the stored choice, or the system's.
// The tab's visibility is marked on the root too, so what loops in CSS pauses while nobody sees it.
const BEFORE_PAINT = `(function(){var d=document.documentElement;try{var s=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var t=s==="dark"||s==="light"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.dataset.theme=t;}catch(e){d.dataset.theme="light";}var v=function(){d.classList.toggle("page-hidden",document.hidden)};v();document.addEventListener("visibilitychange",v);})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
