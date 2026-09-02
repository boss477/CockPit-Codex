"use client";

import type {
  AgentStep,
  ExecutionPlan,
  ForgeState,
  InputKind,
  LogEntry,
  MockSpec,
  ToolManifest,
} from "./types";
import { planBadge } from "./executionPlan";
import { PolicyGate } from "./security/monitor";
import { mergeRuntimeFindings, scanManifest } from "./security/scan";
import { getTaskForManifest, runAgent, type AgentMode } from "./agent/runner";

const initialState: ForgeState = {
  stage: "idle",
  manifest: null,
  verdicts: [],
  observed: [],
  agentRun: null,
  log: [],
  error: null,
  inputKind: "github",
  executionBaseUrl: "",
  resultInfo: null,
  execution: null,
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
  if (manifest.execution) return manifest.execution.executable;
  if (manifest.sources && manifest.sources.length > 0) {
    return manifest.sources.some((s) => s.executable);
  }
  return manifest.repoUrl.includes("demo-storefront") || manifest.repoUrl === "" || manifest.inputKind === "github";
}

/**
 * Brings the generated mock target up before the agent runs against it.
 * Returns false only when the mock could not be registered, in which case the
 * mock route still answers from the request itself and says so.
 */
async function ensureMockTarget(mockSpec: MockSpec | undefined | null): Promise<boolean> {
  if (!mockSpec) return true;
  try {
    const response = await fetch("/api/mock/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: mockSpec }),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    log(
      "system",
      `Mock target up at ${payload.baseUrl} serving ${payload.operations} operation(s) from the contract`,
    );
    return true;
  } catch {
    return false;
  }
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
    execution: null,
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

  const manifest = payload.manifest as ToolManifest;
  const matchedAdapters = payload.matchedAdapters ?? manifest.matchedAdapters ?? [];
  const execution = (payload.execution ?? manifest.execution ?? null) as ExecutionPlan | null;

  set({
    stage: "generating",
    manifest,
    execution,
    inputKind: payload.inputKind ?? kindToUse,
    resultInfo: {
      matchedAdapters,
      detectedStack: payload.inputKind ?? kindToUse,
      execution: execution ?? undefined,
    },
  });
  persistManifest(manifest);
  log(
    "system",
    `Discovered ${manifest.capabilities.length} capabilities and generated ${manifest.tools.length} tools via [${matchedAdapters.join(", ")}]`,
  );
  if (execution) {
    // The tier is the honest part of the demo: say which target, and why.
    log("system", `Execution tier: ${planBadge(execution)} — ${execution.reason}`);
  }
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

export async function validate(
  mode: AgentMode,
  actor: LogEntry["actor"] = "human",
  useExtension = false,
  extensionTarget?: "whatsapp" | "motion"
) {
  if (!state.manifest) return null;
  if (state.verdicts.length === 0) scan(actor);

  const plan = state.execution ?? state.manifest.execution ?? null;
  const isLiveSite =
    state.manifest.inputKind === "live" ||
    /^https?:\/\/(?!github\.com)/i.test(state.manifest.repoUrl);
  const resolvedTarget =
    extensionTarget ||
    (state.manifest.repoLabel.toLowerCase().includes("amazon")
      ? "amazon"
      : state.manifest.repoLabel.toLowerCase().includes("youtube")
        ? "youtube"
        : state.manifest.repoLabel.toLowerCase().includes("motion")
          ? "motion"
          : state.manifest.repoLabel.toLowerCase().includes("whatsapp")
            ? "whatsapp"
            : undefined);

  // Tier 1 with no extension:
  // If not a live site or disabled, handle refusal. For live sites without extension,
  // fall back to simulated mode as requested.
  if (plan && !plan.executable && !useExtension) {
    if (!isLiveSite) {
      log(
        "system",
        `VALIDATE disabled (${planBadge(plan)}): ${plan.reason}`,
      );
      set({ stage: "done" });
      return null;
    }
    log("system", "Extension not detected — running in simulated mode");
  }

  const task = getTaskForManifest(state.manifest);
  const gate = new PolicyGate(window.location.origin, true, plan?.allowedOrigins ?? []);
  const steps: AgentStep[] = [];

  if (plan?.mock?.provider === "builtin") {
    await ensureMockTarget(state.manifest.mockSpec);
  }

  set({
    stage: "validating",
    agentRun: { task, steps: [], status: "running", startedAt: new Date().toISOString() },
  });

  const targetLabel = useExtension && resolvedTarget
    ? `live browser tab (${resolvedTarget}) via WebMCP Extension Bridge`
    : `${planBadge(plan)} (${plan?.baseUrl || "this origin"}) for ${state.manifest.repoLabel}`;

  log(actor, `Running the ${mode} agent against ${targetLabel}`);

  await runAgent({
    manifest: state.manifest,
    verdicts: state.verdicts,
    gate,
    mode,
    plan: plan ?? undefined,
    useExtensionBridge: useExtension,
    extensionTarget: resolvedTarget,
    onLog: (logActor, message) => {
      log(logActor, message);
    },
    onStep: (step) => {
      steps.push(step);
      set({
        agentRun: {
          task,
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
      task,
      steps,
      status: failed ? "failed" : "passed",
      startedAt: state.agentRun?.startedAt ?? new Date().toISOString(),
    },
  });

  const runtimeBlocked = gate.findings.filter((f) => f.severity === "high");
  log(
    "system",
    runtimeBlocked.length
      ? `Runtime validation completed with ${runtimeBlocked.length} PolicyGate intervention(s)`
      : "Runtime validation completed successfully with all security policies enforced",
  );

  return steps;
}

export function reset() {
  state = { ...initialState };
  persistManifest(null);
  for (const listener of listeners) listener();
}

/** The tier the current manifest qualifies for, if anything has been analyzed. */
export function getExecutionPlan(): ExecutionPlan | null {
  return state.execution ?? state.manifest?.execution ?? null;
}

export { getTaskForManifest, planBadge };
