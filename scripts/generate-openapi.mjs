#!/usr/bin/env node
/**
 * Autogenerates OpenAPI 3.0 spec from Next.js API routes under packages/ui/app/api.
 * Writes apps/docs/public/technical/openapi.yaml.
 * Paths and methods from filesystem + route.ts exports; request/response schemas from
 * packages/core types (ts-json-schema-generator) and convention-based path mapping.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const apiDir = join(root, "packages", "ui", "app", "api");
const coreTypesDir = join(root, "packages", "core", "src", "types");
const outPath = join(root, "apps", "docs", "public", "technical", "openapi.yaml");

/** Path → schema mapping: list = GET returns array, single = GET returns one, body = POST/PUT/PATCH body. Covers all resource-style routes. */
const PATH_SCHEMAS = [
  { path: "/api/agents", list: "Agent", body: "Agent" },
  { path: "/api/agents/{id}", single: "Agent", body: "Agent" },
  { path: "/api/tools", list: "ToolDefinition", body: "ToolDefinition" },
  { path: "/api/tools/{id}", single: "ToolDefinition", body: "ToolDefinition" },
  { path: "/api/workflows", list: "Workflow", body: "Workflow" },
  { path: "/api/workflows/{id}", single: "Workflow", body: "Workflow" },
  { path: "/api/feedback", list: "Feedback", body: "Feedback" },
  { path: "/api/feedback/{id}", single: "Feedback", body: "Feedback" },
  { path: "/api/files", list: "FileEntry", body: "FileEntry" },
  { path: "/api/files/{id}", single: "FileEntry", body: "FileEntry" },
  { path: "/api/functions", list: "CustomFunction", body: "CustomFunction" },
  { path: "/api/functions/{id}", single: "CustomFunction", body: "CustomFunction" },
  { path: "/api/chat/conversations", list: "Conversation", body: "Conversation" },
  { path: "/api/chat/conversations/{id}", single: "Conversation", body: "Conversation" },
  { path: "/api/chat/settings", single: "ChatAssistantSettings", body: "ChatAssistantSettings" },
  { path: "/api/sandbox", list: "Sandbox", body: "SandboxConfig" },
  { path: "/api/sandbox/{id}", single: "Sandbox", body: "SandboxConfig" },
  { path: "/api/llm/providers", list: "LLMConfig", body: "LLMConfig" },
  { path: "/api/llm/providers/{id}", single: "LLMConfig", body: "LLMConfig" },
];

const GENERIC_RESPONSE_SCHEMA = { type: "object", description: "Response body (shape depends on route)." };
const GENERIC_BODY_SCHEMA = { type: "object", description: "Request body (see route handler and contracts)." };

function getSchemaForPath(pathKey, method) {
  const rule = PATH_SCHEMAS.find((r) => r.path === pathKey);
  const hasBody = ["post", "put", "patch"].includes(method);
  let response = null;
  let body = null;
  if (rule) {
    if (method === "get" && rule.list)
      response = { type: "array", items: { $ref: "#/components/schemas/" + rule.list } };
    else if (method === "get" && rule.single) response = { $ref: "#/components/schemas/" + rule.single };
    if (hasBody && rule.body) body = { $ref: "#/components/schemas/" + rule.body };
  }
  return {
    response: response ?? GENERIC_RESPONSE_SCHEMA,
    body: hasBody ? (body ?? GENERIC_BODY_SCHEMA) : null,
  };
}

/** Generate OpenAPI components.schemas from packages/core types. Returns {} if generator unavailable. */
function generateComponentSchemas() {
  try {
    const { createGenerator } = require("ts-json-schema-generator");
    const config = {
      path: join(coreTypesDir, "**/*.ts"),
      tsconfig: join(root, "packages", "core", "tsconfig.json"),
      type: "*",
      expose: "export",
      skipTypeCheck: true,
    };
    const generator = createGenerator(config);
    const schema = generator.createSchema("*");
    const defs = schema.definitions || schema.$defs || {};
    const components = {};
    for (const [name, def] of Object.entries(defs)) {
      components[name] = rewriteRefs(def, "#/components/schemas/");
    }
    return components;
  } catch (e) {
    console.warn("[generate-openapi] ts-json-schema-generator skipped:", e.message);
    return {};
  }
}

