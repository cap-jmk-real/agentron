import "./globals.css";
import type { ReactNode } from "react";
import Sidebar from "./components/sidebar";
import Topbar from "./components/topbar";
import ChatWrapper from "./components/chat-wrapper";

export const metadata = {
  title: "Agentron Studio",
  description: "Local-first agent design studio."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="content">
            <Topbar />
            {children}
          </div>
        </div>
        <ChatWrapper />
      </body>
    </html>
  );
}
