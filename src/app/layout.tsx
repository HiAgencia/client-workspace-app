import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import { SITE_ORIGIN } from "@/lib/seo";
import { SmoothScroll } from "@/components/smooth-scroll";
import { serverEnv } from "@/lib/env";
import { Analytics } from "./analytics";
import { LANGUAGE_KEY } from "@/lib/language";
import { BROWSER_BAR, THEME_KEY } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

const BEFORE_PAINT = `(function(){var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},lk=${JSON.stringify(LANGUAGE_KEY)},b=${JSON.stringify(
  BROWSER_BAR,
)},m=matchMedia("(prefers-color-scheme: dark)");function s(){try{var v=localStorage.getItem(k);return v==="dark"||v==="light"?v:null}catch(e){return null}}function a(t){d.dataset.theme=t;var e=document.querySelector('meta[name="theme-color"]');if(!e){e=document.createElement("meta");e.name="theme-color";document.head.appendChild(e)}e.content=b[t]}function w(){return s()||(m.matches?"dark":"light")}a(w());m.addEventListener("change",function(){if(!s())a(w())});addEventListener("storage",function(e){if(e.key===k)a(w())});function g(){try{var v=localStorage.getItem(lk);return v==="es"||v==="en"?v:null}catch(e){return null}}function h(){if(d.dataset.lang)return;var v=g();if(v){d.lang=v;d.dataset.lang=v}}h();addEventListener("storage",function(e){if(e.key===lk)h()});var v=function(){d.classList.toggle("page-hidden",document.hidden)};v();document.addEventListener("visibilitychange",v);})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const gaId = serverEnv("GA_MEASUREMENT_ID");
  const marked = (await headers()).get("x-brief-lang");
  const lang = marked === "es" ? "es" : "en";
  return (
    <html lang={lang} data-lang={marked === null ? undefined : lang} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </head>
      <body>
        {children}
        <SmoothScroll />
        {gaId && <Analytics id={gaId} />}
      </body>
    </html>
  );
}
