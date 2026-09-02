import type { ParamSpec, ToolSource } from "./types";
import { parseSpecContent } from "./adapters/openapiSpec";
import { extractUniversalWebTools } from "./universalWebAnalyzer";

const FETCH_TIMEOUT_MS = 5000;

const PROBE_PATHS = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/api-docs",
  "/.well-known/openapi.json",
];

export interface LiveAuditResult {
  success: boolean;
  kind: "openapi" | "live-webmcp" | "synthesized";
  specPath?: string;
  tools: ToolSource[];
  rawHtmlTitle?: string;
  discoveredLinks: string[];
  probedPaths: string[];
  stackName?: string;
  note?: string;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "WebMCP-Forge-Audit/1.0",
        accept: "application/json, application/yaml, text/yaml, text/html, */*",
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractStaticWebMCPTools(html: string, pageUrl: string): ToolSource[] {
  const tools: ToolSource[] = [];

  const toolPattern =
    /(?:(?:document|navigator)\.modelContext\.registerTool|provideContext)\s*\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g;

  for (const match of html.matchAll(toolPattern)) {
    const block = match[1];
    const nameMatch = block.match(/name\s*:\s*["'`]([^"'`]+)["'`]/);
    const descMatch = block.match(/description\s*:\s*["'`]([^"'`]+)["'`]/);
    const readOnlyMatch = block.match(/readOnlyHint\s*:\s*(true|false)/);

    if (nameMatch) {
      const name = nameMatch[1];
      const description = descMatch ? descMatch[1] : `WebMCP tool "${name}"`;
      const readOnlyHint = readOnlyMatch ? readOnlyMatch[1] === "true" : true;

      const params: ParamSpec[] = [];
      const propsMatch = block.match(/properties\s*:\s*\{([\s\S]*?)\}/);
      if (propsMatch) {
        const propKeys = propsMatch[1].matchAll(/([a-zA-Z0-9_]+)\s*:\s*\{/g);
        for (const pk of propKeys) {
          params.push({
            name: pk[1],
            type: "string",
            in: "query",
            required: false,
            description: `Parameter "${pk[1]}"`,
          });
        }
      }

      tools.push({
        id: `WEBMCP ${name}`,
        name,
        method: readOnlyHint ? "GET" : "POST",
        path: `/${name}`,
        baseUrl: null,
        params,
        description,
        executable: false,
        origin: "live-webmcp",
        source: pageUrl,
        doc: description,
      });
    }
  }

  // Extract JSON-LD actions
  const jsonLdPattern = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      const actions = Array.isArray(parsed.potentialAction)
        ? parsed.potentialAction
        : parsed.potentialAction
          ? [parsed.potentialAction]
          : [];

      for (const action of actions) {
        if (action && typeof action === "object" && action.name) {
          const name = String(action.name).replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase();
          const target = typeof action.target === "string" ? action.target : `/${name}`;
          tools.push({
            id: `ACTION ${name}`,
            name,
            method: "GET",
            path: target,
            baseUrl: null,
            params: [],
            description: typeof action.description === "string" ? action.description : `Schema action ${action.name}`,
            executable: false,
            origin: "live-webmcp",
            source: pageUrl,
          });
        }
      }
    } catch {}
  }

  return tools;
}

export async function auditLiveUrl(
  rawUrl: string,
  firecrawlApiKey?: string,
): Promise<LiveAuditResult> {
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(withProtocol);
  } catch {
    // If not a parseable URL, fallback to synthesized tools for the term
    const universal = await extractUniversalWebTools(rawUrl, "", firecrawlApiKey);
    return {
      success: true,
      kind: "synthesized",
      tools: universal.tools,
      discoveredLinks: [],
      probedPaths: [],
      stackName: universal.stackName,
    };
  }

  const origin = parsedUrl.origin;

  // 1. Fetch main page HTML
  const pageRes = await fetchWithTimeout(parsedUrl.href);
  let html = "";
  let title = "";
  const discoveredLinks: string[] = [];

  if (pageRes && pageRes.ok) {
    html = await pageRes.text();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) title = titleMatch[1].trim();

    // Check for <link rel="openapi" href="...">
    const linkMatches = html.matchAll(
      /<(?:link|a)\s+[^>]*(?:rel=["'](?:openapi|swagger|api-spec)["']|href=["']([^"']+\.(?:json|ya?ml))["'])[^>]*>/gi,
    );
    for (const lm of linkMatches) {
      const hrefMatch = lm[0].match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        try {
          const resolved = new URL(hrefMatch[1], origin).href;
          discoveredLinks.push(resolved);
        } catch {}
      }
    }
  }

  // 2. Try discovered OpenAPI links
  for (const link of discoveredLinks) {
    const specRes = await fetchWithTimeout(link);
    if (specRes && specRes.ok) {
      const text = await specRes.text();
      const tools = parseSpecContent(text, link);
      if (tools.length > 0) {
        const readOnlyTools = tools.map((t) => ({ ...t, executable: false, origin: "openapi" as const }));
        return {
          success: true,
          kind: "openapi",
          specPath: link,
          tools: readOnlyTools,
          rawHtmlTitle: title,
          discoveredLinks,
          probedPaths: [link],
          stackName: "OpenAPI Specification",
        };
      }
    }
  }

  // 3. Probe standard OpenAPI paths in parallel
  const probeUrls = PROBE_PATHS.map((p) => `${origin}${p}`);
  const probePromises = probeUrls.map(async (url) => {
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("html") && !url.endsWith(".json") && !url.endsWith(".yaml")) {
      return null;
    }
    const text = await res.text();
    const tools = parseSpecContent(text, url);
    if (tools.length > 0) {
      return { url, tools };
    }
    return null;
  });

  const probeResults = await Promise.all(probePromises);
  const foundProbe = probeResults.find((r) => r !== null);
  if (foundProbe) {
    const readOnlyTools = foundProbe.tools.map((t) => ({
      ...t,
      executable: false,
      origin: "openapi" as const,
    }));
    return {
      success: true,
      kind: "openapi",
      specPath: foundProbe.url,
      tools: readOnlyTools,
      rawHtmlTitle: title,
      discoveredLinks,
      probedPaths: probeUrls,
      stackName: "Discovered OpenAPI Spec",
    };
  }

  // 4. Statically detect declared WebMCP tools from HTML
  if (html) {
    const webmcpTools = extractStaticWebMCPTools(html, parsedUrl.href);
    if (webmcpTools.length > 0) {
      return {
        success: true,
        kind: "live-webmcp",
        tools: webmcpTools,
        rawHtmlTitle: title,
        discoveredLinks,
        probedPaths: probeUrls,
        stackName: "Native WebMCP Interface",
      };
    }
  }

  // 5. Universal Live Web Extractor (Archetypes + Firecrawl + DOM analysis)
  const universal = await extractUniversalWebTools(
    rawUrl,
    html,
    firecrawlApiKey || process.env.FIRECRAWL_API_KEY,
  );

  return {
    success: true,
    kind: "synthesized",
    tools: universal.tools,
    rawHtmlTitle: universal.title || title || parsedUrl.hostname,
    discoveredLinks,
    probedPaths: probeUrls,
    stackName: universal.stackName,
    note: "Live web capability contract synthesized via domain analysis and web inspector.",
  };
}
