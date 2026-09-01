/**
 * Thin, defensive wrapper over the WebMCP browser API.
 *
 * Implements the W3C / Chromium WebMCP imperative API specification:
 * document.modelContext.registerTool(definition, { signal })
 *
 * The getter moved from Navigator to Document in modern specs, so document
 * is checked first. The API requires a SecureContext (HTTPS or localhost).
 */

export interface WebMCPToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: WebMCPToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(
    tool: WebMCPToolDefinition,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
  unregisterTool?(name: string): void | Promise<void>;
  getTools?(): WebMCPToolDefinition[] | Promise<WebMCPToolDefinition[]>;
  listTools?(): WebMCPToolDefinition[] | Promise<WebMCPToolDefinition[]>;
}

export interface WebMCPDiagnostics {
  apiAvailable: boolean;
  hasDocumentModelContext: boolean;
  hasNavigatorModelContext: boolean;
  hasRegisterTool: boolean;
  hasUnregisterTool: boolean;
  registeredTools: string[];
}

const activeRegisteredTools = new Set<string>();
const diagnosticsListeners = new Set<() => void>();

function notifyDiagnosticsChanged() {
  for (const listener of diagnosticsListeners) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeWebMCPDiagnostics(listener: () => void): () => void {
  diagnosticsListeners.add(listener);
  return () => {
    diagnosticsListeners.delete(listener);
  };
}

/**
 * Safely resolves the modelContext object from document (preferred) or navigator (fallback).
 */
export function getModelContext(): ModelContextLike | null {
  if (typeof window === "undefined") return null;

  // Modern standard: document.modelContext
  if (
    typeof document !== "undefined" &&
    "modelContext" in document &&
    (document as unknown as { modelContext?: ModelContextLike }).modelContext
  ) {
    const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
    if (typeof mc?.registerTool === "function") {
      return mc;
    }
  }

  // Legacy fallback: navigator.modelContext
  if (
    typeof navigator !== "undefined" &&
    "modelContext" in navigator &&
    (navigator as unknown as { modelContext?: ModelContextLike }).modelContext
  ) {
    const mc = (navigator as unknown as { modelContext: ModelContextLike }).modelContext;
    if (typeof mc?.registerTool === "function") {
      return mc;
    }
  }

  return null;
}

export function isWebMCPAvailable(): boolean {
  return getModelContext() !== null;
}

export function getWebMCPDiagnostics(): WebMCPDiagnostics {
  if (typeof window === "undefined") {
    return {
      apiAvailable: false,
      hasDocumentModelContext: false,
      hasNavigatorModelContext: false,
      hasRegisterTool: false,
      hasUnregisterTool: false,
      registeredTools: [],
    };
  }

  const docMc =
    typeof document !== "undefined" && "modelContext" in document
      ? (document as unknown as { modelContext?: ModelContextLike }).modelContext
      : null;
  const navMc =
    typeof navigator !== "undefined" && "modelContext" in navigator
      ? (navigator as unknown as { modelContext?: ModelContextLike }).modelContext
      : null;

  const activeMc = getModelContext();

  return {
    apiAvailable: activeMc !== null,
    hasDocumentModelContext: Boolean(docMc && typeof docMc.registerTool === "function"),
    hasNavigatorModelContext: Boolean(navMc && typeof navMc.registerTool === "function"),
    hasRegisterTool: Boolean(activeMc && typeof activeMc.registerTool === "function"),
    hasUnregisterTool: Boolean(activeMc && typeof activeMc.unregisterTool === "function"),
    registeredTools: Array.from(activeRegisteredTools),
  };
}

/**
 * Registers a set of tools with the browser's WebMCP modelContext.
 * Uses AbortController for clean lifecycle management, with fallback
 * to unregisterTool where supported.
 *
 * Returns a disposal function to unregister all registered tools.
 */
export function registerTools(tools: WebMCPToolDefinition[]): () => void {
  const mc = getModelContext();
  if (!mc) {
    return () => {};
  }

  const controllers = new Map<string, AbortController>();

  for (const tool of tools) {
    // If unregisterTool is supported, attempt to unregister old instance first
    // to protect against React StrictMode double invocation or hot reload
    if (typeof mc.unregisterTool === "function") {
      try {
        mc.unregisterTool(tool.name);
      } catch {
        // Not registered yet. Expected.
      }
    }

    const controller = new AbortController();
    controllers.set(tool.name, controller);

    try {
      // Call registerTool with tool definition and optional abort signal
      mc.registerTool(tool, { signal: controller.signal });
      activeRegisteredTools.add(tool.name);
    } catch (err) {
      console.warn(`[webmcp] failed to register tool ${tool.name}`, err);
    }
  }

  notifyDiagnosticsChanged();

  return () => {
    for (const [name, controller] of controllers.entries()) {
      try {
        controller.abort();
      } catch {
        // Abort completed
      }

      if (typeof mc.unregisterTool === "function") {
        try {
          mc.unregisterTool(name);
        } catch {
          // Already gone
        }
      }

      activeRegisteredTools.delete(name);
    }
    notifyDiagnosticsChanged();
  };
}

