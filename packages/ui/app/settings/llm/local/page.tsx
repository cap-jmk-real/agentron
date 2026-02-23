"use client";

import LlmSetupTabs from "../_components/llm-setup-tabs";
import { LocalModelsContent } from "../../local/page";

export default function LlmLocalPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <LlmSetupTabs />
      <LocalModelsContent />
    </div>
  );
}
