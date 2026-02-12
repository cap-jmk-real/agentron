import {
  db,
  agents,
  workflows,
  tools as toolsTable,
  fromAgentRow,
  fromWorkflowRow,
  fromToolRow,
} from "../_lib/db";

export const runtime = "nodejs";

const DEFINITION_VERSION = "1";

export type ExportType = "tools" | "agents" | "workflows" | "all";

/** Export tools, agents, and/or workflows as a portable JSON definition. Standard tools (std-*) are excluded so the file is portable. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") ?? "all") as ExportType;
  if (!["tools", "agents", "workflows", "all"].includes(type)) {
    return new Response(JSON.stringify({ error: "Invalid type. Use tools, agents, workflows, or all." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const exportedAt = new Date().toISOString();
  const out: Record<string, unknown> = {
    version: DEFINITION_VERSION,
    exportedAt,
    schema: "agentron-studio-definitions",
  };

  if (type === "tools" || type === "all") {
    const rows = await db.select().from(toolsTable);
    const tools = rows
      .map(fromToolRow)
      .filter((t) => !t.id.startsWith("std-"));
    out.tools = tools;
  }
  if (type === "agents" || type === "all") {
    const rows = await db.select().from(agents);
    out.agents = rows.map(fromAgentRow);
  }
  if (type === "workflows" || type === "all") {
    const rows = await db.select().from(workflows);
    out.workflows = rows.map(fromWorkflowRow);
  }

  const filename =
    type === "all"
      ? `agentron-definitions-${exportedAt.slice(0, 10)}.json`
      : `agentron-${type}-${exportedAt.slice(0, 10)}.json`;

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
