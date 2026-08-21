import type { Metadata, Viewport } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { site } from "@/lib/content";
import "./globals.css";

const instrument = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const jbmono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: site.title,
  description: site.description,
  metadataBase: new URL("https://zjy365.github.io/aster"),
  openGraph: {
    title: site.title,
    description: site.description,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#131315" },
  ],
};

/*
 * Restores the stored theme before first paint so the page never flashes.
 * "system" (the default) sets no class at all — the prefers-color-scheme
 * media query in globals.css owns that case, so it also tracks live system
 * changes. Kept in sync with components/theme-switcher.tsx.
 */
const themeScript = `try{var t=localStorage.getItem("aster-theme");if(t==="light")document.documentElement.classList.add("light");else if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* The pre-paint theme script may add `light`/`dark` to <html> before
     * hydration, which SSR can't know about — React sees that as a mismatch. */
    <html lang="en" className={`${instrument.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
