"use client";

import { useEffect, useState } from "react";
import { Search, Sun, Moon, MessageCircle } from "lucide-react";
import { openChat } from "./chat-wrapper";
import NotificationsButton from "./notifications-button";

export default function Topbar() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const stored = window.localStorage.getItem("agentron-theme") ?? "light";
    queueMicrotask(() => {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    });
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("agentron-theme", next);
  };

  return (
    <div className="topbar">
      <div className="topbar-title">Workspace</div>
      <div className="topbar-actions">
        <div className="search">
          <Search size={14} />
          <input placeholder="Search..." />
        </div>
        <NotificationsButton />
        <button
          type="button"
          className="icon-button"
          onClick={() => openChat()}
          title="Open chat"
          aria-label="Open chat"
        >
          <MessageCircle size={14} />
        </button>
        <button className="icon-button" onClick={toggleTheme} title="Toggle theme">
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
    </div>
  );
}
