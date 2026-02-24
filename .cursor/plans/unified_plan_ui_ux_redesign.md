# Unified plan — UI/UX redesign (for feedback)

This document redesigns the [unified heap + self-improvement plan](unified_heap_and_self_improvement.plan.md) around **good and easy UI/UX**, with two core rules: **(1) the user is not confused and has only the interactions that are strictly necessary; (2) token usage is kept minimal.** Same features; user-first presentation. **Please review and give feedback.**

---

## Core principle: Minimal interactions

**The user should only interact when it’s necessary.** Every prompt, button, and setting is a cost. So:

- **Don’t ask if we can infer or default.** Prefer: run finishes → if "allow auto-improve" is on and run failed, auto-retry (with cap); only ask "goal achieved?" when we truly need human judgment (e.g. at end of run, or when auto-retries exhausted).
- **Don’t show choices that can be one.** If the user says "not done", the minimal path is: one action "Retry" (improve + run again). Optional feedback is exactly that — optional, collapsed by default ("Add a note" only if they want to say something).
- **Don’t expose settings until they’re needed.** Heap vs standard: one control, hidden in chat settings (or a small mode indicator). Self-improvement: one toggle per agent/node ("Ask me before retrying" on/off); advanced (feedback interval, etc.) behind "More options".
- **Don’t add reading load.** "What we changed" after improvement: only on demand (e.g. "What changed?" link). Similar past feedback: used by the system, not shown to the user unless they expand something. One-line "what went wrong" summary: show when run failed/waiting so they don’t have to click to understand.

**Principles in short:**

1. **Interact only when necessary** — Default to the path that needs no input; ask only when we need human judgment.
2. **One place per task** — Controls live where the user expects them; no hunting.
3. **Fewer choices, not more** — Prefer two options (Done / Retry) over three; make the third (feedback) optional and collapsed.
4. **Progressive disclosure** — Sensible defaults; advanced options behind "More" or in a dedicated place (e.g. workflow node panel).
5. **State visible when relevant** — e.g. "Multi-agent" badge on run so they’re not confused; no need to show internals (heap, improvement plan) unless they ask.
6. **Token usage minimal** — Only send each LLM the minimum context it needs; cap and summarize run logs, feedback, and history (see §10).

---

## 1. Choosing how the assistant runs (heap vs single)

**Where:** Chat settings (or a small, non-intrusive mode indicator). **Not** in the main flow — user doesn’t need to choose this to get value.

**What the user sees:**
- **Default:** Standard (current behavior). No prompt, no choice.
- **Only when they open chat settings:** One control — "Assistant mode": **Standard** | **Multi-agent**. Short label only (e.g. "Multi-agent: router picks specialists"). No long help text unless they expand "What’s the difference?".

**Minimal interaction:** No interaction required. Change only when they want different behavior. Default = Standard so nobody is forced to decide.

---

## 2. Run page — when the run is waiting for you

**Where:** Run detail page (existing), when status = "Waiting for your input".

**What the user sees (minimal):**
- **Question** at the top: e.g. "Is the goal achieved?" (or the agent’s custom question). Readable, not truncated.
- **Goal checker hint** (if we have it): One line in muted text, e.g. "Checker: might need improvement." No extra click.
- **Two actions only:**
  - **Done** — Goal achieved; run completes. One click.
  - **Retry** — Improve from this run’s logs, then run again. One click. (We do not ask "do you want to improve?" — Retry means improve + run.)
- **Optional, collapsed by default:** Under "Retry", a line: **"Add a note (optional)"** that expands to a single text field. If they don’t expand it, we improve from logs only. If they add a note and click Retry, we pass that note as user feedback. So **no third button** and no separate "I’ll say what went wrong" flow — just one optional add-on.

**What we don’t show:** "Similar past feedback" to the user — used internally by the improver only. No extra reading unless they ask (e.g. "Why am I being asked?").

**Minimal interaction:** User only decides: Done or Retry. Feedback is optional and hidden until they choose to add it.

---

## 3. Giving feedback (optional note)

**Where:** Same run page — only as the **optional** "Add a note (optional)" under **Retry**, collapsed by default.

**What the user sees (only if they expand):**
- One text field, placeholder: e.g. "What went wrong? (optional)"
- No separate submit — they click **Retry** (same as without a note). If the field has content, we send it as user feedback to the improver and then retry.

