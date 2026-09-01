"use client";

import type { AgentStep, ForgeState, LogEntry, ToolManifest } from "./types";
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

/* ------------------------------------------------------------------ */
/* Actions. Each one is callable from the UI and from a WebMCP tool.   */
/* ------------------------------------------------------------------ */

export async function analyze(repoUrl: string, actor: LogEntry["actor"] = "human") {
  set({ stage: "discovering", error: null, verdicts: [], agentRun: null, observed: [] });
  log(actor, `Analyzing ${repoUrl || "the bundled demo storefront"}`);

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoUrl }),
  });
  const payload = await response.json();

  if (!response.ok) {
    set({ stage: "idle", error: payload.error ?? "Analysis failed." });
    log("system", `Analysis failed: ${payload.error ?? response.status}`);
    return null;
  }

  const manifest = payload.manifest as ToolManifest;
  set({ stage: "generating", manifest });
  persistManifest(manifest);
  log(
    "system",
    `Discovered ${manifest.capabilities.length} capabilities and generated ${manifest.tools.length} tools`,
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
