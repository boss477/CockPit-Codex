import type { FileTree, HttpMethod, ParamSpec, ToolSource } from "../types";
import { buildToolName, firstSentence } from "./helpers";

const SPEC_FILE_PATTERNS = [
  /(?:^|\/)(?:openapi|swagger)\.(?:json|ya?ml)$/i,
  /(?:^|\/)public\/\.well-known\/openapi\.json$/i,
  /(?:^|\/)\.well-known\/openapi\.json$/i,
  /(?:^|\/)api-docs\.(?:json|ya?ml)$/i,
];

export function findRepoOpenApiFile(files: FileTree): { path: string; content: string } | null {
  for (const pattern of SPEC_FILE_PATTERNS) {
    const found = files.find((f) => pattern.test(f.path));
    if (found) return found;
  }
  return null;
}

/**
 * Parses an OpenAPI 3.x or Swagger 2.0 spec object into ToolSource[]
 */
export function parseOpenApiSpec(
  specObj: Record<string, unknown>,
  sourcePath: string = "openapi.json",
): ToolSource[] {
  const sources: ToolSource[] = [];
  const paths = (specObj.paths ?? {}) as Record<string, Record<string, unknown>>;
  const servers = (specObj.servers ?? []) as Array<{ url?: string }>;
  const host = typeof specObj.host === "string" ? specObj.host : null;
  const basePath = typeof specObj.basePath === "string" ? specObj.basePath : "";
  const schemes = (specObj.schemes ?? ["https"]) as string[];

  let defaultBaseUrl: string | null = null;
  if (servers.length > 0 && typeof servers[0]?.url === "string") {
    defaultBaseUrl = servers[0].url;
  } else if (host) {
    defaultBaseUrl = `${schemes[0] ?? "https"}://${host}${basePath}`;
  }

  const METHODS = ["get", "post", "put", "patch", "delete"] as const;

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    // Common path-level parameters
    const commonParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of METHODS) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op || typeof op !== "object") continue;

      const httpMethod = method.toUpperCase() as HttpMethod;
      const opParams = Array.isArray(op.parameters) ? op.parameters : [];
      const allRawParams = [...commonParams, ...opParams];

      const params: ParamSpec[] = [];

      for (const p of allRawParams) {
        if (!p || typeof p !== "object") continue;
        const pObj = p as {
          name?: string;
          in?: string;
          required?: boolean;
          description?: string;
          schema?: { type?: string };
          type?: string;
        };
        const name = pObj.name;
        if (!name) continue;

        const pIn = pObj.in === "path" ? "path" : pObj.in === "body" ? "body" : pObj.in === "header" ? "header" : "query";
        const rawType = pObj.schema?.type || pObj.type || "string";
        const type: ParamSpec["type"] =
          rawType === "integer" || rawType === "number"
            ? "number"
            : rawType === "boolean"
              ? "boolean"
              : rawType === "array"
                ? "array"
                : rawType === "object"
                  ? "object"
                  : "string";

        params.push({
          name,
          in: pIn,
          type,
          required: Boolean(pObj.required ?? (pIn === "path")),
          description: pObj.description ?? `Parameter "${name}"`,
        });
      }

      // OpenAPI 3.x requestBody
      if (op.requestBody && typeof op.requestBody === "object") {
        const rb = op.requestBody as {
          description?: string;
          required?: boolean;
          content?: Record<string, { schema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } }>;
        };
        const jsonContent = rb.content?.["application/json"];
        const schema = jsonContent?.schema;
        if (schema?.properties) {
          const requiredSet = new Set(schema.required ?? []);
          for (const [propName, propObj] of Object.entries(schema.properties)) {
            if (params.some((p) => p.name === propName)) continue;
            const rawType = propObj.type || "string";
            const type: ParamSpec["type"] =
              rawType === "integer" || rawType === "number"
                ? "number"
                : rawType === "boolean"
                  ? "boolean"
                  : rawType === "array"
                    ? "array"
                    : rawType === "object"
                      ? "object"
                      : "string";
            params.push({
              name: propName,
              in: "body",
              type,
              required: requiredSet.has(propName),
              description: propObj.description ?? `Request body field "${propName}"`,
            });
          }
        }
      }

      const summary = typeof op.summary === "string" ? op.summary : "";
      const descriptionText = typeof op.description === "string" ? op.description : "";
      const rawDoc = [summary, descriptionText].filter(Boolean).join(". ").trim();
      const operationId = typeof op.operationId === "string" ? op.operationId : "";

      const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
      const name = operationId
        ? operationId.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase()
        : buildToolName(normalizedPath, httpMethod, rawDoc);

      const isLocalhost = Boolean(
        defaultBaseUrl &&
          (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(defaultBaseUrl) || defaultBaseUrl.startsWith("/")),
      );

      sources.push({
        id: `${httpMethod} ${normalizedPath}`,
        name,
        method: httpMethod,
        path: normalizedPath,
        baseUrl: defaultBaseUrl,
        params,
        description: rawDoc || firstSentence(rawDoc) || `${httpMethod} ${normalizedPath}`,
        executable: isLocalhost,
        origin: "openapi",
        source: sourcePath,
        doc: rawDoc,
      });
    }
  }

  return sources;
}

