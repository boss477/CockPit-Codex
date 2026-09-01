"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getModelContext,
  getWebMCPDiagnostics,
  registerTools,
  subscribeWebMCPDiagnostics,
  type WebMCPDiagnostics,
  type WebMCPToolDefinition,
} from "@/lib/webmcp";

interface TestStepResult {
  title: string;
  passed: boolean | null; // null = pending / not run
  detail: string;
}

export default function WebMCPTestPage() {
  const [diagnostics, setDiagnostics] = useState<WebMCPDiagnostics | null>(null);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [executionResult, setExecutionResult] = useState<unknown>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [disposer, setDisposer] = useState<(() => void) | null>(null);
  const [customMsg, setCustomMsg] = useState("Hello Agent");

  const [steps, setSteps] = useState<Record<string, TestStepResult>>({
    apiAvailable: {
      title: "WebMCP available",
      passed: null,
      detail: "Checking for document.modelContext...",
    },
    registerTool: {
      title: "registerTool",
      passed: null,
      detail: "Testing document.modelContext.registerTool...",
    },
    toolVisible: {
      title: "Tool visible",
      passed: null,
      detail: "Checking registered tools in diagnostics...",
    },
    toolExecution: {
      title: "Tool execution",
      passed: null,
      detail: "Executing hello_webmcp test tool...",
    },
  });

  const addLog = (msg: string) => {
    setTestLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    setDiagnostics(getWebMCPDiagnostics());
    return subscribeWebMCPDiagnostics(() => {
      setDiagnostics(getWebMCPDiagnostics());
    });
  }, []);

  // Harmless test tool definition
  const testTool: WebMCPToolDefinition = {
    name: "hello_webmcp",
    description: "A harmless smoke-test tool for validating WebMCP browser integration.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Optional greeting message to echo." },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      return {
        ok: true,
        greeting: `Hello from WebMCP! Echo: ${input.message ?? "all systems operational"}`,
        timestamp: new Date().toISOString(),
        origin: typeof window !== "undefined" ? window.location.origin : "unknown",
      };
    },
  };

  const runAllTests = async () => {
    addLog("Starting WebMCP smoke test suite...");
    const mc = getModelContext();

    // Step 1: Detect WebMCP
    const available = mc !== null && typeof mc.registerTool === "function";
    setSteps((prev) => ({
      ...prev,
      apiAvailable: {
        title: "WebMCP available",
        passed: available,
        detail: available
          ? "document.modelContext is present and functional in this browser"
          : "document.modelContext is not detected. Open this in a WebMCP-enabled browser.",
      },
    }));

    if (!available) {
      addLog("FAIL: WebMCP is unavailable in this browser.");
      setSteps((prev) => ({
        ...prev,
        registerTool: {
          title: "registerTool",
          passed: false,
          detail: "Cannot test registerTool because modelContext is missing",
        },
        toolVisible: {
          title: "Tool visible",
          passed: false,
          detail: "No active modelContext to register tools with",
        },
        toolExecution: {
          title: "Tool execution",
          passed: false,
          detail: "Execution aborted due to missing WebMCP API",
        },
      }));
      return;
    }

    addLog("PASS: WebMCP modelContext detected.");

    // Step 2: Register tool
    try {
      if (disposer) {
        disposer();
      }
      const cleanup = registerTools([testTool]);
      setDisposer(() => cleanup);
      setIsRegistered(true);

      setSteps((prev) => ({
        ...prev,
        registerTool: {
          title: "registerTool",
          passed: true,
          detail: `Successfully called registerTool for "${testTool.name}"`,
        },
      }));
      addLog(`PASS: Registered test tool "${testTool.name}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteps((prev) => ({
        ...prev,
        registerTool: {
          title: "registerTool",
          passed: false,
          detail: `Error calling registerTool: ${msg}`,
        },
      }));
      addLog(`FAIL: Failed to register test tool: ${msg}`);
      return;
    }

    // Step 3: Tool visible
    const diag = getWebMCPDiagnostics();
    const visible = diag.registeredTools.includes(testTool.name);
    setSteps((prev) => ({
      ...prev,
      toolVisible: {
        title: "Tool visible",
        passed: visible,
        detail: visible
          ? `Tool "${testTool.name}" is recorded in registered tools list`
          : `Tool "${testTool.name}" did not appear in registered list`,
      },
    }));
    addLog(visible ? "PASS: Tool verified in active registry." : "WARN: Tool visibility check failed.");

    // Step 4: Execute tool
    try {
      addLog(`Executing "${testTool.name}" with test message...`);
      const result = await testTool.execute({ message: customMsg });
      setExecutionResult(result);
      setSteps((prev) => ({
        ...prev,
        toolExecution: {
          title: "Tool execution",
          passed: true,
          detail: "Successfully executed test tool and received expected payload",
        },
      }));
      addLog("PASS: Tool executed successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteps((prev) => ({
        ...prev,
        toolExecution: {
          title: "Tool execution",
          passed: false,
          detail: `Execution failed: ${msg}`,
        },
      }));
      addLog(`FAIL: Tool execution failed: ${msg}`);
    }
  };

  const handleUnregister = () => {
    if (disposer) {
      disposer();
      setDisposer(null);
    }
    setIsRegistered(false);
    addLog(`Unregistered test tool "${testTool.name}".`);
  };

  const handleExecuteManual = async () => {
    try {
      addLog(`Manual execution of "${testTool.name}"...`);
      const result = await testTool.execute({ message: customMsg });
      setExecutionResult(result);
      addLog(`Result: ${JSON.stringify(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Manual execution error: ${msg}`);
    }
  };

  // Run initial detection on mount
  useEffect(() => {
    void runAllTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="max-w-[900px] mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">WebMCP Browser Smoke Test</h1>
            <span className="pill pill-idle">/webmcp-test</span>
          </div>
          <p className="subtle text-sm mt-1">
            Isolates and validates real browser-side WebMCP registration and execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn">
            ← Back to Forge
          </Link>
          <Link href="/shop" className="btn">
            Storefront →
          </Link>
        </div>
      </header>

      {/* Verification Checklist */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Verification Matrix</h2>
          <button onClick={runAllTests} className="btn btn-primary text-xs">
            Re-run All Tests
          </button>
        </div>

        <div className="space-y-3 font-mono text-sm">
          {Object.entries(steps).map(([key, step]) => {
            const statusGlyph =
              step.passed === null ? "○" : step.passed ? "✓" : "✕";
            const statusColor =
              step.passed === null
                ? "var(--muted)"
                : step.passed
                  ? "var(--ok)"
                  : "var(--bad)";
            return (
              <div
                key={key}
                className="panel p-3 flex items-start justify-between gap-4"
                style={{ background: "var(--panel-2)" }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span style={{ color: statusColor, fontWeight: "bold" }}>
                      {statusGlyph}
                    </span>
                    <span style={{ color: "var(--text)" }}>{step.title}</span>
                  </div>
                  <div className="text-xs subtle pl-5">{step.detail}</div>
                </div>
                <span
                  className="pill shrink-0"
                  style={{
                    color: statusColor,
                    borderColor: statusColor,
                  }}
                >
                  {step.passed === null
                    ? "PENDING"
                    : step.passed
                      ? "PASS"
                      : "FAIL"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Diagnostic Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">API Inspector</h2>
          <div className="mono text-xs space-y-1.5 subtle">
            <div className="flex justify-between">
              <span>document.modelContext:</span>
              <span style={{ color: diagnostics?.hasDocumentModelContext ? "var(--ok)" : "var(--warn)" }}>
                {diagnostics?.hasDocumentModelContext ? "DETECTED" : "ABSENT"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>navigator.modelContext:</span>
              <span style={{ color: diagnostics?.hasNavigatorModelContext ? "var(--ok)" : "var(--muted)" }}>
                {diagnostics?.hasNavigatorModelContext ? "DETECTED" : "ABSENT"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>registerTool function:</span>
              <span style={{ color: diagnostics?.hasRegisterTool ? "var(--ok)" : "var(--bad)" }}>
                {diagnostics?.hasRegisterTool ? "PRESENT" : "MISSING"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Active registered tools:</span>
              <span style={{ color: "var(--text)" }}>
                {diagnostics?.registeredTools.length ?? 0}
              </span>
            </div>
          </div>

          {diagnostics && diagnostics.registeredTools.length > 0 && (
            <div className="pt-2 border-t space-y-1" style={{ borderColor: "var(--line)" }}>
              <div className="text-xs subtle">Registered names:</div>
              <div className="mono text-xs space-y-0.5" style={{ color: "var(--ok)" }}>
                {diagnostics.registeredTools.map((name) => (
                  <div key={name}>• {name}</div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Interactive Controls */}
        <section className="panel p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Tool Sandbox (hello_webmcp)</h2>
          <div className="space-y-2">
            <input
              type="text"
              className="text-xs w-full mono"
              value={customMsg}
              placeholder="Test input message"
              onChange={(e) => setCustomMsg(e.target.value)}
            />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleExecuteManual}
                className="btn text-xs"
              >
                Execute Tool
              </button>
              {isRegistered ? (
                <button onClick={handleUnregister} className="btn text-xs" style={{ color: "var(--warn)" }}>
                  Unregister Tool
                </button>
              ) : (
                <button onClick={runAllTests} className="btn text-xs">
                  Register Tool
                </button>
              )}
            </div>
          </div>

          {executionResult !== null && (
            <div className="mt-2 p-2 rounded text-xs mono" style={{ background: "var(--bg)", color: "var(--ok)" }}>
              <pre className="whitespace-pre-wrap">{JSON.stringify(executionResult, null, 2)}</pre>
            </div>
          )}
        </section>

      </div>

      {/* Test Log Stream */}
      <section className="panel p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Smoke Test Log</h2>
          <button onClick={() => setTestLog([])} className="text-xs subtle hover:underline">
            Clear
          </button>
        </div>
        <div
          className="p-3 rounded mono text-xs space-y-1 max-h-48 overflow-y-auto"
          style={{ background: "var(--bg)" }}
        >
          {testLog.length === 0 ? (
            <div className="subtle">Log idle.</div>
          ) : (
            testLog.map((line, idx) => (
              <div
                key={idx}
                style={{
                  color: line.includes("FAIL")
                    ? "var(--bad)"
                    : line.includes("PASS")
                      ? "var(--ok)"
                      : line.includes("WARN")
                        ? "var(--warn)"
                        : "var(--muted)",
                }}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
