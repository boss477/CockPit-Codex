import type { InputKind } from "./types";

/**
 * Resolves the input kind from a user-supplied string:
 * - host is github.com and path has owner/repo -> 'github'
 * - shorthand owner/repo (e.g. "vercel/next.js") -> 'github'
 * - URL ends in .json/.yaml/.yml or contains 'openapi'/'swagger' -> 'openapi'
 * - otherwise a valid http/https URL -> 'live'
 */
export function resolveInput(raw: string): InputKind {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "github";

  // Check shorthand owner/repo pattern without protocol (e.g. "owner/repo" or "bilawalsidhu/gods-eye-view")
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed) && !trimmed.includes("://")) {
    return "github";
  }

  // Check explicit GitHub URLs (including git@ or https://github.com/...)
  if (/github\.com[/:]([^/]+)\/([^/#?]+)/i.test(trimmed)) {
    const isSpecPath = /\.(json|yaml|yml)(\?.*)?$/i.test(trimmed) || /openapi|swagger/i.test(trimmed);
    if (isSpecPath && (trimmed.includes("/raw/") || trimmed.includes("/blob/"))) {
      return "openapi";
    }
    return "github";
  }

  // Check OpenAPI / Swagger keywords or extensions in URL
  const isSpecPath = /\.(json|yaml|yml)(\?.*)?$/i.test(trimmed) || /openapi|swagger/i.test(trimmed);
  if (isSpecPath) {
    return "openapi";
  }

  // Check if valid URL (including localhost, IP addresses, domains)
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.hostname) {
      return "live";
    }
  } catch {
    // ignore
  }

  return "github";
}