**Minimal interaction:** No extra flow. If they don’t care to explain, they never see the field. One click (Retry) either way.

---

## 4. Retry (= improve and run again)

**Where:** Run page — the **Retry** button (when waiting). Optionally in Chat as a link to the run’s Retry action.

**What the user does:** Clicks **Retry**. No form, no confirmation. Backend: improvement runs (with runId and any optional note), then a new run of the same task starts.

**What the user sees after:** Status moves to "Running" (or a new run). One short line: "Improving… then retrying." **Do not** show "What we changed" by default — that’s extra reading. Only on demand: e.g. a link "What changed?" that expands a short summary after improvement. So minimal = one click, no follow-up unless they ask.

---

## 5. Configuring self-improvement (per agent / workflow)

**Where:** Workflow editor — only when the user selects an **agent node**. Not in the main run flow.

**What the user sees (minimal):**
- **One toggle:** "Ask me before retrying" — **On** (default): we always ask "goal achieved?" and only retry when they click Retry. **Off**: we may auto-improve and retry (e.g. up to 2 times) when something fails, without asking. So the only decision is: do I want to be asked every time, or can the system retry on its own?
- **Rest behind "More options":** Feedback interval (at end / every N steps / on failure only / every step) and any other policy live under an expandable "More options". Most users never open it; defaults (ask at end, ask before retrying) work.

**Optional:** Same toggle on the **Agent** editor so all workflows using that agent inherit it; workflow or node can override. Keep the UI to one toggle in the common case.

**Minimal interaction:** Default = no config. User only touches this if they want "don’t ask me, retry automatically." One toggle; no dropdowns unless they open "More options."

---

## 6. Seeing what went wrong (run logs)

**Where:** Run detail page. Shown **without** the user having to click — when status is failed or waiting.

**Minimal interaction:**
- **One line at top (always visible when failed/waiting):** e.g. "2 errors: [Playwright] navigate failed; [Run code] SyntaxError." Generated from run_logs so the user understands at a glance. No expand needed for the gist.
- **Details on demand:** Execution trail and Shell logs stay expandable/collapsed as today. "Copy for chat" = one button. We don’t force them to open logs to understand why we’re asking; the one-line summary does that.

---

## 7. Heap run visibility

**Where:** Run page and Chat. **Passive** — no interaction required.

**What the user sees:** Small badge or line: "Multi-agent" on the run (or in Execution trail step labels) and "Multi-agent" in Chat when that mode is on. So they’re not confused about how the run happened. No "Show heap" or internals unless they dig into advanced UI.

**Minimal interaction:** Information only. No click, no choice.

---

## 8. Summary: Minimal-interaction checklist

| Feature | Where | What user sees / does | Minimal because |
|--------|--------|------------------------|------------------|
| Heap vs standard | Chat settings only | One control; default Standard | No interaction unless they open settings |
| Goal achieved? | Run page (when waiting) | Question plus two actions: Done or Retry | One decision; feedback optional, collapsed |
| Optional note | Run page, under Retry | "Add a note (optional)" — expand to type | No extra flow; one Retry click |
| Retry | Run page | One button | One click; "What changed?" only on demand |
| Self-improvement | Workflow editor (agent node) | One toggle: "Ask me before retrying"; rest under "More options" | Default = no config; one toggle if needed |
| What went wrong | Run page | One-line summary when failed/waiting; details expandable | No click needed to understand |
| Run type | Run page, Chat | Badge "Multi-agent" | Passive; no interaction |
| Token usage | Backend: run/improvement/chat | get_run_for_improvement = summary + recent errors; feedback = short rows; heap context = summary | Bounded inputs; one-call improvement when possible (§10) |

---

## 9. Open questions for your feedback

1. **Self-improvement config:** Prefer only on **workflow node**, or also on **Agent** editor (inherit for all workflows using that agent), or both with workflow default + node override?
2. **"What went wrong?" one-liner:** Auto-generate from run_logs (e.g. "2 errors: [Playwright] …, [Run code] …") — any concern about accuracy or noise, or keep it as proposed?

(Decisions already made in this redesign: feedback = optional note under Retry, one step; improvement summary = on demand only; similar past feedback = internal only, not shown to user.)

---

## 10. Token usage: keep it minimal

**Principle:** Every LLM call costs tokens. Only send the minimum context each role needs; cap or summarize any input that can grow (run logs, feedback, history). This keeps cost and latency down and avoids hitting context limits.