/**
 * Lightweight JSON/YAML string parser for OpenAPI/Swagger specs
 */
export function parseSpecContent(content: string, sourcePath: string): ToolSource[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 1. Try JSON parse
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseOpenApiSpec(parsed, sourcePath);
    } catch {
      // fallback to yaml parsing
    }
  }

  // 2. Simple YAML -> basic object parser for paths and endpoints
  try {
    const yamlObj = simpleYamlToJson(trimmed);
    if (yamlObj && typeof yamlObj === "object" && "paths" in yamlObj) {
      return parseOpenApiSpec(yamlObj as Record<string, unknown>, sourcePath);
    }
  } catch {
    // ignore
  }

  return [];
}

/** Minimal fallback YAML parser for typical OpenAPI files without external dependencies */
function simpleYamlToJson(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};
  result.paths = paths;

  let currentPath = "";
  let currentMethod = "";

  const lines = yaml.split("\n");
  let inPaths = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^paths\s*:/i.test(line.trim())) {
      inPaths = true;
      continue;
    }

    if (inPaths) {
      // Check top-level non-indented key to exit paths
      if (/^[a-zA-Z0-9_-]+\s*:/i.test(line) && !line.startsWith(" ")) {
        inPaths = false;
        continue;
      }

      // Path line: e.g. "  /api/products:" or "  '/api/products':"
      const pathMatch = line.match(/^\s{2}(['"]?\/[^'":]+['"]?)\s*:/);
      if (pathMatch) {
        currentPath = pathMatch[1].replace(/['"]/g, "").trim();
        paths[currentPath] = paths[currentPath] || {};
        currentMethod = "";
        continue;
      }

      // Method line: e.g. "    get:"
      const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete)\s*:/i);
      if (methodMatch && currentPath) {
        currentMethod = methodMatch[1].toLowerCase();
        paths[currentPath][currentMethod] = { parameters: [] };
        continue;
      }

      // Summary or description
      const summaryMatch = line.match(/^\s{6}summary\s*:\s*(.*)/i);
      if (summaryMatch && currentPath && currentMethod) {
        const op = paths[currentPath][currentMethod] as Record<string, unknown>;
        op.summary = summaryMatch[1].replace(/['"]/g, "").trim();
      }

      const descMatch = line.match(/^\s{6}description\s*:\s*(.*)/i);
      if (descMatch && currentPath && currentMethod) {
        const op = paths[currentPath][currentMethod] as Record<string, unknown>;
        op.description = descMatch[1].replace(/['"]/g, "").trim();
      }
    }
  }

  return result;
}
