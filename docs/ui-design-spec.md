# Agentron Studio — UI Design Spec

This doc is the single source of truth for UI styling. When adding or changing CSS (e.g. in `packages/ui/app/globals.css`), use these tokens and scales so the app stays consistent.

---

## 1. Design tokens (CSS variables)

All colors and key surfaces must use these variables. Do not introduce new hex/rgba values for background, text, or primary actions.

### Light (`:root`)

| Token | Value | Use |
|-------|--------|-----|
| `--bg` | `#f5f6fa` | Page background |
| `--surface` | `#ffffff` | Cards, panels, topbar |
| `--surface-muted` | `#f1f5f9` | Inputs, list items, muted blocks |
| `--text` | `#0f172a` | Primary text |
| `--text-muted` | `#64748b` | Secondary text, labels |
| `--primary` | `#5b7cfa` | Primary actions, links, active state |
| `--primary-strong` | `#4f46e5` | Gradient end, emphasis |
| `--border` | `rgba(148, 163, 184, 0.25)` | Borders, dividers |
| `--shadow` | `0 24px 60px rgba(15, 23, 42, 0.08)` | Cards, panels |
| `--sidebar-bg` | `#ffffff` | Sidebar background |
| `--sidebar-text` | `#0f172a` | Sidebar text |
| `--sidebar-text-muted` | `#64748b` | Sidebar secondary |
| `--sidebar-hover` | `rgba(15, 23, 42, 0.06)` | Nav hover |
| `--sidebar-active` | `rgba(91, 124, 250, 0.12)` | Nav active bg |
| `--sidebar-active-border` | `rgba(91, 124, 250, 0.3)` | Nav active border |

### Dark (`html[data-theme="dark"]`)

Same token names; values are defined in `globals.css` (darker backgrounds, lighter text, adjusted shadows). Always use the variable names, never hardcode light/dark values in component CSS.

### Optional (add to globals if needed)

- `--resource-green` — e.g. `#22c55e` for low usage
- `--resource-yellow` — e.g. `#eab308` for medium
- `--resource-red` — e.g. `#ef4444` for high

---

## 2. Spacing and sizing scale

Use this scale for padding, gap, margin, and border-radius so the UI feels consistent.

| Name | Value | Typical use |
|------|--------|-------------|
| xs | 0.25rem (4px) | Tight gaps, icon padding |
| sm | 0.4rem–0.5rem (6–8px) | Button padding, small gaps |
| md | 0.65rem–0.75rem (10–12px) | Input padding, list item padding |
| base | 1rem (16px) | Section gaps, default padding |
| lg | 1.5rem (24px) | Content padding, topbar |
| xl | 2rem (32px) | Page padding, sidebar padding |
| 2xl | 2.5rem (40px) | Main content padding |

### Border radius

- **Small**: 6px, 8px — pills, small buttons, badges
- **Medium**: 10px, 12px — inputs, nav links, cards
- **Large**: 16px, 18px, 24px — topbar, main content, modals

### Typography

- **Font stack**: `"Inter", "SF Pro Text", "Segoe UI", system-ui, sans-serif`
- **Monospace**: `"JetBrains Mono", "SF Mono", "Fira Code", monospace` (for code/textarea)
- **Sizes**: 0.7rem (labels), 0.8–0.85rem (meta), 0.9–1rem (body), 1.15rem (titles)

---

## 3. Layout constants

- **Sidebar width**: 260px
- **App shell**: `grid-template-columns: 260px 1fr`
- **Content area**: padding `2rem 2.5rem 2.5rem` (or use `xl`/`2xl` from scale)

---

## 4. Component class names that must have CSS

All of these are used in `packages/ui/app/components/`. If a class is used in JSX, it must have a rule in `globals.css` (or another stylesheet imported by the root layout). Otherwise the element will render with browser defaults only.

### Shell and nav (already in globals.css)

- `.app-shell`, `.content`, `.sidebar`, `.brand`, `.brand-mark`, `.brand-title`, `.brand-subtitle`
- `.nav`, `.nav-link`, `.nav-icon`, `.nav-section`, `.nav-section-header`, `.nav-group`
- `.sidebar-footer`, `.status-pill`, `.status-dot`
- `.topbar`, `.topbar-title`, `.topbar-actions`, `.search`, `.icon-button`, `.profile`, `.profile-avatar`
- `main`, `.card`, `.form`, `.field`, `.input`, `.select`, `.textarea`, `.button`, `.list`, `.list-item`
- Tabs, steps, tools, toggles, etc. (see globals.css)

