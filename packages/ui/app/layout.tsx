import "./globals.css";
import type { ReactNode } from "react";
import Sidebar from "./components/sidebar";
import Topbar from "./components/topbar";
import ChatWrapper from "./components/chat-wrapper";
import ActionRequiredBanner from "./components/action-required-banner";
import UpdateNotification from "./components/update-notification";

export const metadata = {
  title: "Agentron Studio",
  description: "Local-first agent design studio.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
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