### 10.1 Where tokens are spent

| Consumer | What it receives | Minimization |
|----------|------------------|--------------|
| **Router (heap)** | User message + list of specialist ids (≤10). | No tool defs, no run history, no full trail. Already minimal. |
| **Specialists (heap)** | Own prompt + own tools (≤10) + context from previous steps. | Context between steps = **structured summary only** (e.g. step id, outcome, 1–2 lines); no full JSON dumps. Cap total context from previous steps (e.g. last 2 steps or 500 tokens). |
| **Chat assistant** | History + tools + message. | History compression already in place (summarize old, keep recent N). Keep; tune thresholds in settings. Skip-LLM paths for deterministic actions (already in rules). |
| **Goal checker** | Run output + task description. | Input = **run summary** (trail summary + last K errors from run_logs), not full trail + full logs. One short call. |
| **Improvement (planner / improver)** | get_run_for_improvement + optional user note + get_feedback_for_scope. | See below. |

### 10.2 get_run_for_improvement: bounded by default

**Problem:** Full trail + full run_logs can be huge. Sending them raw to the improver blows tokens and context.

**Design:**

- **Default return:** Run metadata + **trail summary** (e.g. one line per step: nodeId, agentName, ok/error, last tool if any) + **recent errors** (last N run_log entries with `[source] message` and truncated payload, e.g. N=20–30, payload max 200 chars each). So the improver gets enough to see “what happened and where it failed” without the full log dump.
- **Optional:** Query param or tool arg `includeFullLogs: true` only when the improver explicitly needs more (e.g. second call after “I need the Playwright lines for step 3”). Prefer improving from the summary first; request full only when necessary.
- **Cap run_log lines** (e.g. 50) and **truncate** long payloads (e.g. 300 chars) so even “recent errors” is bounded.

### 10.3 get_feedback_for_scope: short rows

- **Limit rows** (e.g. 20–30) and **order by createdAt** so we send recent feedback.
- **Per row:** Prefer a **short summary** (e.g. `notes` + one line for input/output) instead of full `input`/`output` JSON. If full is needed for the last 1–2 feedback items, allow that; for the rest, summary only. So the improver sees “what kind of feedback we have” without token explosion.

### 10.4 Improvement step: one call when possible

- Prefer **one** improver LLM call: input = summarized run (from get_run_for_improvement) + user note (if any) + summarized past feedback (from get_feedback_for_scope). Output = concrete edits (update_agent, record_technique_insight, etc.). Avoid “planner then improver” unless necessary; if we do two calls, keep the planner output tiny (e.g. “target: agent X; change: prompt” in one paragraph) so the second call’s input is small.
- **Refine-from-run style tools:** If we have a single tool that does “suggest prompt from run” (load run summary + agent, call LLM, return suggestion), that’s one LLM call with bounded input. Prefer that over the improver doing get_run + get_agent + raw LLM in the open with full run.

### 10.5 Caching and tracking

- **Prompt caching** (where the provider supports it, e.g. OpenAI): Use for system prompt and tool definitions so repeated assistant/specialist calls don’t resend the same tokens.
- **Token tracking:** We already persist `token_usage`. Use it to monitor which flows burn the most tokens (chat vs heap vs improvement) and to set alerts or limits (e.g. cap improvement run size or run_log lines) so we can tune.

### 10.6 Summary: token checklist

| Area | Action |
|------|--------|
| Router | Only specialist ids (and short labels); no tools, no history. |
| Heap context | Structured summary between steps; cap size (e.g. last 2 steps or 500 tokens). |
| get_run_for_improvement | Default: run metadata + trail summary + recent errors (cap N, truncate payloads). Full logs only on request. |
| get_feedback_for_scope | Limit rows (20–30); short summary per row; full input/output only for last 1–2 if needed. |
| Goal checker | Input = run summary + last errors, not full trail/logs. |
| Improvement | One LLM call with summarized inputs when possible; planner output tiny if two calls. |
| Chat | Keep history compression; use skip-LLM paths for deterministic actions. |
| Caching | Use provider prompt caching for system prompt and tool defs where available. |

---

End of UI/UX redesign. Backend and implementation order stay as in the [unified plan](unified_heap_and_self_improvement.plan.md); this doc is the user-experience lens with **minimal interactions** and **minimal token usage** as core principles.
