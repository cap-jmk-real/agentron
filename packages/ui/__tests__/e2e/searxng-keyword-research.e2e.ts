/**
 * E2E: SearXNG keyword research — start SearXNG in a container, set app to use it,
 * run an agent that researches keywords for a topic (e.g. consultants who consult consultants).
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import {
  updateAppSettings,
  getAppSettings,
  getContainerEngine,
} from "../../app/api/_lib/app-settings";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

const SEARXNG_CONTAINER_NAME = "searxng-e2e-keyword";
const SEARXNG_IMAGE = "docker.io/searxng/searxng:latest";
const SEARXNG_PORT = parseInt(process.env.SEARXNG_E2E_PORT ?? "8888", 10);
const SEARXNG_BASE_URL = `http://127.0.0.1:${SEARXNG_PORT}`;
const SEARXNG_READY_TIMEOUT_MS = 90_000;
const SEARXNG_READY_POLL_MS = 2000;

let searxngConfigDir: string;
let searxngDataDir: string;
let previousWebSearchProvider: "duckduckgo" | "brave" | "google" | "searxng" | undefined;
let previousSearxngBaseUrl: string | undefined;

interface TrailStep {
  toolCalls?: { name?: string }[];
  output?: string;
}

function parseExecutionTrail(output: unknown): {
  trail: unknown[];
  hasWebSearchCall: boolean;
  lastOutput: string;
} {
  const trail: unknown[] = Array.isArray(
    output && typeof output === "object" && (output as { trail?: unknown }).trail
  )
    ? (output as { trail: unknown[] }).trail
    : [];
  const hasWebSearchCall = trail.some(
    (s: unknown) =>
      typeof s === "object" &&
      s !== null &&
      Array.isArray((s as TrailStep).toolCalls) &&
      (s as TrailStep).toolCalls!.some((t) => t.name === "std-web-search")
  );
  const lastStep = trail[trail.length - 1] as TrailStep | undefined;
  const lastOutput = typeof lastStep?.output === "string" ? lastStep.output : "";
  return { trail, hasWebSearchCall, lastOutput };
}

function runContainer(cmd: string, timeoutMs = 30_000): string {
  const engine = getContainerEngine();
  const full = `${engine} ${cmd}`;
  const shell =
    process.platform === "win32"
      ? (process.env.COMSPEC ?? "cmd.exe")
      : (process.env.SHELL ?? "/bin/sh");
  return execSync(full, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    shell,
  });
}

/** Path for container -v mount: use forward slashes so Docker/Podman on Windows accept it. */
function mountPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function waitForSearXNG(): Promise<boolean> {
  const deadline = Date.now() + SEARXNG_READY_TIMEOUT_MS;
  return new Promise((resolve) => {
    const tryFetch = () => {
      fetch(`${SEARXNG_BASE_URL}/search?q=test&format=json`, {
        signal: AbortSignal.timeout(5000),
      })
        .then((res) => {
          if (res.ok) {
            resolve(true);
            return;
          }
          if (Date.now() >= deadline) {
            e2eLog.step("searxng readiness failed", {
              status: res.status,
              statusText: res.statusText,
              url: `${SEARXNG_BASE_URL}/search?q=test&format=json`,
            });
            resolve(false);
            return;
          }
          setTimeout(tryFetch, SEARXNG_READY_POLL_MS);
        })
        .catch((err) => {
          if (Date.now() >= deadline) {
            e2eLog.step("searxng readiness error", {
              error: err instanceof Error ? err.message : String(err),
              url: `${SEARXNG_BASE_URL}/search?q=test&format=json`,
            });
            resolve(false);
            return;
          }
          setTimeout(tryFetch, SEARXNG_READY_POLL_MS);
        });
    };
    tryFetch();
  });
}

