import type { MetaRecord } from "nextra";

/** Sidebar: grouped with separators. Order: get started → learn (tutorials) → how it works (concepts) → design → guides → reference. */
const meta: MetaRecord = {
  index: "Introduction",
  "sep-get-started": { type: "separator", title: "Get started" },
  "quick-start": "Quick start",
  download: "Download",
  "sep-learn": { type: "separator", title: "Learn" },
  tutorials: "Tutorials",
  "sep-how": { type: "separator", title: "How it works" },
  concepts: "Concepts",
  capabilities: "Capabilities",
  "sep-design": { type: "separator", title: "Design" },
  "brand-story": "Brand story",
  design: "Design",
  "sep-guides": { type: "separator", title: "Guides" },
  "assisted-coding": "Assisted coding & GitHub",
  "ai-guide": "AI Guide",
  "sep-reference": { type: "separator", title: "Reference" },
  "podman-install": "Container engine",
  "embedding-models": "Embedding models (dimensions)",
  "e2e-local-llm": "E2E tests (local LLM)",
  reminders: "Reminders",
};

export default meta;
