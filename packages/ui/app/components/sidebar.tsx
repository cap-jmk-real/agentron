"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ResourceUsage } from "./resource-usage";
import BrandIcon from "./brand-icon";
import { NOTIFICATIONS_UPDATED_EVENT } from "../lib/notifications-events";

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

/* Compact inline SVG icons — 14×14 */
const icons = {
  stats: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  localModels: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  overview: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  agents: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="9" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 15.5c0 0 1.5 1.5 3 1.5s3-1.5 3-1.5" />
      <line x1="9" y1="2" x2="9" y2="4" />
      <line x1="15" y1="2" x2="15" y2="4" />
    </svg>
  ),
  workflows: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="6" height="5" rx="1" />
      <rect x="16" y="3" width="6" height="5" rx="1" />
      <rect x="9" y="16" width="6" height="5" rx="1" />
      <path d="M5 8v2a3 3 0 003 3h8a3 3 0 003-3V8" />
      <path d="M12 13v3" />
    </svg>
  ),
  runs: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="5,3 19,12 5,21" />
    </svg>
  ),
  settings: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001.08 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1.08z" />
    </svg>
  ),
  llm: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  ),
  queue: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="4" rx="1" />
      <rect x="2" y="10" width="20" height="4" rx="1" />
      <rect x="2" y="15" width="20" height="4" rx="1" />
    </svg>
  ),
  tools: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  chat: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  knowledge: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  ),
  telegram: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  ),
  container: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  ),
  vault: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  ),
  embedding: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
    </svg>
  ),
  github: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
  docs: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  ),
  heap: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
};

