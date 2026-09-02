/** Core domain model for the Forge pipeline: discover -> generate -> scan -> validate -> ship. */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A capability discovered in the analyzed repository, before it becomes a tool. */
export interface Capability {
  id: string;
  /** Source file the capability was discovered in. */
  source: string;
  method: HttpMethod;
  path: string;
  summary: string;
  /** Doc comment / surrounding prose lifted from the source. Untrusted. */
  doc?: string;
  params: CapabilityParam[];
}

export interface CapabilityParam {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
  /** Where the param travels in the generated request. */
  location: "query" | "body" | "path";
}

/** JSON Schema subset we generate. */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

/**
 * A generated WebMCP tool. This is the artifact the whole product produces:
 * it is both what gets registered via document.modelContext.registerTool()
 * and what the security engine reasons about.
 */
export interface GeneratedTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: { readOnlyHint: boolean };
  /** How the generic executor turns tool params into a real request. */
  endpoint: { method: HttpMethod; path: string };
  paramLocations: Record<string, "query" | "body" | "path">;
  /** Provenance: which capability produced this tool. */
  origin: { source: string; capabilityId: string };
}

export interface ParamSpec {
  name: string;
  in: "query" | "body" | "path" | "header";
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
}

/** Canonical descriptor produced by all input paths (repo, openapi, live). */
export interface ToolSource {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  baseUrl: string | null;
  params: ParamSpec[];
  description: string;
  executable: boolean;
  origin: "repo" | "openapi" | "live-webmcp";
  source?: string;
  doc?: string;
}

export type InputKind = "github" | "openapi" | "live";

export type FileTree = Array<{ path: string; content: string }>;

export interface RouteAdapter {
  name: string;
  detect(files: FileTree): boolean;
  extract(files: FileTree): ToolSource[];
}

export interface ToolManifest {
  repoUrl: string;
  repoLabel: string;
  generatedAt: string;
  /** "llm" when Claude produced the manifest, "static" for the bundled analyzer. */
  analyzer: "llm" | "static";
  capabilities: Capability[];
  tools: GeneratedTool[];
  matchedAdapters?: string[];
  inputKind?: InputKind;
  sources?: ToolSource[];
  /** Which of the three execution tiers this manifest qualifies for. */
  execution?: ExecutionPlan;
  /** Present when the manifest can be executed against a generated mock target. */
  mockSpec?: MockSpec;
}

/**
 * The three tiers. SCAN always runs; only the tier decides whether VALIDATE
 * may execute anything, and against what.
 *
 * - "local-app"   the analyzed app is running somewhere we own (this origin,
 *                 or a localhost base URL the operator pointed us at)
 * - "mock-target" no running app, but a contract complete enough to generate
 *                 one from: either the built-in mock or an external Prism
 * - "scan-only"   a third-party live site. Nothing is executed against it.
 */
export type ExecutionTier = "local-app" | "mock-target" | "scan-only";

export interface MockTargetInfo {
  /** "builtin" = this app serves the mock at /api/mock/<id>; "prism" = external. */
  provider: "builtin" | "prism";
  baseUrl: string;
  /** Set for an external mock so the UI can print "MOCK TARGET :4010". */
  port: number | null;
  operations: number;
  label: string;
}

export interface ExecutionPlan {
  tier: ExecutionTier;
  /** Whether VALIDATE is allowed to make real calls. */
  executable: boolean;
  /** Prefix every generated request with this. "" means this origin. */
  baseUrl: string;
  /** Shown verbatim in the UI. Says why the tier is what it is. */
  reason: string;
  /** Origins the PolicyGate should treat as the declared target, not as egress. */
  allowedOrigins: string[];
  mock?: MockTargetInfo;
}

/** One operation the mock target will answer. Derived from the same contract. */
export interface MockOperation {
  name: string;
  method: HttpMethod;
  /** Path template, e.g. /api/products/{id}. */
  path: string;
  params: ParamSpec[];
  description: string;
  /** Response body served for this operation, from spec examples or synthesized. */
  example?: unknown;
}

/** A mock target generated from a contract. Never contains third-party hosts. */
export interface MockSpec {
  id: string;
  label: string;
  operations: MockOperation[];
}

export type Severity = "high" | "medium" | "low";
export type CheckId =
  | "metadata-injection"
  | "readonly-mismatch"
  | "sensitive-data-egress";

export interface Finding {
  id: string;
  check: CheckId;
  tool: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The exact text or observed request that triggered the finding. */
  evidence: string;
  /** What a developer should change. */
  remediation: string;
  /** Static rules fire before execution; runtime rules need an observed call. */
  phase: "static" | "runtime";
}

export type Verdict = "verified" | "blocked" | "unscanned";

export interface ToolVerdict {
  tool: string;
  verdict: Verdict;
  findings: Finding[];
}

/** One observed network call made while a tool executed. */
export interface ObservedRequest {
  tool: string;
  method: string;
  url: string;
  crossOrigin: boolean;
  /** True when the destination is the declared target (mock or local app). */
  declaredTarget: boolean;
  /** What the gate did: sent it, or refused it. */
  outcome: "sent" | "blocked";
  bodyKeys: string[];
  at: number;
}

export interface AgentStep {
  index: number;
  tool: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "blocked" | "error";
  summary: string;
  detail?: string;
}

export interface AgentRun {
  task: string;
  steps: AgentStep[];
  status: "running" | "passed" | "failed";
  startedAt: string;
}

export type Stage =
  | "idle"
  | "discovering"
  | "generating"
  | "scanning"
  | "validating"
  | "done";

export interface ResultInfo {
  detectedStack?: string;
  matchedAdapters?: string[];
  noContract?: boolean;
  message?: string;
  suggestedActions?: string[];
  probedPaths?: string[];
  targetUrl?: string;
  execution?: ExecutionPlan;
}

export interface ForgeState {
  stage: Stage;
  manifest: ToolManifest | null;
  verdicts: ToolVerdict[];
  observed: ObservedRequest[];
  agentRun: AgentRun | null;
  log: LogEntry[];
  error: string | null;
  inputKind: InputKind;
  executionBaseUrl: string;
  resultInfo: ResultInfo | null;
  execution: ExecutionPlan | null;
}

export interface LogEntry {
  at: number;
  /** "agent" entries are actions taken by an AI agent, not the human. */
  actor: "human" | "agent" | "system";
  message: string;
}
