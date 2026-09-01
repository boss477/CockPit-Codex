"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as store from "@/lib/store";
import { generateIntegration } from "@/lib/codegen";
import { summarise } from "@/lib/security/scan";
import { isWebMCPAvailable } from "@/lib/webmcp";
import { useForgeTools } from "./useForgeTools";
import { ActivityLog, AgentPanel, PipelineRail, RequestLog, ToolCard, WebMCPStatusPanel } from "./Panels";

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

  useEffect(() => {
    setWebmcp(isWebMCPAvailable());
  }, []);

  const stats = useMemo(() => summarise(state.verdicts), [state.verdicts]);
  const hasManifest = state.manifest !== null;
  const scanned = state.verdicts.length > 0;

  const run = async (action: () => unknown | Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
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
            Generate WebMCP tools from a web app, then prove which ones are safe for an
            agent to use. This dashboard is itself a WebMCP surface, so an agent can drive
            every step below while you watch it happen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={webmcp ? "pill pill-ok" : "pill pill-warn"}>
            {webmcp === null ? "WebMCP ○ Checking" : webmcp ? "WebMCP ● Available" : "WebMCP ○ Unavailable"}
          </span>
          <Link href="/webmcp-test" className="btn">
            Smoke test
          </Link>
          <Link href="/shop" className="btn">
            Open the storefront →
          </Link>
        </div>
      </header>


      <div className="panel p-4 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            className="mono text-sm flex-1 min-w-[280px]"
            placeholder="https://github.com/owner/repo  (empty = bundled demo storefront)"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
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
            disabled={busy || !scanned}
            onClick={() => run(() => store.validate("unguarded"))}
          >
            Validate: unguarded agent
          </button>
          <button
            className="btn"
            disabled={busy || !scanned}
            onClick={() => run(() => store.validate("guarded"))}
          >
            Validate: guarded agent
          </button>
          <button className="btn" disabled={!hasManifest} onClick={download}>
            Export integration
          </button>
        </div>

        <PipelineRail stage={state.stage} />

        {/* Both validate buttons run this one task, which is otherwise only
            discoverable after clicking. */}
        {scanned && !state.agentRun && (
          <p className="subtle text-xs">
            Both agents run the same task: <em>{store.AGENT_TASK}</em>
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
              repo <span className="mono" style={{ color: "var(--text)" }}>{state.manifest!.repoLabel}</span>
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
                Analyze a repository to generate tools. The bundled storefront is a small
                Next.js app that was never built for agents.
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="Agent validation"
            hint="The same task, run two ways, against the tools that were just generated."
          >
            <AgentPanel run={state.agentRun} />
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
