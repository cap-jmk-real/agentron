import { json } from "../_lib/response";
import {
  db,
  agents as agentsTable,
  workflows as workflowsTable,
  tools as toolsTable,
  toAgentRow,
  toWorkflowRow,
  toToolRow,
} from "../_lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type ImportPayload = {
  version?: string;
  tools?: Array<{
    id: string;
    name: string;
    protocol: string;
    config?: Record<string, unknown>;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>;
  agents?: Array<Record<string, unknown> & { id: string; name: string }>;
  workflows?: Array<
    Record<string, unknown> & {
      id: string;
      name: string;
      nodes?: unknown[];
      edges?: unknown[];
      executionMode?: string;
    }
  >;
  options?: { skipExisting?: boolean };
};

type Counts = { created: number; skipped: number; updated: number };

type ToolItem = NonNullable<ImportPayload["tools"]>[number];
function isToolLike(t: unknown): t is ToolItem {
  return typeof t === "object" && t !== null && "id" in t && "name" in t && "protocol" in t;
}

function isAgentLike(a: unknown): a is NonNullable<ImportPayload["agents"]>[number] {
  return typeof a === "object" && a !== null && "id" in a && "name" in a;
}

function isWorkflowLike(w: unknown): w is NonNullable<ImportPayload["workflows"]>[number] {
  return typeof w === "object" && w !== null && "id" in w && "name" in w;
}

/** Import tools, agents, and/or workflows from a JSON definition. Standard tools (std-*) are never imported. */
export async function POST(request: Request) {
  let body: ImportPayload;
  try {
    body = (await request.json()) as ImportPayload;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skipExisting = body.options?.skipExisting !== false;
  const counts = {
    tools: { created: 0, skipped: 0, updated: 0 } as Counts,
    agents: { created: 0, skipped: 0, updated: 0 } as Counts,
    workflows: { created: 0, skipped: 0, updated: 0 } as Counts,
  };

  // --- Tools ---
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (!isToolLike(t) || t.id.startsWith("std-")) {
        counts.tools.skipped++;
        continue;
      }
      const tool = {
        id: t.id,
        name: t.name,
        protocol: t.protocol as "native" | "http" | "mcp",
        config: t.config ?? {},
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
      };
      const existing = await db
        .select()
        .from(toolsTable)
        .where(eq(toolsTable.id, tool.id))
        .limit(1);
      if (existing.length > 0) {
        if (skipExisting) {
          counts.tools.skipped++;
        } else {
          await db.update(toolsTable).set(toToolRow(tool)).where(eq(toolsTable.id, tool.id)).run();
          counts.tools.updated++;
        }
      } else {
        await db.insert(toolsTable).values(toToolRow(tool)).run();
        counts.tools.created++;
      }
    }
  }

  // --- Agents ---
  if (Array.isArray(body.agents)) {
    for (const a of body.agents) {
      if (!isAgentLike(a)) {
        counts.agents.skipped++;
        continue;
      }
      const agent = {
        id: a.id,
        name: a.name,
        description: a.description ?? undefined,
        kind: (a.kind as string) ?? "node",
        type: (a.type as string) ?? "internal",
        protocol: (a.protocol as string) ?? "native",
        endpoint: a.endpoint as string | undefined,
        agentKey: a.agentKey as string | undefined,
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
        scopes: Array.isArray(a.scopes) ? a.scopes : [],
        llmConfig: a.llmConfig as Record<string, unknown> | undefined,
        definition: a.definition,
      };
      const existing = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agent.id))
        .limit(1);
      if (existing.length > 0) {
        if (skipExisting) {
          counts.agents.skipped++;
        } else {
          await db
            .update(agentsTable)
            .set(toAgentRow(agent as Parameters<typeof toAgentRow>[0]))
            .where(eq(agentsTable.id, agent.id))
            .run();
          counts.agents.updated++;
        }
      } else {
        await db
          .insert(agentsTable)
          .values(toAgentRow(agent as Parameters<typeof toAgentRow>[0]))
          .run();
        counts.agents.created++;
      }
    }
  }

  // --- Workflows ---
  if (Array.isArray(body.workflows)) {
    for (const w of body.workflows) {
      if (!isWorkflowLike(w)) {
        counts.workflows.skipped++;
        continue;
      }
      const workflow = {
        id: w.id,
        name: w.name,
        description: w.description as string | undefined,
        nodes: Array.isArray(w.nodes) ? w.nodes : [],
        edges: Array.isArray(w.edges) ? w.edges : [],
        executionMode: (w.executionMode as string) ?? "one_time",
        schedule: w.schedule as string | undefined,
      };
      const existing = await db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.id, workflow.id))
        .limit(1);
      if (existing.length > 0) {
        if (skipExisting) {
          counts.workflows.skipped++;
        } else {
          await db
            .update(workflowsTable)
            .set(toWorkflowRow(workflow as import("@agentron-studio/core").Workflow))
            .where(eq(workflowsTable.id, workflow.id))
            .run();
          counts.workflows.updated++;
        }
      } else {
        await db
          .insert(workflowsTable)
          .values(toWorkflowRow(workflow as import("@agentron-studio/core").Workflow))
          .run();
        counts.workflows.created++;
      }
    }
  }

  return json({
    ok: true,
    message: "Import completed.",
    counts,
  });
}
