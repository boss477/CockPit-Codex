import type { FileTree, HttpMethod, ParamSpec, RouteAdapter, ToolSource } from "../types";
import {
  buildToolName,
  docCommentBefore,
  firstSentence,
  METHODS,
} from "./helpers";

function routePathFromPagesFile(filePath: string): string | null {
  const match = filePath.match(/(?:^|\/)pages\/api\/(.*?)(?:\/index)?\.[tj]sx?$/);
  if (!match) return null;
  const segments = match[1]
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? `{${segment.slice(1, -1)}}`
        : segment,
    );
  return `/api${segments.length ? "/" + segments.join("/") : ""}`;
}

function extractParams(source: string, routePath: string): ParamSpec[] {
  const params: ParamSpec[] = [];

  // Path parameters
  for (const segment of routePath.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const name = segment.slice(1, -1);
      params.push({
        name,
        type: "string",
        required: true,
        description: `Path parameter "${name}".`,
        in: "path",
      });
    }
  }

  // Query parameters: req.query.foo or { foo } = req.query
  const queryDirect = /req\.query\.([a-zA-Z0-9_]+)/g;
  for (const match of source.matchAll(queryDirect)) {
    const name = match[1];
    if (!params.some((p) => p.name === name)) {
      params.push({
        name,
        type: "string",
        required: false,
        description: `Query parameter "${name}".`,
        in: "query",
      });
    }
  }
  const queryDestruct = /const\s*\{([^}]*)\}\s*=\s*req\.query/;
  const qdMatch = source.match(queryDestruct);
  if (qdMatch) {
    for (const raw of qdMatch[1].split(",")) {
      const name = raw.trim().split(":")[0].trim();
      if (name && !params.some((p) => p.name === name)) {
        params.push({
          name,
          type: "string",
          required: false,
          description: `Query parameter "${name}".`,
          in: "query",
        });
      }
    }
  }

  // Body parameters: req.body.foo or { foo } = req.body
  const bodyDirect = /req\.body\.([a-zA-Z0-9_]+)/g;
  for (const match of source.matchAll(bodyDirect)) {
    const name = match[1];
    if (!params.some((p) => p.name === name)) {
      params.push({
        name,
        type: /quantity|count|amount|price|total/i.test(name) ? "number" : "string",
        required: true,
        description: `Request body field "${name}".`,
        in: "body",
      });
    }
  }
  const bodyDestruct = /const\s*\{([^}]*)\}\s*=\s*req\.body/;
  const bdMatch = source.match(bodyDestruct);
  if (bdMatch) {
    for (const raw of bdMatch[1].split(",")) {
      const name = raw.trim().split(":")[0].trim();
      if (name && !params.some((p) => p.name === name)) {
        params.push({
          name,
          type: /quantity|count|amount|price|total/i.test(name) ? "number" : "string",
          required: true,
          description: `Request body field "${name}".`,
          in: "body",
        });
      }
    }
  }

  return params;
}

export const nextPagesRouterAdapter: RouteAdapter = {
  name: "Next.js Pages Router",
  detect(files: FileTree): boolean {
    return files.some((f) => /(?:^|\/)pages\/api\/.*?\.[tj]sx?$/.test(f.path));
  },
  extract(files: FileTree): ToolSource[] {
    const sources: ToolSource[] = [];

    for (const file of files) {
      const routePath = routePathFromPagesFile(file.path);
      if (!routePath) continue;

      const handlerPattern = /export\s+default\s+(?:async\s+)?function(?:\s+[a-zA-Z0-9_]+)?\s*\(/;
      const handlerMatch = file.content.match(handlerPattern);
      const doc = handlerMatch?.index !== undefined ? docCommentBefore(file.content, handlerMatch.index) : "";

      // Check method branching
      const detectedMethods = new Set<HttpMethod>();
      for (const m of METHODS) {
        const checkPattern = new RegExp(`req\\.method\\s*===?\\s*["'\`]${m}["'\`]|case\\s*["'\`]${m}["'\`]`, "i");
        if (checkPattern.test(file.content)) {
          detectedMethods.add(m);
        }
      }

      // If if/else on method exists and has query handling in else, also include GET
      if (detectedMethods.size > 0 && !detectedMethods.has("GET") && /req\.query/i.test(file.content)) {
        detectedMethods.add("GET");
      }

      const methodsToEmit: HttpMethod[] = detectedMethods.size > 0
        ? Array.from(detectedMethods)
        : [/req\.body/i.test(file.content) ? "POST" : "GET"];

      const params = extractParams(file.content, routePath);

      for (const method of methodsToEmit) {
        const name = buildToolName(routePath, method, doc);
        const description = (doc || firstSentence(doc) || `${method} ${routePath}`)
          .replace(/\s+/g, " ")
          .trim();

        // Filter params for method
        const methodParams = method === "GET" || method === "DELETE"
          ? params.filter((p) => p.in !== "body")
          : params;

        sources.push({
          id: `${method} ${routePath}`,
          name,
          method,
          path: routePath,
          baseUrl: null,
          params: methodParams,
          description,
          executable: true,
          origin: "repo",
          source: file.path,
          doc,
        });
      }
    }

    return sources;
  },
};
