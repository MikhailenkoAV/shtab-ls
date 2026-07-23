import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Штаб ЛС - рабочий контур",
  description: "Локальный рабочий инструмент начальника штаба лётной службы.",
  manifest: "manifest.webmanifest",
  icons: {
    icon: [
      { url: "favicon.ico", type: "image/x-icon" },
      { url: "favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "favicon.ico",
    apple: [{ url: "apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { themeColor: "#102c40", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
