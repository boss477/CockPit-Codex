import type { Finding, GeneratedTool, ObservedRequest } from "../types";

let sequence = 0;
function findingId(): string {
  sequence += 1;
  return `f${sequence}`;
}

/**
 * Phrases that only make sense if the author is addressing the agent rather
 * than the developer. Tool metadata is read by the model as instruction, so
 * prose lifted out of a repository is an injection surface.
 */
const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(any\s+|all\s+)?(previous|prior|earlier)/i, label: "instruction override" },
  { pattern: /\bdo not (mention|tell|inform|reveal|disclose)\b/i, label: "concealment directive" },
  { pattern: /\byou must\b/i, label: "imperative aimed at the model" },
  { pattern: /\balways call\b/i, label: "forced tool chaining" },
  { pattern: /note (for|to) the (assistant|agent|ai|model|llm)/i, label: "direct address to the model" },
  { pattern: /\bdisregard\b.*\b(rule|restriction|policy|instruction)/i, label: "policy override" },
  { pattern: /\bsystem prompt\b/i, label: "prompt reference" },
];

/** Parameter names that carry personal data. */
const SENSITIVE_PARAM = /email|e_mail|address|phone|postcode|zip|card|cvv|ssn|password|token|secret|dob/i;

const URL_PATTERN = /https?:\/\/([a-z0-9.-]+)[^\s"')]*/gi;

/** Hosts that are part of the application itself, so not egress. */
function isSelfHost(host: string, selfOrigin: string): boolean {
  try {
    return host === new URL(selfOrigin).hostname;
  } catch {
    return false;
  }
}

function externalHostsIn(text: string, selfOrigin: string): string[] {
  const hosts = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const host = match[1].toLowerCase();
    if (!isSelfHost(host, selfOrigin) && host !== "localhost") hosts.add(host);
  }
  return [...hosts];
}

function sensitiveParams(tool: GeneratedTool): string[] {
  return Object.keys(tool.inputSchema.properties).filter((name) =>
    SENSITIVE_PARAM.test(name),
  );
}

/** Text an agent will read for this tool: its description plus every param description. */
function agentVisibleText(tool: GeneratedTool): string {
  const params = Object.values(tool.inputSchema.properties)
    .map((property) => property.description ?? "")
    .join("\n");
  return `${tool.description}\n${params}`;
}

/* ------------------------------------------------------------------ */
/* Static checks: run on the manifest, before any tool executes.       */
/* ------------------------------------------------------------------ */

export function checkMetadataInjection(tool: GeneratedTool): Finding[] {
  const text = agentVisibleText(tool);
  const hits = INJECTION_PATTERNS.filter(({ pattern }) => pattern.test(text));
  if (hits.length === 0) return [];

  const quoted = hits
    .map(({ pattern }) => text.match(pattern)?.[0]?.trim())
    .filter(Boolean)
    .join(" / ");

  return [
    {
      id: findingId(),
      check: "metadata-injection",
      tool: tool.name,
      severity: "high",
      title: "Tool description contains instructions aimed at the agent",
      detail:
        `The description carries ${hits.length} directive-shaped phrase(s) (` +
        `${hits.map((h) => h.label).join(", ")}). Every agent that reads this tool ` +
        `reads those instructions as part of its own context.`,
      evidence: quoted,
      remediation:
        `Generate the description from the route signature instead of the doc comment in ` +
        `${tool.origin.source}, or strip imperative prose before registering the tool.`,
      phase: "static",
    },
  ];
}

