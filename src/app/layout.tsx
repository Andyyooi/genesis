import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SnapshotBanner } from "@/components/research/snapshot-banner";
import { AuthNav } from "@/components/auth-nav";
import { InstallApp } from "@/components/install-app";
import "./globals.css";
import "./night.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Genesis Research | Bursa Malaysia",
  description: "Clear, evidence-led research for Bursa Malaysia equities.",
  applicationName: "Genesis Research",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Genesis" },
  icons: { icon: "/app-icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#10121a", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <AuthNav />
        <SnapshotBanner />
        <a href="#main-content" className="skip-link">Skip to content</a>
        <div id="main-content" className="flex flex-1 flex-col">{children}</div>
        <footer className="mx-auto flex w-full max-w-[88rem] flex-wrap justify-between gap-3 px-6 py-6 text-xs text-muted-foreground"><span>Genesis Research · Bursa Malaysia</span><span>Research, not buy or sell advice. Prices are not live.</span><InstallApp /></footer>
      </body>
    </html>
  );
}
