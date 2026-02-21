# Docs: Cleaner design, table improvements, and content audit

## Implementation order (card layout mandatory)

1. **CSS:** Table styling (lighter, optional compact class), feature-matrix **card layout on large screens** in [apps/docs/app/globals.css](apps/docs/app/globals.css).
2. **Capabilities:** Card layout for feature matrix — **mandatory**. On large viewports the capabilities feature matrix is shown as a grid of cards (CSS only, table remains in MDX; wrapper + media query).
3. **Audit cleanup:** Trim capabilities and index for redundancy; add "For contributors" note to e2e-local-llm.
4. **New content:** Add "How Chat decides what to do" (heap/planner/specialists) under assistant; add "Improving from a run" under workflows (and brief mention in assistant).
5. **Pass:** Apply compact table class to "User wants / Action" and similar tables in MDX where it improves readability.

## Card layout (mandatory)

- **Capabilities feature matrix:** On large screens (e.g. min-width: 1024px), the feature matrix table is displayed as a responsive grid of cards (one card per row). Implemented via a wrapper class `feature-matrix-cards` around the table and CSS that, in a media query, restyles tbody/tr/td into cards. Table stays in MDX; no new React component.
