"use client";

import LlmSetupTabs from "../_components/llm-setup-tabs";
import { EmbeddingContent } from "../../embedding/page";

export default function LlmEmbeddingPage() {
  return (
    <div style={{ maxWidth: 680 }}>
      <LlmSetupTabs />
      <EmbeddingContent />
    </div>
  );
}
