"use client";

import type { AgentStep, ForgeState, InputKind, LogEntry, ToolManifest } from "./types";
import { PolicyGate } from "./security/monitor";
import { mergeRuntimeFindings, scanManifest } from "./security/scan";
import { AGENT_TASK, runAgent, type AgentMode } from "./agent/runner";

const initialState: ForgeState = {
  stage: "idle",
  manifest: null,
  verdicts: [],
  observed: [],
  agentRun: null,
  log: [],
  error: null,
  inputKind: "github",
  executionBaseUrl: "http://localhost:3000",
  resultInfo: null,
};

let state: ForgeState = initialState;
const listeners = new Set<() => void>();

function set(patch: Partial<ForgeState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ForgeState {
  return state;
}

export function getServerSnapshot(): ForgeState {
  return initialState;
}

function log(actor: LogEntry["actor"], message: string) {
  set({ log: [...state.log, { at: Date.now(), actor, message }] });
}

export function note(actor: LogEntry["actor"], message: string) {
  log(actor, message);
}

export function setInputKind(inputKind: InputKind) {
  set({ inputKind });
}

export function setExecutionBaseUrl(executionBaseUrl: string) {
  set({ executionBaseUrl });
}

const MANIFEST_KEY = "webmcp-forge:manifest";

/** The shop page reads the manifest the Forge produced. Same origin, so this is enough. */
export function persistManifest(manifest: ToolManifest | null) {
  try {
    if (manifest) localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    else localStorage.removeItem(MANIFEST_KEY);
  } catch {
    // Private mode or storage disabled. The Forge itself still works.
  }
}

export function loadPersistedManifest(): ToolManifest | null {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as ToolManifest) : null;
  } catch {
    return null;
  }
}

export function isManifestExecutable(manifest: ToolManifest | null): boolean {
  if (!manifest || manifest.tools.length === 0) return false;
  // If manifest has sources, check if any is executable
  if (manifest.sources && manifest.sources.length > 0) {
    return manifest.sources.some((s) => s.executable);
  }
  // Bundled storefront and local repo are executable by default
  return manifest.repoUrl.includes("demo-storefront") || manifest.repoUrl === "" || manifest.inputKind === "github";
}

/* ------------------------------------------------------------------ */
/* Actions. Each one is callable from the UI and from a WebMCP tool.   */
/* ------------------------------------------------------------------ */

export async function analyze(
  repoUrl: string,
  actor: LogEntry["actor"] = "human",
  overrideKind?: InputKind,
) {
  const kindToUse = overrideKind || state.inputKind;
  set({
    stage: "discovering",
    error: null,
    verdicts: [],
    agentRun: null,
    observed: [],
    resultInfo: null,
  });
  log(actor, `Analyzing ${repoUrl || "the bundled demo storefront"} (${kindToUse})`);

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoUrl,
      inputKind: kindToUse,
      executionBaseUrl: state.executionBaseUrl,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    set({
      stage: "idle",
      error: payload.error ?? "Analysis failed.",
      resultInfo: {
        message: payload.error ?? response.statusText,
        detectedStack: payload.inputKind ?? kindToUse,
        matchedAdapters: [],
      },
    });
    log("system", `Analysis failed: ${payload.error ?? response.status}`);
    return null;
  }

  // Handle structured "no contract found" result for live mode
  if (payload.noContractFound) {
    set({
      stage: "idle",
      manifest: null,
      error: null,
      resultInfo: {
        noContract: true,
        message: payload.message,
        suggestedActions: payload.suggestedActions,
        probedPaths: payload.audit?.probedPaths,
        targetUrl: payload.targetUrl,
        detectedStack: "Live URL (No OpenAPI / WebMCP contract)",
      },
    });
    log("system", `Live audit completed: no machine-readable contract found at ${payload.targetUrl}`);
    return null;
  }

  const manifest = payload.manifest as ToolManifest;
  const matchedAdapters = payload.matchedAdapters ?? manifest.matchedAdapters ?? [];

  set({
    stage: "generating",
    manifest,
    inputKind: payload.inputKind ?? kindToUse,
    resultInfo: {
      matchedAdapters,
      detectedStack: payload.inputKind ?? kindToUse,
    },
  });
  persistManifest(manifest);
  log(
    "system",
    `Discovered ${manifest.capabilities.length} capabilities and generated ${manifest.tools.length} tools via [${matchedAdapters.join(", ")}]`,
  );
  set({ stage: "generating" });
  return manifest;
}

export function scan(actor: LogEntry["actor"] = "human") {
  if (!state.manifest) return [];
  set({ stage: "scanning" });
  const verdicts = scanManifest(state.manifest, window.location.origin);
  set({ verdicts, stage: "scanning" });

  const blocked = verdicts.filter((v) => v.verdict === "blocked").map((v) => v.tool);
  log(
    actor,
    blocked.length
      ? `Static scan blocked ${blocked.length} tool(s): ${blocked.join(", ")}`
      : "Static scan found no high-severity issues",
  );
  return verdicts;
}

export async function validate(mode: AgentMode, actor: LogEntry["actor"] = "human") {
  if (!state.manifest) return null;
  if (state.verdicts.length === 0) scan(actor);

  if (!isManifestExecutable(state.manifest)) {
    log(
      "system",
      "Live validation skipped: target is in Scan-Only mode (read-only target with no local execution URL).",
    );
    return null;
  }

  const gate = new PolicyGate(window.location.origin, true);
  const steps: AgentStep[] = [];

  set({
    stage: "validating",
    agentRun: { task: AGENT_TASK, steps: [], status: "running", startedAt: new Date().toISOString() },
  });
  log(actor, `Running the ${mode} agent against the generated tools`);

  await runAgent({
    manifest: state.manifest,
    verdicts: state.verdicts,
    gate,
    mode,
    onStep: (step) => {
      steps.push(step);
      set({
        agentRun: {
          task: AGENT_TASK,
          steps: [...steps],
          status: "running",
          startedAt: state.agentRun?.startedAt ?? new Date().toISOString(),
        },
        observed: [...gate.observed],
      });
    },
  });

  const verdicts = mergeRuntimeFindings(state.verdicts, gate.findings);
  const failed = steps.some((step) => step.status === "error");

  set({
    verdicts,
    observed: [...gate.observed],
    stage: "done",
    agentRun: {
      task: AGENT_TASK,
      steps,
      status: failed ? "failed" : "passed",
      startedAt: state.agentRun?.startedAt ?? new Date().toISOString(),
    },
  });

  const runtimeBlocked = gate.findings.filter((f) => f.severity === "high");
  log(
    "system",
    runtimeBlocked.length
      ? `Runtime validation raised ${runtimeBlocked.length} high-severity finding(s)`
      : "Runtime validation completed with no new findings",
  );

  return steps;
}

export function reset() {
  state = { ...initialState };
  persistManifest(null);
  for (const listener of listeners) listener();
}

export { AGENT_TASK };
