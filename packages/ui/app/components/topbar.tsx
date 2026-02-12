"use client";

import { useEffect, useState } from "react";
import { Search, Sun, Moon, User } from "lucide-react";

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
        <button className="icon-button" onClick={toggleTheme} title="Toggle theme">
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <div className="profile">
          <div className="profile-avatar">
            <User size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}
