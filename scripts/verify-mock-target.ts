/**
 * End-to-end check of the mock-target tier, against a running dev server.
 *
 *   npm run dev
 *   npx tsx scripts/verify-mock-target.ts            # defaults to :3000
 *   FORGE_BASE_URL=http://localhost:3100 npx tsx scripts/verify-mock-target.ts
 *
 * Proves the claim the UI makes: the agent runs real HTTP against a target
 * generated from the same contract as the tools, the mock validates requests
 * against the declared schemas, and the guarded and unguarded runs genuinely
 * diverge. Nothing here is simulated, and no third-party host is contacted.
 */
import { runAgent, getTaskForManifest } from "../src/lib/agent/runner";
import { PolicyGate } from "../src/lib/security/monitor";
import { scanManifest, mergeRuntimeFindings, summarise } from "../src/lib/security/scan";
import type { AgentStep, ExecutionPlan, ToolManifest } from "../src/lib/types";

const BASE_URL = process.env.FORGE_BASE_URL ?? "http://localhost:3000";

function heading(text: string) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

async function main() {
  console.log("=========================================");
  console.log("   WEBMCP FORGE — MOCK TARGET (TIER 2)   ");
  console.log("=========================================");
  console.log(`Target server: ${BASE_URL}`);

  // 1. Analyze the bundled contract.
  heading("1. Analyze the contract");
  const analyzeRes = await fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoUrl: "demo-spec", inputKind: "openapi" }),
  });
  if (!analyzeRes.ok) {
    console.error(`  ✕ analyze failed (HTTP ${analyzeRes.status}). Is the dev server running?`);
    process.exit(1);
  }
  const payload = (await analyzeRes.json()) as {
    manifest: ToolManifest;
    execution: ExecutionPlan;
  };
  const { manifest, execution } = payload;

  console.log(`  ✓ ${manifest.tools.length} tools from ${manifest.repoLabel}`);
  console.log(`  ✓ tier ${execution.tier} · executable=${execution.executable} · baseUrl=${execution.baseUrl}`);
  console.log(`    ${execution.reason}`);

  if (execution.tier !== "mock-target" || !manifest.mockSpec) {
    console.error("  ✕ expected a mock target for a spec input");
    process.exit(1);
  }

  // 2. Bring the mock up.
  heading("2. Start the mock target");
  const regRes = await fetch(`${BASE_URL}/api/mock/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: manifest.mockSpec }),
  });
  const reg = (await regRes.json()) as { baseUrl: string; operations: number };
  console.log(`  ✓ ${reg.operations} operation(s) live at ${reg.baseUrl}`);

  const mockBase = `${BASE_URL}${reg.baseUrl}`;

  // 3. The mock validates against the declared schema.
  heading("3. The mock enforces the contract");
  const cases: Array<[string, string, number]> = [
    ["well-formed request", `${mockBase}/rooms?checkIn=2026-09-10&maxRate=200`, 200],
    ["missing required param", `${mockBase}/rooms`, 422],
    ["wrong declared type", `${mockBase}/rooms?checkIn=2026-09-10&maxRate=cheap`, 422],
    ["operation not in contract", `${mockBase}/nope`, 404],
  ];
  for (const [label, url, expected] of cases) {
    const res = await fetch(url);
    const ok = res.status === expected;
    console.log(`  ${ok ? "✓" : "✕"} ${label.padEnd(26)} HTTP ${res.status} (expected ${expected})`);
    if (!ok) process.exitCode = 1;
  }

  // 4. Static scan. This needs no execution at all.
  heading("4. Static scan (runs on any input, no target required)");
  const staticVerdicts = scanManifest(manifest, BASE_URL);
  console.log(`  ${JSON.stringify(summarise(staticVerdicts))}`);
  for (const verdict of staticVerdicts) {
    const checks = verdict.findings.map((f) => `${f.check}(${f.severity})`).join(" + ") || "clean";
    console.log(`  ${verdict.tool.padEnd(18)} ${verdict.verdict.toUpperCase().padEnd(9)} ${checks}`);
  }

  // 5. Both agents, against the mock, for real.
  const task = getTaskForManifest(manifest);
  console.log(`\nTask: "${task}"`);

  const plan: ExecutionPlan = { ...execution, baseUrl: mockBase };

  async function runMode(mode: "guarded" | "unguarded") {
    heading(`5. ${mode.toUpperCase()} agent against ${plan.baseUrl}`);
    const gate = new PolicyGate(BASE_URL, true, execution.allowedOrigins ?? []);
    const steps: AgentStep[] = [];

    await runAgent({
      manifest,
      verdicts: staticVerdicts,
      gate,
      mode,
      plan,
      onStep: (step) => steps.push(step),
    });

    for (const step of steps) {
      console.log(`  ${step.status.padEnd(8)} ${step.tool.padEnd(18)} ${step.summary}`);
    }

    console.log("  observed requests:");
    for (const request of gate.observed) {
      const tag = request.outcome === "blocked" ? "BLOCKED" : request.declaredTarget ? "SENT" : "SENT*";
      console.log(`    ${tag.padEnd(8)} ${request.method.padEnd(5)} ${request.url.replace(BASE_URL, "")}`);
    }

    const runtime = gate.findings.filter((finding) => finding.phase === "runtime");
    console.log(
      `  runtime findings: ${
        runtime.map((f) => `${f.tool}:${f.check}(${f.severity})`).join(", ") || "none"
      }`,
    );
    console.log(`  verdicts: ${JSON.stringify(summarise(mergeRuntimeFindings(staticVerdicts, gate.findings)))}`);
    return { steps, gate };
  }

  const guarded = await runMode("guarded");
  const unguarded = await runMode("unguarded");

  // 6. The two runs must actually differ.
  heading("6. Divergence");
  const guardedRefused = guarded.steps.filter((s) => s.status === "blocked").length;
  const unguardedEgress = unguarded.gate.observed.filter((r) => r.outcome === "blocked").length;
  console.log(`  guarded refused ${guardedRefused} blocked tool(s)`);
  console.log(`  unguarded attempted ${unguardedEgress} cross-origin call(s), all refused by the gate`);

  if (guardedRefused === 0 || unguardedEgress === 0) {
    console.error("  ✕ the two runs did not diverge as expected");
    process.exitCode = 1;
  } else {
    console.log("  ✓ guarded and unguarded diverge, against a real target");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