const sections: NavSection[] = [
  {
    title: "Studio",
    items: [
      { label: "Overview", href: "/", icon: icons.overview },
      { label: "Agentron", href: "/chat", icon: icons.chat },
      { label: "Agents", href: "/agents", icon: icons.agents },
      { label: "Tools", href: "/tools", icon: icons.tools },
      { label: "Workflows", href: "/workflows", icon: icons.workflows },
      { label: "Knowledge", href: "/knowledge", icon: icons.knowledge },
      { label: "Statistics", href: "/stats", icon: icons.stats },
      { label: "Runs", href: "/runs", icon: icons.runs },
      { label: "Queues", href: "/queues", icon: icons.queue },
      { label: "Heap", href: "/heap", icon: icons.heap },
      { label: "Sandboxes", href: "/sandboxes", icon: icons.container },
      { label: "Request queue", href: "/requests", icon: icons.queue },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Vault", href: "/settings/vault", icon: icons.vault },
      { label: "LLM Providers", href: "/settings/llm", icon: icons.llm },
      { label: "Embedding", href: "/settings/embedding", icon: icons.embedding },
      { label: "Local Models", href: "/settings/local", icon: icons.localModels },
      { label: "Telegram", href: "/settings/telegram", icon: icons.telegram },
      { label: "GitHub", href: "/settings/github", icon: icons.github },
      { label: "Container Engine", href: "/settings/container", icon: icons.container },
      { label: "General", href: "/settings", icon: icons.settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState(() => new Set(sections.map((s) => s.title)));
  const [pendingCount, setPendingCount] = useState(0);
  const [runsNeedingInput, setRunsNeedingInput] = useState(0);
  const [chatNeedingInput, setChatNeedingInput] = useState(0);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  useEffect(() => {
    const fetchVaultStatus = async () => {
      try {
        const res = await fetch("/api/vault/status", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setVaultExists(data.vaultExists === true);
        }
      } catch {
        setVaultExists(null);
      }
    };
    fetchVaultStatus();
    const interval = setInterval(fetchVaultStatus, 10000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/rate-limit/queue");
        if (res.ok) {
          const data = await res.json();
          setPendingCount(Array.isArray(data.pending) ? data.pending.length : 0);
        }
      } catch {
        // ignore
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const [runRes, chatRes] = await Promise.all([
          fetch("/api/notifications?status=active&limit=0&types=run"),
          fetch("/api/notifications?status=active&limit=0&types=chat"),
        ]);
        if (runRes.ok) {
          const data = await runRes.json();
          setRunsNeedingInput(
            typeof data.totalActiveCount === "number" ? data.totalActiveCount : 0
          );
        }
        if (chatRes.ok) {
          const data = await chatRes.json();
          setChatNeedingInput(
            typeof data.totalActiveCount === "number" ? data.totalActiveCount : 0
          );
        }
      } catch {
        // ignore
      }
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    const onUpdated = () => {
      void fetchNotifications();
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const toggleSection = (title: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <BrandIcon size={32} className="brand-logo" />
        </div>
        <div>
          <div className="brand-title">Agentron</div>
          <div className="brand-subtitle">Studio</div>
        </div>
      </div>
      <div className="sidebar-nav-scroll">
        <nav className="nav">
          {sections.map((section) => {
            const isOpen = openSections.has(section.title);
            return (
              <div key={section.title} className="nav-section">
                <button
                  type="button"
                  className="nav-section-header"
                  onClick={() => toggleSection(section.title)}
                >
                  <span>{section.title}</span>
                  <span className={`chevron ${isOpen ? "open" : ""}`}>&#x25BE;</span>
                </button>
                {isOpen && (
                  <div className="nav-items">
                    {section.items.map((item) => {
                      const isActive =
                        item.href === "/"
                          ? pathname === "/"
                          : item.href === "/settings"
                            ? pathname === "/settings"
                            : pathname?.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          className={`nav-link ${isActive ? "active" : ""}`}
                          href={item.href}
                          title={item.label}
                        >
                          <span className="nav-icon">{item.icon}</span>
                          <span className="nav-label">{item.label}</span>
                          {item.href === "/chat" && runsNeedingInput + chatNeedingInput > 0 && (
                            <span
                              className="nav-badge nav-badge-help"
                              title={
                                runsNeedingInput + chatNeedingInput === 1
                                  ? "Needs your input – open Chat to respond"
                                  : `${runsNeedingInput + chatNeedingInput} requests need your input – open Chat`
                              }
                            >
                              {runsNeedingInput + chatNeedingInput}
                            </span>
                          )}
                          {item.href === "/runs" && runsNeedingInput > 0 && (
                            <span
                              className="nav-badge nav-badge-help"
                              title={
                                runsNeedingInput === 1
                                  ? "1 run waiting for your input"
                                  : `${runsNeedingInput} runs waiting for your input`
                              }
                            >
                              {runsNeedingInput}
                            </span>
                          )}
                          {item.href === "/requests" && pendingCount > 0 && (
                            <span
                              className="nav-badge"
                              title={`${pendingCount} request(s) waiting`}
                            >
                              {pendingCount}
                            </span>
                          )}
                          {item.href === "/settings/vault" && vaultExists === false && (
                            <span
                              className="nav-badge nav-badge-help"
                              title="Vault not set up – create a master password"
                            >
                              !
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
      <div className="sidebar-footer">
        <div
          className="sidebar-external-links"
          style={{ display: "flex", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}
        >
          <a
            href="https://github.com/cap-jmk-real/agentron"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}
            title="GitHub repository"
          >
            <span className="nav-icon">{icons.github}</span>
            <span className="nav-label">GitHub</span>
          </a>
          <a
            href="https://cap-jmk-real.github.io/agentron/"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}
            title="Documentation"
          >
            <span className="nav-icon">{icons.docs}</span>
            <span className="nav-label">Docs</span>
          </a>
        </div>
        <div className="sidebar-resource-monitor">
          <ResourceUsage />
        </div>
        <div className="status-pill" style={{ marginTop: "0.5rem" }}>
          <span className="status-dot" />
          Local Runtime
        </div>
      </div>
    </aside>
  );
}
