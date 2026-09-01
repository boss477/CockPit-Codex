"use client";

import { useEffect, useState } from "react";
import type {
  AgentRun,
  Finding,
  GeneratedTool,
  LogEntry,
  ObservedRequest,
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
            {/* Surfaced while collapsed: a medium finding is otherwise invisible
                on a tool whose verdict still reads "verified". */}
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
        <div className="mt-3 border-t pt-3 space-y-3" style={{ borderColor: "var(--line)" }}>
          <div>
            <div className="subtle text-xs mb-1">Description exposed to the agent</div>
            <p className="text-xs whitespace-pre-wrap mono" style={{ color: "var(--text)" }}>
              {tool.description}
            </p>
          </div>
          <div className="subtle text-xs">
            Origin: <span className="mono">{tool.origin.source}</span>
          </div>
          {(verdict?.findings ?? []).map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="panel p-3" style={{ background: "var(--panel-2)" }}>
      <div className="flex items-center gap-2 flex-wrap">
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

export function AgentPanel({ run }: { run: AgentRun | null }) {
  if (!run) {
    return (
      <p className="subtle text-sm">
        No agent run yet. The unguarded agent treats tool descriptions as instructions;
        the guarded agent refuses tools the scan blocked.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="subtle text-xs">Task: {run.task}</div>
      {run.steps.map((step) => {
        const colour =
          step.status === "blocked"
            ? "var(--bad)"
            : step.status === "error"
              ? "var(--warn)"
              : "var(--ok)";
        const glyph = step.status === "blocked" ? "✕" : step.status === "error" ? "!" : "✓";
        return (
          <div key={step.index} className="flex gap-3 text-sm flash">
            <span className="mono" style={{ color: colour }}>
              {glyph}
            </span>
            <div className="min-w-0">
              <span className="mono">{step.tool}</span>
              <span className="subtle"> — {step.summary}</span>
              {step.detail && <div className="subtle text-xs mt-0.5">{step.detail}</div>}
            </div>
          </div>
        );
      })}
      {run.status !== "running" && (
        <div className="pt-2 text-sm" style={{ color: run.status === "passed" ? "var(--ok)" : "var(--bad)" }}>
          Run {run.status}
        </div>
      )}
    </div>
  );
}

export function RequestLog({ requests }: { requests: ObservedRequest[] }) {
  if (requests.length === 0) {
    return <p className="subtle text-sm">Nothing observed yet.</p>;
  }
  return (
    <div className="space-y-1">
      {requests.map((request, i) => (
        <div key={i} className="mono text-xs flex gap-2">
          <span style={{ color: request.crossOrigin ? "var(--bad)" : "var(--muted)" }}>
            {request.crossOrigin ? "BLOCKED" : "  sent "}
          </span>
          <span className="subtle">{request.method}</span>
          <span className="truncate">{request.url}</span>
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

