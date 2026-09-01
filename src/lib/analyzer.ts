import type {
  Capability,
  CapabilityParam,
  GeneratedTool,
  HttpMethod,
  ToolInputSchema,
  ToolManifest,
} from "./types";
import type { RepoFile } from "./fixtures/demoRepo";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Path segments that are already an action, so they need no verb prefix. */
const ACTION_SEGMENTS = new Set(["checkout", "login", "logout", "signup", "subscribe"]);

/** Doc verbs we normalise onto a canonical tool verb. */
const VERB_ALIASES: Record<string, string> = {
  retrieves: "get",
  retrieve: "get",
  returns: "get",
  return: "get",
  fetch: "get",
  fetches: "get",
  read: "get",
  reads: "get",
  gets: "get",
  lists: "list",
  searches: "search",
  adds: "add",
  creates: "create",
  places: "place",
  updates: "update",
  tracks: "track",
};

/**
 * Verbs whose prose reads as a pure read. The generator infers readOnlyHint
 * from this, deliberately, because that is what a prose-driven generator
 * actually does -- and it is exactly the assumption the runtime monitor
 * exists to falsify.
 */
const READ_VERBS = new Set(["get", "list", "search", "track", "find", "show"]);

function singular(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function snake(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** src/app/api/products/[id]/route.ts -> /api/products/{id} */
function routePathFromFile(filePath: string): string | null {
  const match = filePath.match(/app\/(.*)\/route\.[tj]sx?$/);
  if (!match) return null;
  const segments = match[1]
    .split("/")
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? `{${segment.slice(1, -1)}}`
        : segment,
    );
  return `/${segments.join("/")}`;
}

/** The JSDoc block immediately preceding an export, if there is one. */
function docCommentBefore(source: string, exportIndex: number): string {
  const preceding = source.slice(0, exportIndex);
  const open = preceding.lastIndexOf("/**");
  if (open === -1) return "";
  const close = preceding.indexOf("*/", open);
  if (close === -1) return "";
  // Reject a doc block that belongs to something further up the file.
  if (preceding.slice(close + 2).trim().length > 0) return "";
  return preceding
    .slice(open + 3, close)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, " ").trim();
  const stop = flat.indexOf(". ");
  return stop === -1 ? flat : flat.slice(0, stop + 1);
}

function paramsFor(source: string, routePath: string): CapabilityParam[] {
  const params: CapabilityParam[] = [];

  for (const segment of routePath.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const name = segment.slice(1, -1);
      params.push({
        name,
        type: "string",
        required: true,
        description: `Identifier taken from the ${routePath} route segment.`,
        location: "path",
      });
    }
  }

  const queryPattern = /searchParams\.get\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of source.matchAll(queryPattern)) {
    const name = match[1];
    if (params.some((p) => p.name === name)) continue;
    const numericPattern = new RegExp(
      "Number\\(\\s*searchParams\\.get\\(\\s*[\"'`]" + name,
    );
    params.push({
      name,
      type: numericPattern.test(source) ? "number" : "string",
      required: false,
      description: `Query parameter "${name}".`,
      location: "query",
    });
  }

  const body = source.match(/const\s*\{([^}]*)\}\s*=\s*await\s+request\.json\(\)/);
  if (body) {
    for (const raw of body[1].split(",")) {
      const name = raw.trim().split(":")[0].trim();
      if (!name || params.some((p) => p.name === name)) continue;
      params.push({
        name,
        type: /quantity|count|amount|price|total/i.test(name) ? "number" : "string",
        required: true,
        description: `Request body field "${name}".`,
        location: "body",
      });
    }
  }

  return params;
}

export function discoverCapabilities(files: RepoFile[]): Capability[] {
  const capabilities: Capability[] = [];

  for (const file of files) {
    const routePath = routePathFromFile(file.path);
    if (!routePath) continue;

    for (const method of METHODS) {
      const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
      const found = file.content.match(pattern);
      if (!found || found.index === undefined) continue;

      const doc = docCommentBefore(file.content, found.index);
      capabilities.push({
        id: `${method} ${routePath}`,
        source: file.path,
        method,
        path: routePath,
        summary: firstSentence(doc) || `${method} ${routePath}`,
        doc,
        params: paramsFor(file.content, routePath),
      });
    }
  }

  return capabilities;
}

/**
 * The canonical verb the documentation claims this capability performs.
 * Note that this is the prose talking, not the code.
 */
function documentedVerb(capability: Capability): string {
  const first = (capability.doc ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const stripped = first.replace(/[^a-z]/g, "");
  const verb = VERB_ALIASES[stripped] ?? stripped;
  if (verb) return verb;
  return capability.method === "GET" ? "get" : "post";
}

function toolNameFor(capability: Capability): string {
  const segments = capability.path
    .split("/")
    .filter((segment) => segment && segment !== "api" && !segment.startsWith("{"));
  const last = segments[segments.length - 1] ?? "resource";

  if (ACTION_SEGMENTS.has(last)) return snake(last);

  const verb = documentedVerb(capability);

  // /api/orders/track -- the last segment is itself the verb.
  if (snake(last) === verb) {
    const owner = segments[segments.length - 2] ?? last;
    return `${verb}_${singular(snake(owner))}`;
  }

  const hasPathParam = capability.path.includes("{");
  const noun = hasPathParam ? singular(snake(last)) : snake(last);

  if (verb === "add") return `add_to_${singular(noun)}`;
  return `${verb}_${noun}`;
}

function schemaFor(capability: Capability): {
  inputSchema: ToolInputSchema;
  paramLocations: Record<string, "query" | "body" | "path">;
} {
  const properties: ToolInputSchema["properties"] = {};
  const required: string[] = [];
  const paramLocations: Record<string, "query" | "body" | "path"> = {};

  for (const param of capability.params) {
    properties[param.name] = { type: param.type, description: param.description };
    if (param.required) required.push(param.name);
    paramLocations[param.name] = param.location;
  }

  return { inputSchema: { type: "object", properties, required }, paramLocations };
}

/**
 * Turns a capability into a WebMCP tool. The description is carried through
 * from repository prose verbatim, which is how untrusted text reaches an
 * agent in the first place.
 */
export function generateTool(capability: Capability): GeneratedTool {
  const name = toolNameFor(capability);
  const { inputSchema, paramLocations } = schemaFor(capability);

  return {
    name,
    description: (capability.doc || capability.summary).replace(/\s+/g, " ").trim(),
    inputSchema,
    annotations: { readOnlyHint: READ_VERBS.has(documentedVerb(capability)) },
    endpoint: { method: capability.method, path: capability.path },
    paramLocations,
    origin: { source: capability.source, capabilityId: capability.id },
  };
}

export function buildManifest(
  files: RepoFile[],
  repoUrl: string,
  repoLabel: string,
  analyzer: "llm" | "static" = "static",
): ToolManifest {
  const capabilities = discoverCapabilities(files);
  return {
    repoUrl,
    repoLabel,
    generatedAt: new Date().toISOString(),
    analyzer,
    capabilities,
    tools: capabilities.map(generateTool),
  };
}
