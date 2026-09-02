import type { HttpMethod } from "../types";

export const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const ACTION_SEGMENTS = new Set(["checkout", "login", "logout", "signup", "subscribe"]);

export const VERB_ALIASES: Record<string, string> = {
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
  deletes: "delete",
  removes: "remove",
};

export const READ_VERBS = new Set(["get", "list", "search", "track", "find", "show", "read", "fetch"]);

export const SINGULAR_ACTION_VERBS = new Set([
  "create",
  "add",
  "place",
  "get",
  "fetch",
  "delete",
  "remove",
  "update",
  "track",
]);

export function singular(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function snake(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, " ").trim();
  const stop = flat.indexOf(". ");
  return stop === -1 ? flat : flat.slice(0, stop + 1);
}

export function docCommentBefore(source: string, exportIndex: number): string {
  const preceding = source.slice(0, exportIndex);
  const open = preceding.lastIndexOf("/**");
  if (open === -1) return "";
  const close = preceding.indexOf("*/", open);
  if (close === -1) return "";
  if (preceding.slice(close + 2).trim().length > 0) return "";
  return preceding
    .slice(open + 3, close)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

export function pythonDocstringAfter(source: string, defIndex: number): string {
  const afterDef = source.slice(defIndex);
  const headerMatch = afterDef.match(/(?:async\s+)?def\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*(?:->[^:]+)?:/);
  if (!headerMatch) return "";
  const body = afterDef.slice(headerMatch[0].length);
  const match = body.match(/^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
  if (!match) return "";
  return (match[1] || match[2] || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function documentedVerb(doc: string, method: string): string {
  const first = (doc ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const stripped = first.replace(/[^a-z]/g, "");
  const verb = VERB_ALIASES[stripped] ?? stripped;
  if (verb) return verb;
  return method === "GET" ? "get" : "post";
}

export function buildToolName(routePath: string, method: string, doc: string): string {
  const segments = routePath
    .split("/")
    .filter((segment) => segment && segment !== "api" && !segment.startsWith("{"));
  const last = segments[segments.length - 1] ?? "resource";

  if (ACTION_SEGMENTS.has(last)) return snake(last);

  const verb = documentedVerb(doc, method);

  // e.g. /api/orders/track -- the last segment is itself the verb.
  if (snake(last) === verb) {
    const owner = segments[segments.length - 2] ?? last;
    return `${verb}_${singular(snake(owner))}`;
  }

  const hasPathParam = routePath.includes("{");
  const noun = hasPathParam || SINGULAR_ACTION_VERBS.has(verb)
    ? singular(snake(last))
    : snake(last);

  if (verb === "add") return `add_to_${singular(noun)}`;
  return `${verb}_${noun}`;
}
