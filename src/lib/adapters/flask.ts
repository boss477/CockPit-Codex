import type { FileTree, HttpMethod, ParamSpec, RouteAdapter, ToolSource } from "../types";
import {
  buildToolName,
  firstSentence,
  pythonDocstringAfter,
} from "./helpers";

export const flaskAdapter: RouteAdapter = {
  name: "Flask",
  detect(files: FileTree): boolean {
    return files.some(
      (f) =>
        f.path.endsWith(".py") &&
        /\b(?:from\s+flask\s+import|Flask\(__name__\)|@(?:app|bp|blueprint)\.route\s*\()/i.test(
          f.content,
        ),
    );
  },
  extract(files: FileTree): ToolSource[] {
    const sources: ToolSource[] = [];

    for (const file of files) {
      if (!file.path.endsWith(".py")) continue;

      const routeRegex =
        /@(?:app|bp|blueprint)\.route\s*\(\s*["']([^"']+)["'](?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?\s*\)/gi;

      for (const match of file.content.matchAll(routeRegex)) {
        const rawPath = match[1];
        const methodsRaw = match[2];
        const matchIndex = match.index ?? 0;

        // Convert /orders/<order_id> or /products/<int:id> -> /orders/{order_id}, /products/{id}
        const routePath = rawPath.replace(/<(?:\w+:)?(\w+)>/g, "{$1}");

        let methods: HttpMethod[] = ["GET"];
        if (methodsRaw) {
          const parsed = methodsRaw
            .split(",")
            .map((m) => m.replace(/["'\s]/g, "").toUpperCase() as HttpMethod)
            .filter((m) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m));
          if (parsed.length > 0) methods = parsed;
        }

        // Find function def
        const afterDecorator = file.content.slice(matchIndex);
        const defMatch = afterDecorator.match(/(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
        if (!defMatch) continue;

        const funcName = defMatch[1];
        const defOffsetInFile = matchIndex + (defMatch.index ?? 0);
        const doc = pythonDocstringAfter(file.content, defOffsetInFile);

        // Handler code snippet for params
        const handlerSnippet = file.content.slice(defOffsetInFile, defOffsetInFile + 600);

        const params: ParamSpec[] = [];

        // Path params
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

        // Query params from request.args.get('...') or request.args[...]
        const queryMatches = handlerSnippet.matchAll(/request\.args(?:\.get\(|\[)\s*["']([^"']+)["']/g);
        for (const qm of queryMatches) {
          const name = qm[1];
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

        // Body params from request.json.get('...') or request.form.get('...')
        const bodyMatches = handlerSnippet.matchAll(
          /request\.(?:json|form|get_json\(\))(?:\.get\(|\[)\s*["']([^"']+)["']/g,
        );
        for (const bm of bodyMatches) {
          const name = bm[1];
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

        const fallbackName = funcName.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase();

        for (const method of methods) {
          const name = buildToolName(routePath, method, doc) || fallbackName;
          const description = (doc || firstSentence(doc) || `${method} ${routePath}`)
            .replace(/\s+/g, " ")
            .trim();

          const methodParams = method === "GET" || method === "DELETE"
            ? params.filter((p) => p.in !== "body")
            : params;

          if (!sources.some((s) => s.id === `${method} ${routePath}`)) {
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
      }
    }

    return sources;
  },
};
