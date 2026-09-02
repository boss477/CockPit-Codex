import type { FileTree, HttpMethod, ParamSpec, RouteAdapter, ToolSource } from "../types";
import {
  buildToolName,
  docCommentBefore,
  firstSentence,
} from "./helpers";

export const expressAdapter: RouteAdapter = {
  name: "Express",
  detect(files: FileTree): boolean {
    return files.some((f) =>
      /\b(?:express\(\)|express\.Router\(\)|app\.(?:get|post|put|patch|delete)\s*\(|router\.(?:get|post|put|patch|delete)\s*\()/i.test(
        f.content,
      ),
    );
  },
  extract(files: FileTree): ToolSource[] {
    const sources: ToolSource[] = [];

    for (const file of files) {
      // Find app.get / router.post calls
      const routeCallRegex =
        /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

      for (const match of file.content.matchAll(routeCallRegex)) {
        const rawMethod = match[1].toUpperCase() as HttpMethod;
        const rawPath = match[2];
        const matchIndex = match.index ?? 0;

        // Convert /api/users/:id -> /api/users/{id}
        const routePath = rawPath.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");

        // Extract snippet of handler following the route definition up to next route or ~500 chars
        const handlerSnippet = file.content.slice(matchIndex, matchIndex + 600);
        const doc = docCommentBefore(file.content, matchIndex);

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

        // Query params: req.query.foo or { foo } = req.query
        const queryDirect = /req\.query\.([a-zA-Z0-9_]+)/g;
        for (const qm of handlerSnippet.matchAll(queryDirect)) {
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

        // Body params: req.body.foo or { foo } = req.body
        if (rawMethod !== "GET" && rawMethod !== "DELETE") {
          const bodyDirect = /req\.body\.([a-zA-Z0-9_]+)/g;
          for (const bm of handlerSnippet.matchAll(bodyDirect)) {
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
          const bodyDestruct = /const\s*\{([^}]*)\}\s*=\s*req\.body/;
          const bdMatch = handlerSnippet.match(bodyDestruct);
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
        }

        const name = buildToolName(routePath, rawMethod, doc);
        const description = (doc || firstSentence(doc) || `${rawMethod} ${routePath}`)
          .replace(/\s+/g, " ")
          .trim();

        // Avoid duplicate method+path in same file
        if (!sources.some((s) => s.id === `${rawMethod} ${routePath}`)) {
          sources.push({
            id: `${rawMethod} ${routePath}`,
            name,
            method: rawMethod,
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
    }

    return sources;
  },
};
