import type { FileTree, RouteAdapter, ToolSource } from "../types";
import { nextAppRouterAdapter } from "./nextAppRouter";
import { nextPagesRouterAdapter } from "./nextPagesRouter";
import { expressAdapter } from "./express";
import { fastapiAdapter } from "./fastapi";
import { flaskAdapter } from "./flask";
import { findRepoOpenApiFile, parseSpecContent } from "./openapiSpec";

export const FRAMEWORK_ADAPTERS: RouteAdapter[] = [
  nextAppRouterAdapter,
  nextPagesRouterAdapter,
  expressAdapter,
  fastapiAdapter,
  flaskAdapter,
];

export interface ExtractionResult {
  sources: ToolSource[];
  matchedAdapters: string[];
  usedSpec: boolean;
  specPath?: string;
}

/**
 * Extracts ToolSources from a file tree:
 * 1. Checks if an OpenAPI/Swagger spec exists in the repo. If found and non-empty, prefers it.
 * 2. Runs all framework adapters, unions the extracted ToolSources, and reports matched adapters.
 */
export function extractToolSourcesFromFiles(files: FileTree): ExtractionResult {
  // 1. Check for OpenAPI/Swagger spec first
  const specFile = findRepoOpenApiFile(files);
  if (specFile) {
    const specSources = parseSpecContent(specFile.content, specFile.path);
    if (specSources.length > 0) {
      return {
        sources: specSources,
        matchedAdapters: ["OpenAPI / Swagger Spec"],
        usedSpec: true,
        specPath: specFile.path,
      };
    }
  }

  // 2. Run all framework adapters and union the results
  const allSources: ToolSource[] = [];
  const matchedAdapters: string[] = [];
  const seenIds = new Set<string>();

  for (const adapter of FRAMEWORK_ADAPTERS) {
    if (adapter.detect(files)) {
      matchedAdapters.push(adapter.name);
      const extracted = adapter.extract(files);
      for (const source of extracted) {
        if (!seenIds.has(source.id)) {
          seenIds.add(source.id);
          allSources.push(source);
        }
      }
    }
  }

  return {
    sources: allSources,
    matchedAdapters,
    usedSpec: false,
  };
}

export {
  nextAppRouterAdapter,
  nextPagesRouterAdapter,
  expressAdapter,
  fastapiAdapter,
  flaskAdapter,
};
