"use client";

import { X, Star } from "lucide-react";

type ConversationItem = { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number };

type Props = {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  currentConversation: ConversationItem | null;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  savingNote: boolean;
  saveConversationRating: (rating: number | null) => void;
  saveConversationNote: () => void;
};

export default function ChatFeedbackModal({
  open,
  onClose,
  conversationId,
  currentConversation,
  noteDraft,
  setNoteDraft,
  savingNote,
  saveConversationRating,
  saveConversationNote,
}: Props) {
  if (!open) return null;

  const hasConversation = !!conversationId && !!currentConversation;
  const rating = currentConversation?.rating ?? null;

  return (
    <>
      <div
        className="chat-feedback-backdrop"
        role="presentation"
        onClick={onClose}
      />
      <div
        className="chat-feedback-drawer"
        role="dialog"
        aria-label="Conversation feedback"
      >
        <div className="chat-feedback-drawer-header">
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Feedback</h3>
          <button
            type="button"
            onClick={onClose}
            className="chat-header-btn"
            style={{ padding: "0.35rem" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="chat-feedback-drawer-body">
          {!hasConversation ? (
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Start or select a conversation to rate it and add a note.</p>
          ) : (
            <>
              <div className="chat-rate-row" style={{ marginBottom: "1rem" }}>
                <span className="chat-rate-label" style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>Rating</span>
                <div className="chat-rate-stars" style={{ display: "flex", gap: "0.25rem" }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chat-star-btn ${(rating ?? 0) >= n ? "filled" : ""}`}
                      onClick={() => saveConversationRating((rating ?? 0) === n ? null : n)}
                      title={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      <Star size={18} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="chat-note-row">
                <label className="chat-note-label" style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>Note</label>
                <textarea
                  className="chat-note-input"
                  placeholder="Optional feedback..."
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={3}
                  style={{ width: "100%", fontSize: "0.9rem", resize: "vertical", minHeight: 80 }}
                />
                <button
                  type="button"
                  className="chat-note-save"
                  onClick={saveConversationNote}
                  disabled={savingNote}
                  style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
                >
                  {savingNote ? "Saving…" : "Save note"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
