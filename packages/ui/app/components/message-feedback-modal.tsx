"use client";

import { useState } from "react";
import { X, ThumbsUp, ThumbsDown } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  label: "good" | "bad";
  onSubmit: (notes: string) => void | Promise<void>;
  submitting?: boolean;
};

export default function MessageFeedbackModal({
  open,
  onClose,
  label,
  onSubmit,
  submitting = false,
}: Props) {
  const [notes, setNotes] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(notes.trim());
    setNotes("");
    onClose();
  };

  const handleClose = () => {
    setNotes("");
    onClose();
  };

  return (
    <>
      <div
        className="chat-feedback-backdrop"
        role="presentation"
        onClick={handleClose}
      />
      <div
        className="chat-feedback-drawer"
        role="dialog"
        aria-label="Describe your feedback"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat-feedback-drawer-header">
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {label === "good" ? <ThumbsUp size={18} /> : <ThumbsDown size={18} />}
            {label === "good" ? "Good response" : "Bad response"}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="chat-header-btn"
            style={{ padding: "0.35rem" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <form className="chat-feedback-drawer-body message-feedback-form" onSubmit={handleSubmit}>
          <label htmlFor="message-feedback-notes" className="message-feedback-label">
            Describe your feedback (optional)
          </label>
          <textarea
            id="message-feedback-notes"
            className="message-feedback-textarea"
            placeholder={label === "bad" ? "e.g. The agent made a bad decision because…" : "e.g. This was helpful because…"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            disabled={submitting}
          />
          <div className="message-feedback-actions">
            <button
              type="button"
              className="message-feedback-btn message-feedback-btn-secondary"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="message-feedback-btn message-feedback-btn-primary"
              disabled={submitting}
            >
              {submitting ? "Sending…" : "Send feedback"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
