import type { Finding, ToolManifest, ToolVerdict, Verdict } from "../types";
import { runStaticChecks } from "./rules";

function verdictFor(findings: Finding[]): Verdict {
  return findings.some((finding) => finding.severity === "high") ? "blocked" : "verified";
}

/** Static pass over the whole manifest. Runs before any tool executes. */
export function scanManifest(manifest: ToolManifest, selfOrigin: string): ToolVerdict[] {
  return manifest.tools.map((tool) => {
    const findings = runStaticChecks(tool, selfOrigin);
    return { tool: tool.name, verdict: verdictFor(findings), findings };
  });
}

/**
 * Folds findings produced while tools were executing back into the verdicts.
 * A tool can pass the static pass and still be blocked here.
 */
export function mergeRuntimeFindings(
  verdicts: ToolVerdict[],
  runtime: Finding[],
): ToolVerdict[] {
  return verdicts.map((entry) => {
    const extra = runtime.filter(
      (finding) =>
        finding.tool === entry.tool &&
        !entry.findings.some((existing) => existing.evidence === finding.evidence),
    );
    if (extra.length === 0) return entry;

    // A confirmed runtime mutation supersedes the static "may mutate" warning.
    const superseded = entry.findings.filter(
      (finding) =>
        !(
          finding.check === "readonly-mismatch" &&
          finding.phase === "static" &&
          extra.some((added) => added.check === "readonly-mismatch")
        ),
    );

    const findings = [...superseded, ...extra];
    return { tool: entry.tool, verdict: verdictFor(findings), findings };
  });
}

export function summarise(verdicts: ToolVerdict[]) {
  const high = verdicts.flatMap((v) => v.findings).filter((f) => f.severity === "high");
  const medium = verdicts.flatMap((v) => v.findings).filter((f) => f.severity === "medium");
  return {
    total: verdicts.length,
    verified: verdicts.filter((v) => v.verdict === "verified").length,
    blocked: verdicts.filter((v) => v.verdict === "blocked").length,
    high: high.length,
    medium: medium.length,
  };
}
