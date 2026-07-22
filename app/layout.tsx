import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Штаб ЛС — контроль полётных смен",
  description: "Локальный рабочий инструмент начальника штаба лётной службы.",
  manifest: "manifest.webmanifest",
  icons: { icon: "favicon.svg", shortcut: "favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#102c40", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
