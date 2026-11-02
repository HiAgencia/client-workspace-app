import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import { BROWSER_BAR, THEME_KEY } from "@/lib/theme";
import "./globals.css";




const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", axes: ["opsz"] });




export const metadata: Metadata = {
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




const BEFORE_PAINT = `(function(){var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},b=${JSON.stringify(
  BROWSER_BAR,
)},m=matchMedia("(prefers-color-scheme: dark)");function s(){try{var v=localStorage.getItem(k);return v==="dark"||v==="light"?v:null}catch(e){return null}}function a(t){d.dataset.theme=t;var e=document.querySelector('meta[name="theme-color"]');if(!e){e=document.createElement("meta");e.name="theme-color";document.head.appendChild(e)}e.content=b[t]}function w(){return s()||(m.matches?"dark":"light")}a(w());m.addEventListener("change",function(){if(!s())a(w())});addEventListener("storage",function(e){if(e.key===k)a(w())});var v=function(){d.classList.toggle("page-hidden",document.hidden)};v();document.addEventListener("visibilitychange",v);})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
