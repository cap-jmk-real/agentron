"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ChatModal from "../components/chat-modal";
import ChatSettingsPanel from "../components/chat-settings-panel";
import ChatAssistantTracesView from "../components/chat-assistant-traces-view";
import { Settings2, MessageCircle, GitBranch } from "lucide-react";

type TabId = "chat" | "traces";

export default function ChatPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [showSettings, setShowSettings] = useState(false);
  /** When opening Stack traces from a chat error, select this conversation. */
  const [tracesConversationId, setTracesConversationId] = useState<string | null>(null);

  useEffect(() => {
    const tab = searchParams.get("tab");
    const convId = searchParams.get("conversationId");
    if (tab === "traces") {
      setActiveTab("traces");
      if (convId) setTracesConversationId(convId);
    }
  }, [searchParams]);

  const handleRefreshed = useCallback(() => {
    // Settings changed — chat will use new settings on next message; no need to reload
  }, []);

  return (
    <div className="chat-page">
      <div className="chat-page-tabs">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={activeTab === "chat" ? "chat-page-tab active" : "chat-page-tab"}
        >
          <MessageCircle size={16} />
          Chat
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("traces")}
          className={activeTab === "traces" ? "chat-page-tab active" : "chat-page-tab"}
        >
          <GitBranch size={16} />
          Stack traces
        </button>
      </div>
      <div className="chat-page-main">
        {activeTab === "chat" && (
          <ChatModal
            open={true}
            onClose={() => {}}
            embedded
            onOpenStackTraces={(conversationId) => {
              setActiveTab("traces");
              setTracesConversationId(conversationId ?? null);
            }}
          />
        )}
        {activeTab === "traces" && (
          <ChatAssistantTracesView
            initialConversationId={tracesConversationId}
            clearInitialConversationId={() => setTracesConversationId(null)}
          />
        )}
      </div>
      <button
        type="button"
        className="chat-page-settings-btn"
        onClick={() => setShowSettings((s) => !s)}
        title="Assistant settings"
      >
        <Settings2 size={18} />
      </button>
      <div className={`chat-page-settings-wrap ${showSettings ? "open" : ""}`}>
        <ChatSettingsPanel
          open={showSettings}
          onClose={() => setShowSettings(false)}
          onRefreshed={handleRefreshed}
        />
      </div>
    </div>
  );
}
