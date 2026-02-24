import "./globals.css";
import type { ReactNode } from "react";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import Sidebar from "./components/sidebar";
import Topbar from "./components/topbar";
import ChatWrapper from "./components/chat-wrapper";
import ActionRequiredBanner from "./components/action-required-banner";
import UpdateNotification from "./components/update-notification";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata = {
  title: "Agentron Studio",
  description: "Local-first agent design studio.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
    >
      <body className={spaceGrotesk.className}>
        <div className="app-shell">
          <Sidebar />
          <div className="content">
            <Topbar />
            <ActionRequiredBanner />
            {children}
          </div>
        </div>
        <ChatWrapper />
        <UpdateNotification />
      </body>
    </html>
  );
}
