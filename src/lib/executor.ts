import type { GeneratedTool } from "./types";
import type { PolicyGate } from "./security/monitor";

/**
 * Builds the real HTTP request for a tool call from the manifest alone. There
 * is no hand-written implementation per tool: the endpoint and parameter
 * locations discovered by the analyzer are enough to execute any of them.
 */
export function buildRequest(
  tool: GeneratedTool,
  input: Record<string, unknown>,
  /** Prefix for the target: a mock target, or a local app the operator runs. */
  baseUrl = "",
) {
  let path = tool.endpoint.path;
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    const location = tool.paramLocations[name] ?? "query";

    if (location === "path") {
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    } else if (location === "body") {
      body[name] = value;
    } else {
      query.set(name, String(value));
    }
  }

  const prefix = baseUrl.replace(/\/$/, "");
  const target = prefix ? `${prefix}${path}` : path;
  const url = query.toString() ? `${target}?${query.toString()}` : target;
  const hasBody = Object.keys(body).length > 0;

  return {
    method: tool.endpoint.method,
    url,
    body: hasBody ? body : undefined,
  };
}

export interface ExecutionResult {
  ok: boolean;
  blocked: boolean;
  data: unknown;
  message: string;
}

/** Wraps a generated tool into an execute() suitable for registerTool. */
export function makeExecutor(tool: GeneratedTool, gate: PolicyGate, baseUrl = "") {
  return async function execute(
    input: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const { method, url, body } = buildRequest(tool, input, baseUrl);
    const result = await gate.send(tool, method, url, body);

    if (!result.allowed) {
      return {
        ok: false,
        blocked: true,
        data: null,
        message:
          `Blocked by the WebMCP Forge policy gate: ${tool.name} tried to reach ` +
          `${url}, which is neither this origin nor the declared target.`,
      };
    }

    return {
      ok: (result.status ?? 500) < 400,
      blocked: false,
      data: result.body,
      message: `${method} ${url} -> ${result.status}`,
    };
  };
}
