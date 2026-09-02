import type { FileTree, ParamSpec, RouteAdapter, ToolSource } from "../types";
import {
  buildToolName,
  docCommentBefore,
  firstSentence,
  METHODS,
} from "./helpers";

function routePathFromFile(filePath: string): string | null {
  const match = filePath.match(/(?:^|\/)app\/(.*)\/route\.[tj]sx?$/);
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

function paramsFor(source: string, routePath: string): ParamSpec[] {
  const params: ParamSpec[] = [];

  for (const segment of routePath.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const name = segment.slice(1, -1);
      params.push({
        name,
        type: "string",
        required: true,
        description: `Identifier taken from the ${routePath} route segment.`,
        in: "path",
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
      in: "query",
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
        in: "body",
      });
    }
  }

  return params;
}

export const nextAppRouterAdapter: RouteAdapter = {
  name: "Next.js App Router",
  detect(files: FileTree): boolean {
    return files.some((f) => /(?:^|\/)app\/.*route\.[tj]sx?$/.test(f.path));
  },
  extract(files: FileTree): ToolSource[] {
    const sources: ToolSource[] = [];

    for (const file of files) {
      const routePath = routePathFromFile(file.path);
      if (!routePath) continue;

      for (const method of METHODS) {
        const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
        const found = file.content.match(pattern);
        if (!found || found.index === undefined) continue;

        const doc = docCommentBefore(file.content, found.index);
        const params = paramsFor(file.content, routePath);
        const name = buildToolName(routePath, method, doc);
        const description = (doc || firstSentence(doc) || `${method} ${routePath}`)
          .replace(/\s+/g, " ")
          .trim();

        sources.push({
          id: `${method} ${routePath}`,
          name,
          method,
          path: routePath,
          baseUrl: null,
          params,
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
