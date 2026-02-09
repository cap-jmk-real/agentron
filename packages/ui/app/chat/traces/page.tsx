"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ChatAssistantTracesView from "../../components/chat-assistant-traces-view";

export default function ChatTracesPage() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversationId");

  return (
    <div className="content-fill" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: "0.5rem 0", marginBottom: "0.25rem" }}>
        <Link
          href="/chat"
          style={{ fontSize: "0.82rem", color: "var(--text-muted)", textDecoration: "none" }}
        >
          ← Back to Chat
        </Link>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ChatAssistantTracesView
          initialConversationId={conversationId ?? undefined}
          clearInitialConversationId={() => {}}
        />
      </div>
    </div>
  );
}
