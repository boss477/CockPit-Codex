import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getModelContext,
  isWebMCPAvailable,
  getWebMCPDiagnostics,
  registerTools,
  subscribeWebMCPDiagnostics,
  type WebMCPToolDefinition,
} from "../src/lib/webmcp";

describe("WebMCP Core Client Unit Tests", () => {
  function setDocumentModelContext(mc: unknown) {
    if (typeof globalThis.document === "undefined") {
      Object.defineProperty(globalThis, "document", {
        value: {},
        writable: true,
        configurable: true,
      });
    }
    Object.defineProperty(globalThis.document, "modelContext", {
      value: mc,
      writable: true,
      configurable: true,
    });
  }

  function setNavigatorModelContext(mc: unknown) {
    if (typeof globalThis.navigator === "undefined") {
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });
    }
    Object.defineProperty(globalThis.navigator, "modelContext", {
      value: mc,
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    // Ensure window exists
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: globalThis,
        writable: true,
        configurable: true,
      });
    }
    setDocumentModelContext(undefined);
    setNavigatorModelContext(undefined);
  });

  afterEach(() => {
    setDocumentModelContext(undefined);
    setNavigatorModelContext(undefined);
  });


  test("WebMCP availability detection: returns false when modelContext is missing", () => {
    setDocumentModelContext(undefined);
    setNavigatorModelContext(undefined);

    assert.equal(isWebMCPAvailable(), false);
    assert.equal(getModelContext(), null);

    const diag = getWebMCPDiagnostics();
    assert.equal(diag.apiAvailable, false);
    assert.equal(diag.hasDocumentModelContext, false);
    assert.equal(diag.hasNavigatorModelContext, false);
    assert.equal(diag.hasRegisterTool, false);
  });

  test("WebMCP availability detection: detects document.modelContext when present", () => {
    const mockRegister = () => {};
    setDocumentModelContext({
      registerTool: mockRegister,
    });

    assert.equal(isWebMCPAvailable(), true);
    const mc = getModelContext();
    assert.ok(mc);
    assert.equal(mc?.registerTool, mockRegister);

    const diag = getWebMCPDiagnostics();
    assert.equal(diag.apiAvailable, true);
    assert.equal(diag.hasDocumentModelContext, true);
    assert.equal(diag.hasRegisterTool, true);
  });

  test("WebMCP availability detection: falls back to navigator.modelContext if document is missing it", () => {
    const mockRegister = () => {};
    setDocumentModelContext(undefined);
    setNavigatorModelContext({
      registerTool: mockRegister,
    });

    assert.equal(isWebMCPAvailable(), true);
    const mc = getModelContext();
    assert.ok(mc);
    assert.equal(mc?.registerTool, mockRegister);

    const diag = getWebMCPDiagnostics();
    assert.equal(diag.apiAvailable, true);
    assert.equal(diag.hasDocumentModelContext, false);
    assert.equal(diag.hasNavigatorModelContext, true);
  });

  test("WebMCP registration: registers tools with AbortSignal and unregisters on disposal", () => {
    const registered: { tool: WebMCPToolDefinition; signal?: AbortSignal }[] = [];
    const unregistered: string[] = [];

    setDocumentModelContext({
      registerTool: (tool: WebMCPToolDefinition, options?: { signal?: AbortSignal }) => {
        registered.push({ tool, signal: options?.signal });
      },
      unregisterTool: (name: string) => {
        unregistered.push(name);
      },
    });

    const tool: WebMCPToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    };

    const unregister = registerTools([tool]);

    assert.equal(registered.length, 1);
    assert.equal(registered[0].tool.name, "test_tool");
    assert.ok(registered[0].signal instanceof AbortSignal);
    assert.equal(registered[0].signal.aborted, false);

    const diag = getWebMCPDiagnostics();
    assert.ok(diag.registeredTools.includes("test_tool"));

    // Call disposer
    unregister();

    assert.equal(registered[0].signal.aborted, true);
    assert.ok(unregistered.includes("test_tool"));

    const diagAfter = getWebMCPDiagnostics();
    assert.equal(diagAfter.registeredTools.includes("test_tool"), false);
  });

  test("WebMCP duplicate registration: handles duplicate errors gracefully without throwing", () => {
    let callCount = 0;
    setDocumentModelContext({
      registerTool: (tool: WebMCPToolDefinition) => {
        callCount++;
        if (callCount > 1) {
          throw new Error("InvalidStateError: Tool test_duplicate is already registered");
        }
      },
    });

    const tool: WebMCPToolDefinition = {
      name: "test_duplicate",
      description: "A duplicate tool",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    };

    // First registration succeeds
    const unregister1 = registerTools([tool]);
    // Second registration throws in underlying API, but registerTools catches it safely
    assert.doesNotThrow(() => {
      registerTools([tool]);
    });

    unregister1();
  });

  test("WebMCP missing API: registerTools does not crash when WebMCP is absent", () => {
    setDocumentModelContext(undefined);
    setNavigatorModelContext(undefined);

    const tool: WebMCPToolDefinition = {
      name: "no_api_tool",
      description: "Should not crash",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    };

    assert.doesNotThrow(() => {
      const cleanup = registerTools([tool]);
      cleanup();
    });
  });

  test("WebMCP diagnostics subscription: notifies listeners on registration and disposal", () => {
    setDocumentModelContext({
      registerTool: () => {},
    });

    let notifications = 0;
    const unsubscribe = subscribeWebMCPDiagnostics(() => {
      notifications++;
    });

    const tool: WebMCPToolDefinition = {
      name: "subscribed_tool",
      description: "Testing subscriptions",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    };

    const cleanup = registerTools([tool]);
    assert.equal(notifications, 1);

    cleanup();
    assert.equal(notifications, 2);

    unsubscribe();
  });
});

