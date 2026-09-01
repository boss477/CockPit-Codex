"use client";

import { useEffect } from "react";
import { registerTools, type WebMCPToolDefinition } from "@/lib/webmcp";
import { generateIntegration } from "@/lib/codegen";
import { summarise } from "@/lib/security/scan";
import * as store from "@/lib/store";

/**
 * Registers the Forge's own control surface as WebMCP tools.
 *
 * This is the point of the project: the dashboard a person is looking at and
 * the tools an agent drives it with are the same surface, so every agent
 * action is visible in the UI as it happens.
 */
export function useForgeTools() {
  useEffect(() => {
    const tools: WebMCPToolDefinition[] = [
      {
        name: "forge_analyze_repo",
        description:
          "Analyze a public GitHub repository for Next.js route handlers and generate " +
          "WebMCP tools from them. Leave repoUrl empty to use the bundled demo storefront.",
        inputSchema: {
          type: "object",
          properties: {
            repoUrl: { type: "string", description: "Public GitHub repository URL." },
          },
        },
        execute: async (input) => {
          const repoUrl = typeof input.repoUrl === "string" ? input.repoUrl : "";
          store.note("agent", `Agent requested analysis of ${repoUrl || "the demo storefront"}`);
          const manifest = await store.analyze(repoUrl, "agent");
          if (!manifest) return { ok: false, error: store.getSnapshot().error };
          return {
            ok: true,
            repo: manifest.repoLabel,
            capabilities: manifest.capabilities.length,
            tools: manifest.tools.map((tool) => tool.name),
          };
        },
      },
      {
        name: "forge_list_tools",
        description:
          "List the WebMCP tools generated from the analyzed repository, with their " +
          "endpoint, read-only hint and current security verdict.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
          const { manifest, verdicts } = store.getSnapshot();
          if (!manifest) return { ok: false, error: "Nothing analyzed yet." };
          return {
            ok: true,
            tools: manifest.tools.map((tool) => ({
              name: tool.name,
              endpoint: `${tool.endpoint.method} ${tool.endpoint.path}`,
              readOnlyHint: tool.annotations.readOnlyHint,
              verdict: verdicts.find((v) => v.tool === tool.name)?.verdict ?? "unscanned",
            })),
          };
        },
      },
      {
        name: "forge_run_security_scan",
        description:
          "Run the static security scan over the generated tools. Checks for injected " +
          "instructions in tool metadata, personal data heading to third-party hosts, " +
          "and read-only hints that do not match the mapped request.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          store.note("agent", "Agent started the static security scan");
          const verdicts = store.scan("agent");
          if (verdicts.length === 0) return { ok: false, error: "Nothing analyzed yet." };
          return { ok: true, ...summarise(verdicts) };
        },
      },
      {
        name: "forge_get_findings",
        description:
          "Return the security findings raised so far, optionally filtered to a severity " +
          "of high, medium or low.",
        inputSchema: {
          type: "object",
          properties: {
            severity: { type: "string", description: "high | medium | low" },
          },
        },
        annotations: { readOnlyHint: true },
        execute: async (input) => {
          const wanted = typeof input.severity === "string" ? input.severity : null;
          const findings = store
            .getSnapshot()
            .verdicts.flatMap((verdict) => verdict.findings)
            .filter((finding) => !wanted || finding.severity === wanted);
          return {
            ok: true,
            count: findings.length,
            findings: findings.map((finding) => ({
              tool: finding.tool,
              check: finding.check,
              severity: finding.severity,
              phase: finding.phase,
              title: finding.title,
              evidence: finding.evidence,
              remediation: finding.remediation,
            })),
          };
        },
      },
      {
        name: "forge_run_agent_validation",
        description:
          "Execute the generated tools against the live storefront and report what they " +
          "actually did. Mode 'unguarded' follows instructions found in tool descriptions; " +
          "mode 'guarded' refuses blocked tools and ignores metadata directives.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", description: "unguarded | guarded" },
          },
          required: ["mode"],
        },
        execute: async (input) => {
          const mode = input.mode === "guarded" ? "guarded" : "unguarded";
          store.note("agent", `Agent started the ${mode} validation run`);
          const steps = await store.validate(mode, "agent");
          if (!steps) return { ok: false, error: "Nothing analyzed yet." };
          return {
            ok: true,
            mode,
            steps: steps.map((step) => ({
              tool: step.tool,
              status: step.status,
              summary: step.summary,
            })),
            findings: summarise(store.getSnapshot().verdicts),
          };
        },
      },
      {
        name: "forge_export_integration",
        description:
          "Return the generated WebMCP integration source for the analyzed repository. " +
          "Tools blocked by the scan are commented out with the finding attached.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
          const { manifest, verdicts } = store.getSnapshot();
          if (!manifest) return { ok: false, error: "Nothing analyzed yet." };
          store.note("agent", "Agent exported the integration source");
          return { ok: true, filename: "webmcp-tools.js", source: generateIntegration(manifest, verdicts) };
        },
      },
    ];

    return registerTools(tools);
  }, []);
}
