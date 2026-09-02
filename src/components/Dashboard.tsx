"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as store from "@/lib/store";
import { generateIntegration } from "@/lib/codegen";
import { summarise } from "@/lib/security/scan";
import { isWebMCPAvailable } from "@/lib/webmcp";
import { resolveInput } from "@/lib/inputRouter";
import type { InputKind } from "@/lib/types";
import { useForgeTools } from "./useForgeTools";
import {
  ActivityLog,
  AgentPanel,
  ExecutionBadge,
  ExecutionPanel,
  PipelineRail,
  RequestLog,
  ResultPanel,
  ToolCard,
  WebMCPStatusPanel,
} from "./Panels";

interface SampleBenchmark {
  label: string;
  badge: string;
  findingType: string;
  url: string;
  kind: InputKind;
  description: string;
}

const SAMPLE_BENCHMARKS: SampleBenchmark[] = [
  {
    label: "Prompt Injection in Metadata",
    badge: "🚨 Injection",
    findingType: "metadata-injection",
    url: "https://github.com/webmcp-forge/demo-storefront",
    kind: "github",
    description: "Demonstrates hidden directives & instructions inside tool comments (track_order).",
  },
  {
    label: "Read-Only Mismatch Mutation",
    badge: "⚠️ Unbounded Action",
    findingType: "readonly-mismatch",
    url: "https://github.com/webmcp-forge/demo-storefront",
    kind: "github",
    description: "Demonstrates POST /checkout masquerading as a harmless read-only summary.",
  },
  {
    label: "Sensitive Data Egress",
    badge: "🔒 Exfiltration",
    findingType: "sensitive-data-egress",
    url: "https://github.com/webmcp-forge/demo-storefront",
    kind: "github",
    description: "Demonstrates personal customer email forwarded to a third-party host.",
  },
  {
    label: "Mock Target Validation",
    badge: "🧪 Mock Target",
    findingType: "mock-target",
    url: "demo-spec",
    kind: "openapi",
    description:
      "Bundled OpenAPI contract with a poisoned description. Generates a mock target " +
      "from the spec and runs the agent against it for real - no third-party host touched.",
  },
  {
    label: "OpenAPI Spec Ingestion",
    badge: "📜 Spec Audit",
    findingType: "openapi-spec",
    url: "https://petstore.swagger.io/v2/swagger.json",
    kind: "openapi",
    description: "Automated ingestion of OpenAPI / Swagger contracts.",
  },
  {
    label: "Live Web Page Audit",
    badge: "🌐 Live Contract",
    findingType: "live-probe",
    url: "https://motion.so/agent",
    kind: "live",
    description: "Probes live websites for OpenAPI endpoints and WebMCP contracts.",
  },
];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
        {hint && <p className="subtle text-xs mt-1">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function Dashboard() {
  useForgeTools();

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [repoUrl, setRepoUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    setWebmcp(isWebMCPAvailable());
  }, []);

  // Compute detected input kind based on current input text
  const detectedKind = useMemo(() => resolveInput(repoUrl), [repoUrl]);

  // If user hasn't explicitly locked a kind, track detected kind in store
  useEffect(() => {
    store.setInputKind(detectedKind);
  }, [detectedKind]);

  const stats = useMemo(() => summarise(state.verdicts), [state.verdicts]);
  const hasManifest = state.manifest !== null;
  const scanned = state.verdicts.length > 0;
  const plan = state.execution ?? state.manifest?.execution ?? null;
  const isExecutable = useMemo(() => store.isManifestExecutable(state.manifest), [state.manifest]);
  // Tier 1 is a legitimate outcome, not an error: scan runs, validate does not.
  const validateDisabled = !scanned || (plan !== null && !plan.executable);
  const validateReason = plan && !plan.executable ? plan.reason : undefined;

  const run = async (action: () => unknown | Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const selectSample = (sample: SampleBenchmark) => {
    setRepoUrl(sample.url);
    store.setInputKind(sample.kind);
    run(() => store.analyze(sample.url, "human", sample.kind));
  };

  const download = () => {
    if (!state.manifest) return;
    const source = generateIntegration(state.manifest, state.verdicts);
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "webmcp-tools.js";
    anchor.click();
    URL.revokeObjectURL(url);
    store.note("human", "Exported the integration source");
  };

  return (
    <main className="max-w-[1400px] mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">WebMCP Forge</h1>
          <p className="subtle text-sm mt-1 max-w-2xl">
            Generate WebMCP tools from a web app or API, then prove which ones are safe for an
            agent to use. This dashboard is itself a WebMCP surface, so an agent can drive
            every step below while you watch it happen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={webmcp ? "pill pill-ok" : "pill pill-warn"}>
            {webmcp === null ? "WebMCP ○ Checking" : webmcp ? "WebMCP ● Available" : "WebMCP ○ Unavailable"}
          </span>
          <a
            href="/webmcp-extension.zip"
            download="webmcp-extension.zip"
            className="btn"
            title="Download ready-to-load Chrome Extension for WhatsApp Web & Motion"
          >
            📦 Extension (.zip)
          </a>
          <Link href="/webmcp-test" className="btn">
            Smoke test
          </Link>
          <Link href="/shop" className="btn">
            Open the storefront →
          </Link>
        </div>
      </header>

      {/* Execution tier banner. SCAN always runs; the tier decides VALIDATE. */}
      <div
        className="panel px-4 py-2 text-xs flex items-center justify-between gap-2 flex-wrap"
        style={{
          borderColor: !hasManifest
            ? "var(--line)"
            : isExecutable
              ? "var(--ok)"
              : "var(--warn)",
          background: "var(--panel)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {plan ? (
            <ExecutionBadge plan={plan} />
          ) : (
            <span className="pill pill-idle">SCAN ALWAYS RUNS</span>
          )}
          <span className="subtle">
            {plan
              ? plan.reason
              : "Analyze any input to see which of the three tiers it qualifies for. " +
                "The scan needs no execution; only validation needs a target we own."}
          </span>
        </div>
        <button
          className="subtle hover:text-[var(--text)] underline cursor-pointer"
          onClick={() => setShowConfig(!showConfig)}
        >
          {showConfig ? "Hide Settings" : "Execution Settings"}
        </button>
      </div>

      {showConfig && (
        <div className="panel p-3 text-xs space-y-2 border-dashed" style={{ borderColor: "var(--line)" }}>
          <div className="font-semibold text-xs subtle uppercase">Target Execution Base URL</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              className="mono text-xs p-1.5 rounded border flex-1 min-w-[240px]"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
              value={state.executionBaseUrl}
              placeholder="empty = generate a mock target here · http://localhost:4010 = your own Prism"
              onChange={(e) => store.setExecutionBaseUrl(e.target.value)}
            />
            <span className="subtle">
              Must be localhost or a private host. Anything else is refused.
            </span>
          </div>
          <div className="subtle space-y-1">
            <div>
              <strong>Leave it empty</strong> and a spec becomes a mock target served by this
              app at <span className="mono">/api/mock/&lt;id&gt;</span>, validating requests
              against the declared schemas.
            </div>
            <div>
              <strong>Running your own?</strong>{" "}
              <span className="mono">npx @stoplight/prism-cli mock spec.yaml --port 4010</span>{" "}
              (or <span className="mono">npm run mock -- spec.yaml</span>), then put{" "}
              <span className="mono">http://localhost:4010</span> here.
            </div>
            <div>
              <strong>Running the real app?</strong> Point at it directly, e.g.{" "}
              <span className="mono">http://localhost:3000</span>.
            </div>
          </div>
        </div>
      )}

      <div className="panel p-4 space-y-3">
        {/* Input Bar with Kind Indicator */}
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="pill pill-idle text-xs mono">
                {state.inputKind === "github"
                  ? "📦 GitHub"
                  : state.inputKind === "openapi"
                    ? "📜 OpenAPI"
                    : "🌐 Live URL"}
              </span>
            </div>
            <input
              type="text"
              className="mono text-sm flex-1 min-w-[280px]"
              placeholder="GitHub repo, OpenAPI JSON/YAML, or live URL (empty = demo storefront)"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run(() => store.analyze(repoUrl));
              }}
            />
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => store.analyze(repoUrl))}
            >
              Analyze
            </button>
            <button className="btn" disabled={busy || !hasManifest} onClick={() => run(() => store.scan())}>
              Run security scan
            </button>
            <button
              className="btn"
              disabled={busy || validateDisabled}
              title={validateReason}
              onClick={() => run(() => store.validate("unguarded"))}
            >
              Validate: unguarded agent
            </button>
            <button
              className="btn"
              disabled={busy || validateDisabled}
              title={validateReason}
              onClick={() => run(() => store.validate("guarded"))}
            >
              Validate: guarded agent
            </button>
            <button className="btn" disabled={!hasManifest} onClick={download}>
              Export integration
            </button>
          </div>

          {/* Sample Security Finding Chips */}
          <div className="pt-2 border-t space-y-1.5" style={{ borderColor: "var(--line)" }}>
            <div className="text-xs subtle uppercase font-semibold">Sample Security Benchmarks</div>
            <div className="flex gap-2 flex-wrap">
              {SAMPLE_BENCHMARKS.map((sample) => (
                <button
                  key={sample.label}
                  className="pill cursor-pointer transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] text-xs text-left"
                  style={{
                    borderColor: repoUrl === sample.url ? "var(--accent)" : "var(--line)",
                    background: "var(--bg)",
                  }}
                  title={sample.description}
                  onClick={() => selectSample(sample)}
                >
                  <span className="font-semibold mr-1">{sample.badge}</span>
                  <span className="subtle">{sample.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <PipelineRail stage={state.stage} />

        {/* Structured Result Panel for Analyzed Stack */}
        {state.resultInfo && <ResultPanel resultInfo={state.resultInfo} />}

        {/* Which tier this target qualified for, and why. */}
        {plan && <ExecutionPanel plan={plan} />}

        {/* Validate scenario description */}
        {scanned && !state.agentRun && !validateDisabled && (
          <p className="subtle text-xs">
            Scenario: <em>&ldquo;{store.getTaskForManifest(state.manifest)}&rdquo;</em>
          </p>
        )}

        {state.error && (
          <p className="text-sm" style={{ color: "var(--bad)" }}>
            {state.error}
          </p>
        )}

        {hasManifest && (
          <div className="flex gap-4 flex-wrap text-xs subtle">
            <span>
              target <span className="mono" style={{ color: "var(--text)" }}>{state.manifest!.repoLabel}</span>
            </span>
            <span>
              capabilities <span style={{ color: "var(--text)" }}>{state.manifest!.capabilities.length}</span>
            </span>
            <span>
              tools <span style={{ color: "var(--text)" }}>{stats.total || state.manifest!.tools.length}</span>
            </span>
            {scanned && (
              <>
                <span style={{ color: "var(--ok)" }}>{stats.verified} verified</span>
                <span style={{ color: "var(--bad)" }}>{stats.blocked} blocked</span>
                <span style={{ color: "var(--warn)" }}>{stats.medium} medium</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Section
            title="Generated tools"
            hint="Click a tool to see the description an agent would read, and any findings against it."
          >
            {hasManifest ? (
              <div className="space-y-2">
                {state.manifest!.tools.map((tool) => (
                  <ToolCard
                    key={tool.name}
                    tool={tool}
                    verdict={state.verdicts.find((entry) => entry.tool === tool.name)}
                    expanded={expanded === tool.name}
                    onToggle={() => setExpanded(expanded === tool.name ? null : tool.name)}
                  />
                ))}
              </div>
            ) : (
              <p className="subtle text-sm">
                Analyze a repository, OpenAPI contract, or live URL to generate tools. The bundled storefront is a small
                Next.js app that was never built for agents.
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="Agent validation"
            hint={
              plan?.tier === "mock-target"
                ? "The same task, run two ways, against a mock target generated from the same contract as the tools."
                : "The same task, run two ways, against the tools that were just generated."
            }
          >
            <AgentPanel run={state.agentRun} plan={plan} />
          </Section>

          <Section title="Observed requests" hint="Every network call the generated tools made, and what the gate did with it.">
            <RequestLog requests={state.observed} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="WebMCP Diagnostics" hint="Real browser modelContext registration status.">
            <WebMCPStatusPanel />
          </Section>

          <Section title="Activity" hint="Human and agent actions land in the same stream.">
            <ActivityLog entries={state.log} />
          </Section>

          <Section title="Ask an agent to drive this" hint="Tools this page exposes over WebMCP.">
            <ul className="mono text-xs space-y-1 subtle">
              <li>forge_analyze_repo</li>
              <li>forge_list_tools</li>
              <li>forge_run_security_scan</li>
              <li>forge_get_findings</li>
              <li>forge_get_execution_plan</li>
              <li>forge_run_agent_validation</li>
              <li>forge_export_integration</li>
            </ul>
            <p className="subtle text-xs mt-3">
              Try: &ldquo;Analyze the demo storefront, scan the tools it generates, and tell me
              which ones you would refuse to use.&rdquo;
            </p>
          </Section>
        </div>
      </div>

      <footer className="py-2 text-center text-xs subtle">
        Developed with OpenAI Codex
      </footer>
    </main>
  );
}