function rewriteRefs(obj, prefix) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => rewriteRefs(item, prefix));
  if (obj.$ref && typeof obj.$ref === "string") {
    const ref = obj.$ref.replace(/^#\/definitions\//, "").replace(/^#\/\$defs\//, "");
    return { $ref: prefix + ref };
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = rewriteRefs(v, prefix);
  return out;
}

/**
 * Recursively collect all route.ts paths relative to apiDir.
 * @param dir {string}
 * @param segments {string[]}
 * @returns {Array<{ relativePath: string, fullPath: string }>}
 */
function findRoutes(dir, segments = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const routes = [];

  for (const e of entries) {
    const seg = e.name;
    const full = join(dir, seg);

    if (e.isDirectory()) {
      // Next.js dynamic: [id] -> {id}, [[...path]] -> {path}
      const pathSeg = seg
        .replace(/^\[\[\.\.\.(\w+)\]\]$/, "{$1}")
        .replace(/^\[\.\.\.(\w+)\]$/, "{$1}")
        .replace(/^\[(\w+)\]$/, "{$1}");
      routes.push(...findRoutes(full, [...segments, pathSeg]));
    } else if (seg === "route.ts") {
      const relativePath = segments.join("/");
      routes.push({ relativePath, fullPath: full });
    }
  }

  return routes;
}

/**
 * Detect which HTTP methods are exported in a route file.
 * @param content {string}
 * @returns {string[]}
 */
function getMethods(content) {
  const methods = [];
  if (/\bexport\s+(async\s+)?function\s+GET\b/.test(content)) methods.push("get");
  if (/\bexport\s+(async\s+)?function\s+POST\b/.test(content)) methods.push("post");
  if (/\bexport\s+(async\s+)?function\s+PUT\b/.test(content)) methods.push("put");
  if (/\bexport\s+(async\s+)?function\s+PATCH\b/.test(content)) methods.push("patch");
  if (/\bexport\s+(async\s+)?function\s+DELETE\b/.test(content)) methods.push("delete");
  return methods;
}

/**
 * Convert relative path (e.g. "agents/[id]") to OpenAPI path (e.g. /api/agents/{id}).
 */
function toOpenApiPath(relativePath) {
  const path = "/api/" + relativePath.replace(/\[\.\.\.(\w+)\]/g, "{$1}").replace(/\[(\w+)\]/g, "{$1}");
  return path;
}

const componentSchemas = generateComponentSchemas();

// Collect routes
const routeFiles = findRoutes(apiDir);
const paths = {};

for (const { relativePath, fullPath } of routeFiles) {
  const content = readFileSync(fullPath, "utf-8");
  const methods = getMethods(content);
  const pathKey = toOpenApiPath(relativePath);

  if (methods.length === 0) continue;

  paths[pathKey] = {};
  for (const method of methods) {
    const summary = `${method.toUpperCase()} ${pathKey}`;
    const hasBody = ["post", "put", "patch"].includes(method);
    const { response: responseSchema, body: bodySchema } = getSchemaForPath(pathKey, method);

    const successSchema =
      method === "post" && bodySchema && bodySchema.$ref ? bodySchema : responseSchema;
    const operation = {
      summary,
      description: `Studio API route. Request/response schemas from packages/core types or generic object.`,
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": { schema: responseSchema },
          },
        },
        "201": {
          description: "Created",
          content: {
            "application/json": { schema: successSchema },
          },
        },
        "400": { description: "Bad request" },
        "404": { description: "Not found" },
        "500": { description: "Server error" },
      },
    };
    if (hasBody) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: bodySchema,
          },
        },
      };
    }
    paths[pathKey][method] = operation;
  }
}

// Sort paths for stable output
const sortedPaths = Object.keys(paths)
  .sort()
  .reduce((acc, k) => {
    acc[k] = paths[k];
    return acc;
  }, {});

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Agentron Studio API",
    description:
      "HTTP API for the Agentron Studio (agents, workflows, tools, runs, chat, LLM, RAG, etc.). Autogenerated from packages/ui/app/api route handlers; request/response schemas from packages/core types.",
    version: "0.1.9",
  },
  servers: [{ url: "/", description: "Current origin (Swagger UI uses this site's URL)" }],
  paths: sortedPaths,
  ...(Object.keys(componentSchemas).length > 0 && {
    components: {
      schemas: componentSchemas,
    },
  }),
};

// Emit YAML (minimal, no dependency)
function toYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  const lines = [];

  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;

    if (typeof v === "string") {
      const needsQuotes = v.startsWith("#") || v.includes(": ") || v === "true" || v === "false";
      const escaped = v.includes("\n")
        ? `|\n${pad}  ${v.split("\n").join("\n" + pad + "  ")}`
        : needsQuotes
          ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : v;
      lines.push(`${pad}${k}: ${escaped}`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      lines.push(`${pad}${k}: ${v}`);
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      for (const item of v) {
        if (typeof item === "object" && item !== null) {
          const itemLines = toYaml(item, indent + 1).split("\n").filter(Boolean);
          const first = itemLines[0].replace(/^\s+/, "");
          lines.push(`${pad}  - ${first}`);
          for (let i = 1; i < itemLines.length; i++)
            lines.push(`${pad}    ${itemLines[i].replace(/^\s+/, "")}`);
        } else {
          lines.push(`${pad}  - ${item}`);
        }
      }
    } else {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 1));
    }
  }
  return lines.join("\n");
}

const yaml = toYaml(openapi);
writeFileSync(outPath, yaml, "utf-8");
console.log("[generate-openapi] Wrote", outPath, "with", Object.keys(sortedPaths).length, "paths");