### Resource monitor (must be in globals.css)

Used in `resource-usage.tsx` and `resource-bar.tsx`:

- `.resource-usage-grid` — container for CPU/RAM/GPU/disk blocks (e.g. display: grid or flex, gap)
- `.resource-usage-block` — single metric block
- `.resource-usage-row` — row with icon + value + label
- `.resource-usage-icon` — icon size/color
- `.resource-usage-value` — number (e.g. bold, monospace)
- `.resource-usage-label` — label (e.g. muted, small)
- `.resource-usage-meta` — loading/error state text

### Chat (must be in globals.css)

Used in `chat-wrapper.tsx` and `chat-modal.tsx`:

- **FAB**: `.chat-fab`, `.chat-fab-active` — floating action button (fixed bottom-right, size ~48px, primary gradient)
- **Overlay**: `.chat-backdrop` — full-screen dim (e.g. fixed, inset 0, background rgba, z-index)
- **Panel**: `.chat-panel`, `.chat-panel-open`, `.chat-panel-embedded` — main chat container (fixed or absolute, flex column, max-width/height, background var(--surface), border-radius, shadow)
- **Conversations sidebar**: `.chat-conversations-sidebar`, `.chat-conversations-sidebar-embedded`, `.chat-conversations-header`, `.chat-new-chat-btn`, `.chat-conversations-list`, `.chat-conversation-li`, `.chat-conversation-item`, `.chat-conversation-item.active`, `.chat-conversation-item-title`, `.chat-conversation-delete`
- **Main chat**: `.chat-main`, `.chat-header`, `.chat-header-btn`, `.chat-header-title`, `.chat-header-dot`, `.chat-provider-select`, `.chat-attached-banner`, `.chat-messages`, `.chat-empty`, `.chat-empty-icon`, `.chat-empty-title`, `.chat-empty-sub`
- **Messages**: `.chat-msg`, `.chat-msg-user`, `.chat-msg-assistant`, `.chat-rephrased-prompt`, `.chat-plan`, `.chat-plan-reasoning`, `.chat-plan-label`, `.chat-plan-reasoning-text`, `.chat-plan-todos`, `.chat-plan-todo-list`, `.chat-plan-todo-item`, `.chat-plan-todo-done`, `.chat-plan-todo-executing`, `.chat-plan-todo-icon`, `.chat-plan-todo-spinner`, `.chat-msg-error-placeholder`, `.chat-view-traces-btn`, `.chat-view-traces-link`, `.chat-msg-actions`, `.chat-rate-btn`, `.chat-typing`
- **Input**: `.chat-input-bar`, `.chat-input`, `.chat-stop-btn`, `.chat-send-btn`
- **Other**: `.chat-feedback-trigger`, `.spin` (for loader animation)

When adding these, use the tokens above (e.g. `var(--surface)`, `var(--border)`, `var(--primary)`) and the spacing/radius scale.

---

## 5. Why it might have looked correct on Mac

Possible reasons the same repo looked correct on your Mac dev machine:

1. **Different branch or uncommitted changes** — Your Mac might have had a branch or local changes where the chat/resource-usage styles were added to `globals.css` (or a separate CSS file) and never committed or merged into the branch you use on Windows/worktree.
2. **Different clone or older state** — The Mac clone might have been updated from a commit that included those styles; the Windows copy or worktree might be from before that commit or from a branch that never had them.
3. **Extra stylesheet only on Mac** — A file like `chat.css` or `resource-usage.css` might have been created and imported only in your Mac environment (e.g. in layout or a component) and was never committed or was in `.gitignore`.
4. **Browser cache** — Unlikely to make fully unstyled content look fully designed, but an old cache could theoretically serve an old bundled CSS that had more rules.

**What to do:** On your Mac, run `git status` and `git diff` in the agentron repo and check whether `packages/ui/app/globals.css` (or any `*.css` in `packages/ui`) has more content than in this worktree. If yes, that’s the missing piece — merge or copy those styles and keep them in sync with this spec.
