import { buildManifest, buildManifestFromSources } from "@/lib/analyzer";
import { resolveInput } from "@/lib/inputRouter";
import { parseSpecContent } from "@/lib/adapters/openapiSpec";
import { auditLiveUrl } from "@/lib/liveAuditor";
import { extractUniversalRepoTools } from "@/lib/universalRepoAnalyzer";
import {
  DEMO_REPO_FILES,
  DEMO_REPO_LABEL,
  DEMO_REPO_URL,
  type RepoFile,
} from "@/lib/fixtures/demoRepo";

const MAX_FILES = 30;
const FETCH_TIMEOUT_MS = 5000;

interface TreeEntry {
  path: string;
  type: string;
}

function parseRepo(url: string): { owner: string; repo: string } | null {
  const match = url
    .trim()
    .match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (match) return { owner: match[1], repo: match[2] };

  const shortMatch = url.trim().match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch && !url.includes("://") && !url.includes(".")) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "webmcp-forge",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function githubError(response: Response, owner: string, repo: string): Error {
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0);
      const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
      return new Error(
        `GitHub's API rate limit is exhausted for this deployment` +
          (minutes ? `; it resets in about ${minutes} minute(s)` : "") +
          `. Set GITHUB_TOKEN to raise the limit. The bundled demo storefront ` +
          `needs no network access — leave the field empty to run the full pipeline now.`,
      );
    }
    return new Error(`GitHub refused the request for ${owner}/${repo} (403).`);
  }
  if (response.status === 404) {
    return new Error(
      `No public repository at ${owner}/${repo}. Private repositories are not supported.`,
    );
  }
  return new Error(`GitHub returned ${response.status} for ${owner}/${repo}.`);
}

function isCandidateFile(path: string): boolean {
  if (/(?:node_modules|\.git|dist|build|venv|\.venv|env|__pycache__|\.next|\.coverage)\//i.test(path)) {
    return false;
  }
  // All source files, configuration files, and documentation
  return /\.(?:[tj]sx?|py|go|rs|rb|php|java|cpp|c|h|cs|json|ya?ml|md|html|toml)$/i.test(path);
}

async function fetchRepoFiles(owner: string, repo: string): Promise<RepoFile[]> {
  const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  if (!meta.ok) throw githubError(meta, owner, repo);
  const { default_branch: branch } = (await meta.json()) as { default_branch: string };

  const tree = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: githubHeaders() },
  );
  if (!tree.ok) throw githubError(tree, owner, repo);
  const { tree: entries, truncated } = (await tree.json()) as {
    tree: TreeEntry[];
    truncated?: boolean;
  };

  if (truncated) {
    console.warn(`[analyze] ${owner}/${repo} tree was truncated by GitHub`);
  }

  const candidateFiles = entries
    .filter((entry) => entry.type === "blob" && isCandidateFile(entry.path))
    .slice(0, MAX_FILES);

  return Promise.all(
    candidateFiles.map(async (entry) => {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
        { headers: githubHeaders() },
      );
      return { path: entry.path, content: raw.ok ? await raw.text() : "" };
    }),
  );
}