/** Create config/data dirs, write patched settings.yml, run container (with retry on port conflict), wait for readiness. */
async function startSearxngContainer(): Promise<void> {
  searxngConfigDir = path.join(
    os.tmpdir(),
    `searxng-e2e-config-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  searxngDataDir = path.join(
    os.tmpdir(),
    `searxng-e2e-data-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(searxngConfigDir, { recursive: true });
  fs.mkdirSync(searxngDataDir, { recursive: true });

  // Use the image's default settings so the full schema is satisfied (avoids "Expected
  // 'object', got 'null'" from apply_schema). Then patch formats to include json and
  // server to listen on 8080 / 0.0.0.0 for the container.
  const defaultSettings = runContainer(
    `run --rm --entrypoint cat ${SEARXNG_IMAGE} /usr/local/searxng/searx/settings.yml`,
    60_000
  );
  const settingsYml = defaultSettings
    .replace(/  formats:\s*\n(\s+-\s+html)\s*\n/, "  formats:\n$1\n    - json\n")
    .replace(/  port: 8888\s*\n/, "  port: 8080\n")
    .replace(/  bind_address: "127\.0\.0\.1"\s*\n/, '  bind_address: "0.0.0.0"\n')
    .replace(/  secret_key: "ultrasecretkey"/, '  secret_key: "e2e-secret-key"');
  fs.writeFileSync(path.join(searxngConfigDir, "settings.yml"), settingsYml, "utf8");

  const configMount = `${mountPath(searxngConfigDir)}:/etc/searxng`;
  const dataMount = `${mountPath(searxngDataDir)}:/var/cache/searxng`;
  const runArgs = `run -d --name ${SEARXNG_CONTAINER_NAME} -p ${SEARXNG_PORT}:8080 -e SEARXNG_SECRET=e2e-secret-key -v "${configMount}" -v "${dataMount}" ${SEARXNG_IMAGE}`;
  try {
    runContainer(runArgs, 120_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already in use") || msg.includes("port is already allocated")) {
      try {
        runContainer(`rm -f ${SEARXNG_CONTAINER_NAME}`);
        runContainer(runArgs, 120_000);
      } catch (e2) {
        e2eLog.step("searxng start failed", { error: (e2 as Error).message });
        throw e2;
      }
    } else {
      throw e;
    }
  }

  const ready = await waitForSearXNG();
  if (!ready) {
    try {
      const logs = runContainer(`logs --tail 80 ${SEARXNG_CONTAINER_NAME}`);
      e2eLog.step("searxng container logs", { logs });
    } catch {
      // ignore
    }
    throw new Error(
      `SearXNG did not become ready at ${SEARXNG_BASE_URL} within ${SEARXNG_READY_TIMEOUT_MS}ms`
    );
  }
  e2eLog.step("SearXNG ready", { baseUrl: SEARXNG_BASE_URL });
}

/** Store current web search settings and set provider to searxng with SEARXNG_BASE_URL. */
function configureWebSearchProvider(): void {
  const current = getAppSettings();
  previousWebSearchProvider = current.webSearchProvider;
  previousSearxngBaseUrl = current.searxngBaseUrl;
  updateAppSettings({ webSearchProvider: "searxng", searxngBaseUrl: SEARXNG_BASE_URL });
  e2eLog.step("app settings", { webSearchProvider: "searxng", searxngBaseUrl: SEARXNG_BASE_URL });
}

describe("e2e searxng-keyword-research", () => {
  const start = Date.now();

  beforeAll(async () => {
    e2eLog.startTest("searxng-keyword-research");
    e2eLog.scenario(
      "searxng-keyword-research",
      "Start SearXNG, research keywords for business consulting for consultants (consultants who consult consultants)"
    );
    await startSearxngContainer();
    configureWebSearchProvider();
  }, 120_000);

  afterAll(() => {
    updateAppSettings({
      webSearchProvider: previousWebSearchProvider,
      searxngBaseUrl: previousSearxngBaseUrl,
    });
    try {
      runContainer(`rm -f ${SEARXNG_CONTAINER_NAME}`);
    } catch {
      // best effort
    }
    try {
      fs.rmSync(searxngConfigDir, { recursive: true, force: true });
      fs.rmSync(searxngDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("runs keyword-research agent using SearXNG and returns keyword-related output", async () => {
    const agentRes = await executeTool(
      "create_agent",
      {
        name: "E2E Keyword Research Agent",
        description: "Researches keywords for a product and market using web search",
        systemPrompt: `You are a keyword research assistant. Your task: use web search to find relevant keywords for this product and market.

Product: A business consulting firm that consults consultants (consultants who consult consultants).
Find and report:
1. Keywords about the market (e.g. consulting for consultants, B2B consulting, advisory to advisors).
2. Keywords about the product (e.g. consultant coaching, practice development, consulting business).
3. Keywords about the target group (e.g. independent consultants, consulting firms, management consultants).

Use the web search tool multiple times with different queries. Then summarize the most frequent or relevant keywords in a short list. Reply with a clear list of keywords or terms; do not make up data.`,
        toolIds: ["std-web-search"],
        llmConfigId: E2E_LLM_CONFIG_ID,
      },
      undefined
    );
    expect(agentRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const agentId = (agentRes as { id?: string }).id;
    expect(typeof agentId).toBe("string");
    if (typeof agentId !== "string") throw new Error("expected agentId");
    e2eLog.step("create_agent", { agentId });

    const wfRes = await executeTool(
      "create_workflow",
      { name: "E2E Keyword Research WF" },
      undefined
    );
    expect(wfRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    const workflowId = (wfRes as { id?: string }).id;
    expect(typeof workflowId).toBe("string");
    if (typeof workflowId !== "string") throw new Error("expected workflowId");
    e2eLog.step("create_workflow", { workflowId });

    const updateRes = await executeTool(
      "update_workflow",
      {
        id: workflowId,
        nodes: [{ id: "n1", type: "agent", position: [0, 0], parameters: { agentId } }],
        edges: [],
      },
      undefined
    );
    expect(updateRes).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    e2eLog.step("update_workflow");

    const userMessage =
      "Research keywords for our business: we are consultants who consult consultants. Find relevant keywords for our market, our service, and our target group (other consultants and consulting firms). Search for relevant terms and report what keywords appear frequently.";
    const execRes = await executeTool(
      "execute_workflow",
      { workflowId, inputs: { message: userMessage } },
      undefined
    );
    expect(execRes).not.toEqual(expect.objectContaining({ error: "Workflow not found" }));
    const runId = (execRes as { id?: string }).id;
    expect(typeof runId).toBe("string");
    expect(runId).toBeTruthy();
    e2eLog.runId(runId ?? "");

    const status = (execRes as { status?: string }).status;
    expect(status).toBe("completed");
    expect((execRes as { error?: string }).error).toBeUndefined();

    const output = (execRes as { output?: unknown }).output;
    const { trail, hasWebSearchCall, lastOutput } = parseExecutionTrail(output);
    expect(hasWebSearchCall).toBe(true);

    const outputLower = lastOutput.toLowerCase();
    const hasKeywordLikeContent =
      outputLower.includes("keyword") ||
      outputLower.includes("consultant") ||
      outputLower.includes("consulting") ||
      outputLower.includes("advisory") ||
      outputLower.includes("b2b") ||
      /\b(coach|practice|market|target|firm|advisor)\b/.test(outputLower);
    expect(hasKeywordLikeContent).toBe(true);

    e2eLog.step("keywords_output", { keywords: lastOutput });
  }, 120_000);
});
