"use client";

import { useState, useCallback } from "react";
import ChatSection from "../components/chat-section";
import ChatSettingsPanel from "../components/chat-settings-panel";

export default function ChatPage() {
  const [showSettings, setShowSettings] = useState(false);

  const handleRefreshed = useCallback(() => {
    // Settings changed — chat will use new settings on next message; no need to reload
  }, []);

  return (
    <>
      <ChatSection onOpenSettings={() => setShowSettings(true)} />
      {showSettings && (
        <div className="chat-page-settings-modal">
          <div
            className="chat-page-settings-backdrop"
            role="presentation"
            onClick={() => setShowSettings(false)}
          />
          <div className="chat-page-settings-dialog" role="dialog" aria-label="Assistant settings">
            <ChatSettingsPanel
              open={showSettings}
              onClose={() => setShowSettings(false)}
              onRefreshed={handleRefreshed}
            />
          </div>
        </div>
      )}
    </>
  );
}