function isLocalOrPrivateHost(urlStr: string | null): boolean {
  if (!urlStr) return false;
  if (urlStr.startsWith("/")) return true;
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : `http://${urlStr}`);
    const host = u.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const {
    repoUrl,
    inputKind: requestedKind,
    executionBaseUrl,
  } = (await request.json().catch(() => ({}))) as {
    repoUrl?: string;
    inputKind?: string;
    executionBaseUrl?: string;
  };

  const target = (repoUrl ?? "").trim();

  // The bundled storefront is the demo path and needs no network access.
  if (target === "" || target === DEMO_REPO_URL || /demo-storefront/i.test(target)) {
    const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
    return Response.json({
      manifest: { ...manifest, inputKind: "github" },
      source: "bundled",
      inputKind: "github",
      matchedAdapters: ["Next.js App Router (Bundled Demo)"],
    });
  }

  const kind = (requestedKind as "github" | "openapi" | "live") || resolveInput(target);

  // -------------------------------------------------------------
  // 1. GitHub Repository Mode (Any Repository)
  // -------------------------------------------------------------
  if (kind === "github") {
    const parsed = parseRepo(target);
    if (!parsed) {
      return Response.json(
        { error: "Enter a public GitHub repository URL (e.g. github.com/owner/repo), or leave empty for the demo." },
        { status: 400 },
      );
    }

    try {
      const files = await fetchRepoFiles(parsed.owner, parsed.repo);
      if (files.length === 0) {
        return Response.json(
          {
            error: "Repository appears empty or contains no inspectable source files.",
            inputKind: "github",
          },
          { status: 422 },
        );
      }

      let manifest = buildManifest(
        files,
        target,
        `${parsed.owner}/${parsed.repo}`,
      );

      // If standard framework adapters didn't find routes, run universal repository analyzer
      if (manifest.tools.length === 0) {
        const universal = extractUniversalRepoTools(files, `${parsed.owner}/${parsed.repo}`);
        manifest = buildManifestFromSources(
          universal.tools,
          target,
          `${parsed.owner}/${parsed.repo}`,
          [universal.stackName],
        );
      }

      return Response.json({
        manifest: { ...manifest, inputKind: "github" },
        source: "github",
        inputKind: "github",
        matchedAdapters: manifest.matchedAdapters ?? [],
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "GitHub analysis failed." },
        { status: 502 },
      );
    }
  }

  // -------------------------------------------------------------
  // 2. OpenAPI / Swagger URL Mode
  // -------------------------------------------------------------
  if (kind === "openapi") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const specRes = await fetch(target, {
        signal: controller.signal,
        headers: { accept: "application/json, application/yaml, text/yaml, */*" },
      });
      clearTimeout(timer);

      if (!specRes.ok) {
        return Response.json(
          { error: `Failed to fetch OpenAPI spec from ${target} (HTTP ${specRes.status})` },
          { status: 502 },
        );
      }

      const text = await specRes.text();
      const rawSources = parseSpecContent(text, target);

      if (rawSources.length === 0) {
        return Response.json(
          { error: "Could not parse any paths or operations from the provided OpenAPI/Swagger specification." },
          { status: 422 },
        );
      }

      const effectiveBaseUrl = executionBaseUrl !== undefined ? executionBaseUrl : rawSources[0]?.baseUrl ?? null;
      const isExec = isLocalOrPrivateHost(effectiveBaseUrl);

      const sources = rawSources.map((s) => ({
        ...s,
        baseUrl: effectiveBaseUrl,
        executable: isExec,
        origin: "openapi" as const,
      }));

      const manifest = buildManifestFromSources(
        sources,
        target,
        new URL(target).hostname + " (OpenAPI)",
        ["OpenAPI / Swagger Ingestion"],
      );

      return Response.json({
        manifest: { ...manifest, inputKind: "openapi" },
        source: "openapi",
        inputKind: "openapi",
        matchedAdapters: ["OpenAPI / Swagger Ingestion"],
        executionBaseUrl: effectiveBaseUrl,
        executable: isExec,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to fetch or parse OpenAPI specification." },
        { status: 502 },
      );
    }
  }

  // -------------------------------------------------------------
  // 3. Live URL Mode (Any Website / Web App)
  // -------------------------------------------------------------
  if (kind === "live") {
    try {
      const audit = await auditLiveUrl(target);

      const effectiveBaseUrl = executionBaseUrl || null;
      const isExec = isLocalOrPrivateHost(effectiveBaseUrl);

      const sources = audit.tools.map((t) => ({
        ...t,
        baseUrl: effectiveBaseUrl,
        executable: isExec,
      }));

      const manifest = buildManifestFromSources(
        sources,
        target,
        audit.rawHtmlTitle || new URL(target.startsWith("http") ? target : `https://${target}`).hostname,
        [audit.stackName || "Live Web Capability Analysis"],
      );

      return Response.json({
        manifest: { ...manifest, inputKind: "live" },
        source: "live",
        inputKind: "live",
        matchedAdapters: [audit.stackName || "Live Web Capability Analysis"],
        audit,
        executable: isExec,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Live audit failed." },
        { status: 502 },
      );
    }
  }

  return Response.json({ error: `Unsupported input kind: ${kind}` }, { status: 400 });
}
