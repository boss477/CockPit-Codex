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
}

export interface LogEntry {
  at: number;
  /** "agent" entries are actions taken by an AI agent, not the human. */
  actor: "human" | "agent" | "system";
  message: string;
}
