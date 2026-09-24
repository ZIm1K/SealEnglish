import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — онлайн-школа англійської мови для підлітків і дітей`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "школа англійської", "школа англійської мови", "онлайн школа англійської", "курси англійської онлайн",
    "англійська для підлітків", "англійська для дітей", "уроки англійської", "підготовка до НМТ з англійської",
    "Seal English", "Сіл Інгліш", "Сіал Інгліш", "online English school", "English lessons for teens",
  ],
  openGraph: {
    type: "website",
    locale: "uk_UA",
    alternateLocale: ["en_US"],
    siteName: SITE.name,
    title: `${SITE.name} — англійська, яку хочеться вчити`,
    description: SITE.description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: { card: "summary_large_image" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a2142",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
