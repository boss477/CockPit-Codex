import type { FileTree, HttpMethod, ParamSpec, RouteAdapter, ToolSource } from "../types";
import {
  buildToolName,
  firstSentence,
  pythonDocstringAfter,
} from "./helpers";

export const fastapiAdapter: RouteAdapter = {
  name: "FastAPI",
  detect(files: FileTree): boolean {
    return files.some(
      (f) =>
        f.path.endsWith(".py") &&
        /\b(?:from\s+fastapi\s+import|FastAPI\(|@(?:app|router)\.(?:get|post|put|patch|delete)\s*\()/i.test(
          f.content,
        ),
    );
  },
  extract(files: FileTree): ToolSource[] {
    const sources: ToolSource[] = [];

    for (const file of files) {
      if (!file.path.endsWith(".py")) continue;

      const routeRegex =
        /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;

      for (const match of file.content.matchAll(routeRegex)) {
        const rawMethod = match[1].toUpperCase() as HttpMethod;
        const routePath = match[2];
        const matchIndex = match.index ?? 0;

        // Find the def or async def following this decorator
        const afterDecorator = file.content.slice(matchIndex);
        const defMatch = afterDecorator.match(/(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
        if (!defMatch) continue;

        const funcName = defMatch[1];
        const argsList = defMatch[2];
        const defOffsetInFile = matchIndex + (defMatch.index ?? 0);
        const doc = pythonDocstringAfter(file.content, defOffsetInFile);

        const params: ParamSpec[] = [];

        // Path params from route path {param}
        const pathParamNames = new Set<string>();
        for (const segment of routePath.split("/")) {
          if (segment.startsWith("{") && segment.endsWith("}")) {
            const name = segment.slice(1, -1);
            pathParamNames.add(name);
            params.push({
              name,
              type: "string",
              required: true,
              description: `Path parameter "${name}".`,
              in: "path",
            });
          }
        }

        // Parse arguments: (item_id: int, q: Optional[str] = None, item: Item)
        const rawArgs = argsList.split(",").map((a) => a.trim()).filter(Boolean);
        for (const arg of rawArgs) {
          if (arg === "self" || arg === "request" || arg.startsWith("request:")) continue;
          const [nameAndType, defaultVal] = arg.split("=").map((s) => s.trim());
          const [name, typeAnno] = nameAndType.split(":").map((s) => s.trim());

          if (!name || pathParamNames.has(name)) continue;

          let type: "string" | "number" | "boolean" | "object" | "array" = "string";
          if (typeAnno) {
            if (/int|float|number/i.test(typeAnno)) type = "number";
            else if (/bool/i.test(typeAnno)) type = "boolean";
            else if (/list|array/i.test(typeAnno)) type = "array";
            else if (/dict|model|schema/i.test(typeAnno) || /^[A-Z]/.test(typeAnno)) type = "object";
          }

          const isRequired = defaultVal === undefined && !/Optional/i.test(typeAnno ?? "");
          const isBody =
            rawMethod !== "GET" &&
            rawMethod !== "DELETE" &&
            (type === "object" || /Body\(/i.test(defaultVal ?? "") || /payload|body|data|item|order|cart/i.test(name));

          params.push({
            name,
            type,
            required: isRequired,
            description: `Parameter "${name}".`,
            in: isBody ? "body" : "query",
          });
        }

        const fallbackName = funcName.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase();
        const derivedName = buildToolName(routePath, rawMethod, doc);
        const name = derivedName || fallbackName;
        const description = (doc || firstSentence(doc) || `${rawMethod} ${routePath}`)
          .replace(/\s+/g, " ")
          .trim();

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
