"use client";

import { useEffect, useState } from "react";
import type {
  AgentRun,
  Finding,
  GeneratedTool,
  LogEntry,
  ObservedRequest,
  ResultInfo,
  Stage,
  ToolVerdict,
} from "@/lib/types";
import {
  getWebMCPDiagnostics,
  subscribeWebMCPDiagnostics,
  type WebMCPDiagnostics,
} from "@/lib/webmcp";

const STAGES: { id: Stage; label: string }[] = [
  { id: "discovering", label: "Discover" },
  { id: "generating", label: "Generate" },
  { id: "scanning", label: "Scan" },
  { id: "validating", label: "Validate" },
  { id: "done", label: "Ship" },
];

const ORDER: Stage[] = ["idle", "discovering", "generating", "scanning", "validating", "done"];

export function PipelineRail({ stage }: { stage: Stage }) {
  const current = ORDER.indexOf(stage);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STAGES.map((entry, i) => {
        const position = ORDER.indexOf(entry.id);
        const done = current > position;
        const active = current === position;
        return (
          <div key={entry.id} className="flex items-center gap-2">
            <span
              className="pill"
              style={{
                color: active ? "var(--accent)" : done ? "var(--ok)" : "var(--muted)",
                borderColor: active ? "var(--accent)" : "var(--line)",
              }}
            >
              {done ? "✓" : active ? "●" : "○"} {entry.label}
            </span>
            {i < STAGES.length - 1 && <span className="subtle text-xs">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function severityClass(severity: Finding["severity"]) {
  if (severity === "high") return "pill pill-bad";
  if (severity === "medium") return "pill pill-warn";
  return "pill pill-idle";
}

export function ToolCard({
  tool,
  verdict,
  expanded,
  onToggle,
}: {
  tool: GeneratedTool;
  verdict?: ToolVerdict;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = verdict?.verdict ?? "unscanned";
  const findingCount = verdict?.findings.length ?? 0;
  const pill =
    status === "blocked" ? "pill pill-bad" : status === "verified" ? "pill pill-ok" : "pill pill-idle";

  return (
    <div className="panel p-3" style={{ borderColor: status === "blocked" ? "var(--bad)" : undefined }}>
      <button onClick={onToggle} className="w-full text-left cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mono text-sm">{tool.name}</div>
            <div className="subtle text-xs mt-1 truncate">
              {tool.endpoint.method} {tool.endpoint.path}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tool.annotations.readOnlyHint && <span className="pill pill-idle">read-only</span>}
            {!expanded && findingCount > 0 && (
              <span className="pill pill-warn">
                {findingCount} finding{findingCount > 1 ? "s" : ""}
              </span>
            )}
            <span className={pill}>
              {status === "blocked" ? "blocked" : status === "verified" ? "verified" : "unscanned"}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: "var(--line)" }}>
          <div>
            <div className="subtle text-xs font-semibold uppercase">Description (Agent Input)</div>
            <p className="text-sm mt-1">{tool.description}</p>
          </div>

          <div>
            <div className="subtle text-xs font-semibold uppercase">Schema</div>
            <pre className="mono text-xs mt-1 p-2 rounded overflow-x-auto" style={{ background: "var(--bg)" }}>
              {JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          </div>

          {verdict && verdict.findings.length > 0 && (
            <div className="space-y-2">
              <div className="subtle text-xs font-semibold uppercase">Findings</div>
              {verdict.findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="p-3 rounded border" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <div className="flex items-center gap-2">
        <span className={severityClass(finding.severity)}>{finding.severity}</span>
        <span className="pill pill-idle">{finding.phase}</span>
        <span className="mono text-xs subtle">{finding.check}</span>
      </div>
      <div className="text-sm mt-2">{finding.title}</div>
      <p className="subtle text-xs mt-1">{finding.detail}</p>
      <div className="mono text-xs mt-2 p-2 rounded" style={{ background: "var(--bg)", color: "var(--warn)" }}>
        {finding.evidence}
      </div>
      <p className="subtle text-xs mt-2">
        <span style={{ color: "var(--ok)" }}>Fix:</span> {finding.remediation}
      </p>
    </div>
  );
}

export function ResultPanel({
  resultInfo,
}: {
  resultInfo: ResultInfo;
}) {
  if (resultInfo.noContract) {
    return (
      <div className="panel p-4 space-y-3" style={{ borderColor: "var(--warn)" }}>
        <div className="flex items-center gap-2">
          <span className="pill pill-warn">Live Audit</span>
          <h3 className="font-semibold text-sm">Synthesized WebMCP Capabilities</h3>
        </div>
        <p className="subtle text-xs">{resultInfo.message}</p>

        {resultInfo.suggestedActions && resultInfo.suggestedActions.length > 0 && (
          <div className="space-y-1 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
            <div className="text-xs font-semibold subtle uppercase">Suggested Actions</div>
            <ul className="text-xs space-y-1">
              {resultInfo.suggestedActions.map((action, i) => (
                <li key={i} className="subtle">
                  👉 {action}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (resultInfo.matchedAdapters && resultInfo.matchedAdapters.length > 0) {
    return (
      <div className="panel p-3 text-xs space-y-1.5" style={{ borderColor: "var(--ok)" }}>
        <div className="flex items-center justify-between">
          <span className="subtle uppercase font-semibold">Target Architecture & Adapters</span>
          <span className="pill pill-ok">Ready</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="subtle">Extracted Interface:</span>
          {resultInfo.matchedAdapters.map((a) => (
            <span key={a} className="mono pill pill-idle">
              {a}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export function AgentPanel({
  run,
}: {
  run: AgentRun | null;
}) {
  if (!run) {
    return (
      <div className="space-y-2">
        <p className="subtle text-sm">
          No agent run yet. Click <strong>Validate: unguarded agent</strong> to see an AI agent blindly follow tool descriptions, or <strong>Validate: guarded agent</strong> to see PolicyGate protect the session.
        </p>
      </div>
    );
  }

  const isRunning = run.status === "running";

  return (
    <div className="space-y-3">
      {/* Dynamic Task Header */}
      <div className="p-2.5 rounded border" style={{ background: "var(--bg)", borderColor: "var(--line)" }}>
        <div className="text-xs font-semibold subtle uppercase mb-1">Agent Scenario Goal</div>
        <div className="text-xs italic" style={{ color: "var(--text)" }}>
          &ldquo;{run.task}&rdquo;
        </div>
      </div>

      {/* Live Status Banner */}
      {isRunning ? (
        <div
          className="flex items-center justify-between p-2 rounded border text-xs mono"
          style={{ background: "var(--panel)", borderColor: "var(--accent)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full animate-ping"
              style={{ background: "var(--accent)" }}
            />
            <span style={{ color: "var(--accent)" }}>Agent reasoning & executing step {run.steps.length + 1}...</span>
          </div>
          <span className="pill pill-idle text-[10px]">Active</span>
        </div>
      ) : (
        <div
          className="flex items-center justify-between p-2 rounded border text-xs"
          style={{
            background: "var(--panel)",
            borderColor: run.status === "passed" ? "var(--ok)" : "var(--bad)",
          }}
        >
          <span style={{ color: run.status === "passed" ? "var(--ok)" : "var(--bad)" }}>
            {run.status === "passed" ? "✓ Validation passed (Safety policy enforced)" : "⚠️ Policy violations captured"}
          </span>
          <span className={run.status === "passed" ? "pill pill-ok" : "pill pill-bad"}>
            {run.status.toUpperCase()}
          </span>
        </div>
      )}

      {/* Steps List */}
      <div className="space-y-2">
        {run.steps.map((step) => {
          const isBlocked = step.status === "blocked";
          const isError = step.status === "error";
          const colour = isBlocked ? "var(--bad)" : isError ? "var(--warn)" : "var(--ok)";
          const glyph = isBlocked ? "✕" : isError ? "!" : "✓";

          return (
            <div
              key={step.index}
              className="p-2.5 rounded border flash space-y-1"
              style={{
                borderColor: isBlocked ? "var(--bad)" : "var(--line)",
                background: "var(--panel)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="mono font-bold" style={{ color: colour }}>
                    {glyph}
                  </span>
                  <span className="mono text-xs font-semibold">{step.tool}</span>
                </div>
                <span
                  className={
                    isBlocked ? "pill pill-bad text-[10px]" : isError ? "pill pill-warn text-[10px]" : "pill pill-ok text-[10px]"
                  }
                >
                  {step.status}
                </span>
              </div>

              <div className="text-xs subtle pl-4">{step.summary}</div>

              {step.detail && (
                <div className="text-xs pl-4 font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                  ↳ {step.detail}
                </div>
              )}

              {step.input && Object.keys(step.input).length > 0 && (
                <div className="mt-1 pt-1 border-t text-[11px] mono text-xs subtle" style={{ borderColor: "var(--line)" }}>
                  <span className="text-[10px] uppercase font-semibold text-[var(--muted)]">Input: </span>
                  {JSON.stringify(step.input)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RequestLog({
  requests,
}: {
  requests: ObservedRequest[];
}) {
  if (requests.length === 0) {
    return <p className="subtle text-sm">No network requests observed yet. Run agent validation to monitor live PolicyGate network interception.</p>;
  }

  return (
    <div className="space-y-1.5">
      {requests.map((request, i) => (
        <div
          key={i}
          className="mono text-xs p-2 rounded border flex items-center justify-between gap-2"
          style={{
            borderColor: request.crossOrigin ? "var(--bad)" : "var(--line)",
            background: "var(--panel)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={request.crossOrigin ? "pill pill-bad text-[10px]" : "pill pill-ok text-[10px]"}
            >
              {request.crossOrigin ? "BLOCKED" : "SENT"}
            </span>
            <span className="subtle font-semibold">{request.method}</span>
            <span className="truncate text-xs">{request.url}</span>
          </div>
          <span className="text-[10px] subtle shrink-0">
            {new Date(request.at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return <p className="subtle text-sm">Idle.</p>;
  return (
    <div className="space-y-1">
      {entries
        .slice()
        .reverse()
        .map((entry, i) => (
          <div key={i} className="text-xs flex gap-2 flash">
            <span
              className="mono"
              style={{
                color:
                  entry.actor === "agent"
                    ? "var(--accent)"
                    : entry.actor === "human"
                      ? "var(--text)"
                      : "var(--muted)",
              }}
            >
              {entry.actor.padEnd(6)}
            </span>
            <span className="subtle">{entry.message}</span>
          </div>
        ))}
    </div>
  );
}

export function WebMCPStatusPanel() {
  const [diag, setDiag] = useState<WebMCPDiagnostics | null>(null);

  useEffect(() => {
    setDiag(getWebMCPDiagnostics());
    return subscribeWebMCPDiagnostics(() => {
      setDiag(getWebMCPDiagnostics());
    });
  }, []);

  if (!diag) {
    return (
      <div className="mono text-xs subtle space-y-1">
        <div>Checking WebMCP status...</div>
      </div>
    );
  }

  if (!diag.apiAvailable) {
    return (
      <div className="space-y-3">
        <div className="mono text-xs space-y-1.5">
          <div className="font-semibold" style={{ color: "var(--text)" }}>WEBMCP STATUS</div>
          <div className="flex justify-between">
            <span className="subtle">API available:</span>
            <span style={{ color: "var(--bad)" }}>NO</span>
          </div>
        </div>
        <p className="subtle text-xs">
          Open this application in a WebMCP-enabled browser (e.g. Chrome with WebMCP flag/extension or ChatGPT in-app browser).
        </p>
        <div>
          <a href="/webmcp-test" className="btn text-xs py-1 inline-block">
            Open Smoke Test →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="mono text-xs space-y-1">
        <div className="font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text)" }}>
          WEBMCP STATUS
        </div>
        <div className="flex justify-between">
          <span className="subtle">API available:</span>
          <span style={{ color: "var(--ok)" }}>YES</span>
        </div>
        <div className="flex justify-between">
          <span className="subtle">modelContext:</span>
          <span style={{ color: "var(--ok)" }}>YES</span>
        </div>
        <div className="flex justify-between">
          <span className="subtle">registerTool:</span>
          <span style={{ color: "var(--ok)" }}>YES</span>
        </div>
      </div>

      <div className="border-t pt-2 space-y-1" style={{ borderColor: "var(--line)" }}>
        <div className="text-xs subtle mb-1">Registered tools:</div>
        {diag.registeredTools.length === 0 ? (
          <div className="subtle text-xs mono">No tools currently registered</div>
        ) : (
          <div className="space-y-1 mono text-xs">
            {diag.registeredTools.map((tool) => (
              <div key={tool} className="flex items-center gap-1.5" style={{ color: "var(--ok)" }}>
                <span>✓</span>
                <span style={{ color: "var(--text)" }}>{tool}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs subtle pt-1 border-t" style={{ borderColor: "var(--line)" }}>
        <span>Tool count:</span>
        <span className="mono font-semibold" style={{ color: "var(--text)" }}>
          {diag.registeredTools.length}
        </span>
      </div>
    </div>
  );
}
