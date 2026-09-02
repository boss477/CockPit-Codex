import type {
  Capability,
  GeneratedTool,
  HttpMethod,
  ToolInputSchema,
  ToolManifest,
  ToolSource,
} from "./types";
import type { RepoFile } from "./fixtures/demoRepo";
import {
  buildToolName,
  documentedVerb,
  firstSentence,
  METHODS,
  READ_VERBS,
} from "./adapters/helpers";
import { extractToolSourcesFromFiles } from "./adapters";

export function toolSourceToCapability(source: ToolSource): Capability {
  return {
    id: source.id,
    source: source.source ?? source.origin,
    method: source.method,
    path: source.path,
    summary: firstSentence(source.description) || source.id,
    doc: source.doc || source.description,
    params: source.params.map((p) => ({
      name: p.name,
      type: p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : "string",
      required: p.required,
      description: p.description,
      location: p.in === "header" ? "query" : p.in,
    })),
  };
}

export function toolSourceToGeneratedTool(source: ToolSource): GeneratedTool {
  const properties: ToolInputSchema["properties"] = {};
  const required: string[] = [];
  const paramLocations: Record<string, "query" | "body" | "path"> = {};

  for (const param of source.params) {
    properties[param.name] = { type: param.type, description: param.description };
    if (param.required) required.push(param.name);
    paramLocations[param.name] = param.in === "header" ? "query" : param.in;
  }

  const verb = documentedVerb(source.doc || source.description, source.method);
  const readOnlyHint = READ_VERBS.has(verb);

  return {
    name: source.name,
    description: source.description.replace(/\s+/g, " ").trim(),
    inputSchema: { type: "object", properties, required },
    annotations: { readOnlyHint },
    endpoint: { method: source.method, path: source.path },
    paramLocations,
    origin: { source: source.source ?? source.origin, capabilityId: source.id },
  };
}

export function discoverCapabilities(files: RepoFile[]): Capability[] {
  const { sources } = extractToolSourcesFromFiles(files);
  return sources.map(toolSourceToCapability);
}

export function generateTool(capability: Capability): GeneratedTool {
  const paramLocations: Record<string, "query" | "body" | "path"> = {};
  const properties: ToolInputSchema["properties"] = {};
  const required: string[] = [];

  for (const param of capability.params) {
    properties[param.name] = { type: param.type, description: param.description };
    if (param.required) required.push(param.name);
    paramLocations[param.name] = param.location;
  }

  const verb = documentedVerb(capability.doc || capability.summary, capability.method);
  const name = buildToolName(capability.path, capability.method, capability.doc || capability.summary);

  return {
    name,
    description: (capability.doc || capability.summary).replace(/\s+/g, " ").trim(),
    inputSchema: { type: "object", properties, required },
    annotations: { readOnlyHint: READ_VERBS.has(verb) },
    endpoint: { method: capability.method, path: capability.path },
    paramLocations,
    origin: { source: capability.source, capabilityId: capability.id },
  };
}

export function buildManifest(
  files: RepoFile[],
  repoUrl: string,
  repoLabel: string,
  analyzer: "llm" | "static" = "static",
): ToolManifest {
  const { sources, matchedAdapters } = extractToolSourcesFromFiles(files);
  return buildManifestFromSources(sources, repoUrl, repoLabel, matchedAdapters, analyzer);
}

export function buildManifestFromSources(
  sources: ToolSource[],
  repoUrl: string,
  repoLabel: string,
  matchedAdapters: string[] = [],
  analyzer: "llm" | "static" = "static",
): ToolManifest {
  const capabilities = sources.map(toolSourceToCapability);
  const tools = sources.map(toolSourceToGeneratedTool);

  return {
    repoUrl,
    repoLabel,
    generatedAt: new Date().toISOString(),
    analyzer,
    capabilities,
    tools,
    matchedAdapters,
    sources,
  };
}

export { METHODS, READ_VERBS };
