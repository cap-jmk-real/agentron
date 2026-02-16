# Browser Automation & Learning from Demonstration – Design

## Goal

1. **Browser tool** – Agents can help users browse the internet and perform tasks (e.g. LinkedIn outreach with follow‑ups).
2. **Learning from demonstration** – The user shows the assistant how to do a task; it creates agents, workflows, and tools from that.
3. **User-visible, interactive browser** – Use the user’s own browser (or equivalent) so they can see and interact with it, rather than a hidden headless instance.

---

## Current State

- **`std-browser`** – Fetches a URL and returns HTML only. No navigation, clicks, or typing.
- **Tool infra** – Native tools, MCP tools, HTTP tools. Agents call tools via `context.callTool`.
- **Workflow/agent creation** – Chat assistant has `create_workflow`, `create_agent`, `add_workflow_edges`, etc. Workflows use agent nodes and edges.

---

## Option A: User’s OS Browser via CDP (Recommended)

### Idea

1. User launches Chrome with remote debugging:  
   `chrome --remote-debugging-port=9222`
2. AgentOS connects to it with Playwright’s `chromium.connectOverCDP()`.
3. Agent controls the same browser window/tabs the user sees.
4. User can interact while the agent works, or share an already logged‑in session.

### Pros

- Uses the user’s real Chrome profile (cookies, logins, extensions).
- User sees everything and can intervene.
- Playwright already supports CDP connection.
- Simpler than building an extension.

### Cons

- User must start Chrome with `--remote-debugging-port=9222`.
- Debug port must be secured (only localhost, not on public networks).
- Chrome/Chromium only (Edge/Brave work too).

### Implementation

1. **Playwright dependency** – Add `playwright` to the runtime package.
2. **Browser tool** – New or extended builtin that:
   - Connects to `http://localhost:9222` (or configurable URL).
   - Accepts actions: `navigate`, `click`, `fill`, `screenshot`, `getContent` (DOM/text).
   - Runs these via Playwright against the connected browser.
3. **UI hint** – In Studio, show a short “how to enable browser automation” note with the Chrome launch command.

---

## Option B: Browser Extension

### Idea

1. Chrome/Firefox extension installed in the user’s browser.
2. Extension talks to AgentOS over WebSocket (Studio provides the URL).
3. **Execute**: Agent sends commands; extension runs them in the active tab.
4. **Record**: Extension records user actions (clicks, inputs, navigation) and sends them to AgentOS.

### Pros

- No special Chrome launch; user uses normal browsing.
- Recording is natural: user does the task, extension captures it.
- Works for any site the user visits.

### Cons

- More work: extension, backend API, security, store/install flow.
- Extension permissions (tabs, scripting) require user trust.

---

## Option C: Playwright Headed (Own Window)

### Idea

1. Playwright launches Chromium in headed mode (visible window).
2. Agent controls that window; user can watch.
3. No CDP setup, no extension.

### Pros

- Easiest to implement.
- No extra setup for the user.
- Cross‑browser (Chromium, Firefox, WebKit) if needed.

### Cons

- Separate browser window; not the user’s main browser.
- No reuse of existing sessions (cookies/logins).
- User can’t easily share their normal browsing context.

---

## Recommended Path: CDP + Later Extension for Recording

1. **Phase 1 – CDP browser tool**
   - Implement a browser tool that connects to Chrome via CDP.
   - Actions: `navigate`, `click`, `fill`, `screenshot`, `getContent`.
   - Document how to start Chrome with remote debugging.

2. **Phase 2 – Recording from CDP**
   - Use CDP to record user actions in the same connected browser (DOM mutations, input events).
   - Or add a small “record mode” UI in the browser tab that injects a script to capture clicks/inputs and send them to AgentOS.

3. **Phase 3 – Extension (optional)**
   - Add an extension if users want recording without CDP, or more advanced recording.

---

## Learning from Demonstration – High‑Level Flow

1. **Record** – User performs the task in the browser (either CDP‑attached or via extension). Actions are captured:
   - `navigate(url)`
   - `click(selector)`
   - `fill(selector, value)`
   - `waitForSelector(selector)` (optional)

2. **Generalize** – Assistant turns the trace into a parameterized workflow:
   - Identify variable parts (e.g. search query, message template).
   - Define inputs: `{ searchQuery, message, delayBetweenSteps }`.
   - Build a workflow: agent 1 → tool 1 → agent 2 → tool 2, etc.

3. **Persist** – Create:
   - A **workflow** (agent nodes + tool nodes + edges).
   - A **tool** (e.g. “LinkedIn outreach”) that wraps the recorded steps.
   - An **agent** with a system prompt and tool IDs.

4. **Schedule** – For “LinkedIn outreach with follow‑ups”, set `executionMode: "interval"` and `schedule` (e.g. daily).

---

## Proposed Tool API (CDP Browser Tool)

```ts
// Input schema
{
  action: "navigate" | "click" | "fill" | "screenshot" | "getContent" | "waitFor",
  url?: string,           // for navigate
  selector?: string,      // for click, fill, waitFor (CSS or text)
  value?: string,         // for fill
  timeout?: number        // ms
}

// Output
{ success: boolean, content?: string, screenshot?: string, error?: string }
```

Optional: support `steps: [...]` for executing a sequence in one call (batch of actions).

---

## Security Considerations

- **CDP port** – Only bind/listen on localhost; never expose 9222 to the network.
- **Extension** – Validate origin of WebSocket connections; use token or similar for Studio auth.
- **Recording** – Only record when the user explicitly enables it; store and handle traces carefully.

---

## Enabling browser automation

To use the **std-browser-automation** tool (navigate, click, fill, getContent, screenshot, waitFor):

1. Start Chrome with remote debugging:  
   `chrome --remote-debugging-port=9222`  
   (On macOS you may need the full path, e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222`.)
2. Ensure at least one tab is open. The tool connects to the first context and first page.
3. Attach **std-browser-automation** (and **std-request-user-help** when the agent should ask the user to choose from a list) to the workflow agent. For "get list from web then ask user which one", the runtime injects an instruction so the agent uses the browser first, then calls request_user_help.

Login/session reuse: the tool uses the user's existing Chrome instance, so cookies and logged-in sessions (e.g. LinkedIn) are available. For credentials, use the vault when the user has approved (see optional vault integration).

### Vault and credentials for browser login (optional)

For "login then fetch list" agents (e.g. LinkedIn, Sales Navigator): the workflow run or browser tool can resolve credentials from the vault when the user has approved (e.g. "use vault credentials"). Document for users: store credentials in the vault and approve their use for the run; the agent's system prompt should state "use vault-stored credentials only when permitted" and must not log or echo them. Implementation: ensure the workflow run (or browser tool) can receive vault-resolved credentials via tool context or run context when the user has approved.

## Next Steps

1. ~~Add `playwright` to `packages/runtime`.~~ Done.
2. ~~Implement CDP browser tool.~~ Done: `packages/runtime/src/tools/browser-automation.ts`; tool id `std-browser-automation`.
3. ~~Add tool definition in the DB and wire in run-workflow.~~ Done.
4. Add assistant tool descriptions for “enable browser automation” and “record demonstration”.
5. Implement recording pipeline (CDP or extension) and workflow generation from recorded steps.