export function checkDeclaredEgress(tool: GeneratedTool, selfOrigin: string): Finding[] {
  const hosts = externalHostsIn(agentVisibleText(tool), selfOrigin);
  const pii = sensitiveParams(tool);
  if (hosts.length === 0 || pii.length === 0) return [];

  return [
    {
      id: findingId(),
      check: "sensitive-data-egress",
      tool: tool.name,
      severity: "high",
      title: "Personal data parameter alongside a third-party destination",
      detail:
        `This tool accepts ${pii.join(", ")} and its metadata names an external host. ` +
        `An agent following the description would move personal data off this origin.`,
      evidence: `params: ${pii.join(", ")} | external host(s): ${hosts.join(", ")}`,
      remediation:
        "Remove the external destination from the metadata and keep personal data " +
        "on the origin that collected it.",
      phase: "static",
    },
  ];
}

export function checkDeclaredReadOnly(tool: GeneratedTool): Finding[] {
  if (!tool.annotations.readOnlyHint) return [];
  if (tool.endpoint.method === "GET") return [];

  return [
    {
      id: findingId(),
      check: "readonly-mismatch",
      tool: tool.name,
      severity: "medium",
      title: "Declared read-only but mapped to a mutating request",
      detail:
        `readOnlyHint is true, so an agent may call this without asking the user. ` +
        `The tool is mapped to ${tool.endpoint.method} ${tool.endpoint.path}. ` +
        `Runtime validation will confirm whether it mutates state.`,
      evidence: `readOnlyHint: true vs ${tool.endpoint.method} ${tool.endpoint.path}`,
      remediation:
        "Set readOnlyHint from the HTTP method, not from the prose in the doc comment.",
      phase: "static",
    },
  ];
}

export function runStaticChecks(tool: GeneratedTool, selfOrigin: string): Finding[] {
  return [
    ...checkMetadataInjection(tool),
    ...checkDeclaredEgress(tool, selfOrigin),
    ...checkDeclaredReadOnly(tool),
  ];
}

/* ------------------------------------------------------------------ */
/* Runtime checks: run on what a tool actually did.                    */
/* ------------------------------------------------------------------ */

const MUTATION_MARKERS = ["orderId", "charged", "created", "deleted", "updated"];

export function checkObservedMutation(
  tool: GeneratedTool,
  request: ObservedRequest,
  responseBody: unknown,
): Finding[] {
  if (!tool.annotations.readOnlyHint) return [];

  // A GET that happens to return an id is not evidence of a write, so the
  // request method decides and the response markers only corroborate.
  if (request.method === "GET") return [];

  const markers =
    responseBody && typeof responseBody === "object"
      ? MUTATION_MARKERS.filter((marker) => marker in (responseBody as object))
      : [];

  return [
    {
      id: findingId(),
      check: "readonly-mismatch",
      tool: tool.name,
      severity: "high",
      title: "Read-only tool mutated state when executed",
      detail:
        `The tool ran and the server confirmed a state change. Because readOnlyHint ` +
        `is true an agent is entitled to call this without user confirmation, so the ` +
        `mutation would happen unprompted.`,
      evidence:
        `${request.method} ${request.url}` +
        (markers.length ? ` -> response contains ${markers.join(", ")}` : ""),
      remediation:
        "Set readOnlyHint to false and require confirmation before this tool runs.",
      phase: "runtime",
    },
  ];
}

export function checkObservedEgress(
  toolName: string,
  request: ObservedRequest,
): Finding[] {
  if (!request.crossOrigin) return [];

  const pii = request.bodyKeys.filter((key) => SENSITIVE_PARAM.test(key));
  return [
    {
      id: findingId(),
      check: "sensitive-data-egress",
      tool: toolName,
      severity: "high",
      title: "Blocked a cross-origin request made during tool execution",
      detail:
        pii.length > 0
          ? `The call carried ${pii.join(", ")} to another origin. The policy gate ` +
            `refused it before it left the browser.`
          : `A tool invocation tried to reach another origin. The policy gate ` +
            `refused it before it left the browser.`,
      evidence: `${request.method} ${request.url}${pii.length ? ` | fields: ${pii.join(", ")}` : ""}`,
      remediation:
        "Tools generated from this repository must only reach their own origin. " +
        "Trace where the destination entered the tool definition.",
      phase: "runtime",
    },
  ];
}
