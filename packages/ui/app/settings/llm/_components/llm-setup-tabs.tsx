"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Providers", href: "/settings/llm" },
  { label: "Local models", href: "/settings/llm/local" },
  { label: "Embedding", href: "/settings/llm/embedding" },
] as const;

export default function LlmSetupTabs() {
  const pathname = usePathname();
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.25rem",
        flexWrap: "wrap",
      }}
    >
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/settings/llm"
            ? pathname === "/settings/llm"
            : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab ${isActive ? "tab-active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
