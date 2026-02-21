/**
 * OpenAPI 3.x parser: converts a spec into HTTP tool definitions (one per operation).
 * Used by create_tools_from_openapi and any future import-openapi API/UI.
 */

export type OpenApiToolDefinition = {
  id: string;
  name: string;
  protocol: "http";
  config: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  };
  inputSchema: Record<string, unknown>;
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  parameters?: Array<{
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    schema?: Record<string, unknown>;
    description?: string;
  }>;
  requestBody?: {
    content?: {
      "application/json"?: { schema?: Record<string, unknown> };
    };
  };
};

/** One path can have multiple methods (get, post, etc.) */
interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

type OpenApiSpec = {
  openapi?: string;
  swagger?: string;
  servers?: Array<{ url: string }>;
  paths?: Record<string, OpenApiPathItem>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function slugify(str: string): string {
  return (
    str
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() || "op"
  );
}

function pathToSlugSegment(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith("{") && s.endsWith("}") ? "by_" + s.slice(1, -1) : s))
    .join("_");
}

function makeId(
  method: string,
  path: string,
  operationId?: string,
  existingIds?: Set<string>
): string {
  const base = operationId ? slugify(operationId) : `${method}_${pathToSlugSegment(path)}`;
  const ids = existingIds ?? new Set<string>();
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function paramToSchemaProperty(param: {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}): { property: Record<string, unknown>; required: boolean } {
  const schema = param.schema ?? { type: "string" };
  const prop = {
    ...schema,
    ...(param.description ? { description: param.description } : {}),
  };
  return { property: { [param.name]: prop }, required: param.required === true };
}

function mergeRequestBodySchema(content: { schema?: Record<string, unknown> } | undefined): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const schema = content?.schema;
  if (!schema || typeof schema !== "object") return { properties: {}, required: [] };
  const props = (schema.properties as Record<string, unknown>) ?? {};
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return { properties: props, required };
}

/**
 * Parse an OpenAPI 3.x (or 2.0-like) spec and return one HTTP tool definition per operation.
 * - baseUrlOverride: if set, overrides servers[0].url
 * - Id collisions are resolved by appending _2, _3, etc.
 */
export function openApiSpecToToolDefinitions(
  spec: OpenApiSpec,
  options?: { baseUrlOverride?: string }
): OpenApiToolDefinition[] {
  const paths = spec.paths ?? {};
  const server = spec.servers?.[0];
  const baseUrl = (options?.baseUrlOverride ?? server?.url ?? "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("OpenAPI spec has no servers[0].url and no baseUrlOverride was provided.");
  }

  const results: OpenApiToolDefinition[] = [];
  const usedIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(paths)) {
    if (pathItem == null || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const parameters = op.parameters ?? [];
      const pathParams = parameters.filter((p) => p.in === "path");
      const pathParamNames = new Set(pathParams.map((p) => p.name));

      // Build URL: path may contain {param}; we keep it as template for the adapter to fill from input
      const fullPath = path.startsWith("/") ? path : `/${path}`;
      const url = `${baseUrl}${fullPath}`;

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const param of parameters) {
        const { property, required: isReq } = paramToSchemaProperty(param);
        Object.assign(properties, property);
        if (isReq) required.push(param.name);
      }

      const requestBodySchema = mergeRequestBodySchema(
        op.requestBody?.content?.["application/json"]
      );
      if (Object.keys(requestBodySchema.properties).length > 0) {
        Object.assign(properties, requestBodySchema.properties);
        required.push(...requestBodySchema.required);
      }

      const id = makeId(method, path, op.operationId, usedIds);
      usedIds.add(id);
      const name =
        (op.summary as string)?.trim() || op.operationId || `${method.toUpperCase()} ${fullPath}`;

      results.push({
        id,
        name,
        protocol: "http",
        config: {
          url,
          method: method.toUpperCase(),
        },
        inputSchema: {
          type: "object",
          properties,
          required: [...new Set(required)],
        },
      });
    }
  }

  return results;
}

/**
 * Parse spec from string (JSON). Throws if invalid.
 * For YAML, callers can use a YAML parser and pass the resulting object to openApiSpecToToolDefinitions.
 */
export function parseOpenApiSpecFromString(raw: string): OpenApiSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "OpenAPI spec must be valid JSON. YAML is not supported in this parser; parse YAML externally and pass the object."
    );
  }
  if (parsed == null || typeof parsed !== "object") {
    throw new Error("OpenAPI spec must be an object.");
  }
  return parsed as OpenApiSpec;
}
