import type { Metadata, Viewport } from "next";
import { Wix_Madefor_Display, Wix_Madefor_Text } from "next/font/google";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import { BROWSER_BAR, THEME_KEY } from "@/lib/theme";
import "./globals.css";

// Two families of one design: the display face for titles, labels, controls, and proper names; the text face for what
// is read and the values a person types.
const display = Wix_Madefor_Display({ variable: "--font-madefor-display", subsets: ["latin"] });
const text = Wix_Madefor_Text({ variable: "--font-madefor-text", subsets: ["latin"] });

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
};

// The browser bar's color is not declared here: it follows the chosen theme, which only the script below knows.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

// The chosen theme is set before the first paint, so no frame shows the other one: the stored choice, or the system's.
// Without a choice it keeps following the system; a choice made in another tab reaches this one. The browser bar takes
// the same theme. The tab's visibility is marked on the root too, so what loops in CSS pauses while nobody sees it.
const BEFORE_PAINT = `(function(){var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},b=${JSON.stringify(
  BROWSER_BAR,
)},m=matchMedia("(prefers-color-scheme: dark)");function s(){try{var v=localStorage.getItem(k);return v==="dark"||v==="light"?v:null}catch(e){return null}}function a(t){d.dataset.theme=t;var e=document.querySelector('meta[name="theme-color"]');if(!e){e=document.createElement("meta");e.name="theme-color";document.head.appendChild(e)}e.content=b[t]}function w(){return s()||(m.matches?"dark":"light")}a(w());m.addEventListener("change",function(){if(!s())a(w())});addEventListener("storage",function(e){if(e.key===k)a(w())});var v=function(){d.classList.toggle("page-hidden",document.hidden)};v();document.addEventListener("visibilitychange",v);})();`;

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
