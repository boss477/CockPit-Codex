import type { Finding, GeneratedTool, ObservedRequest } from "../types";
import { checkObservedEgress, checkObservedMutation } from "./rules";

export interface GateResult {
  allowed: boolean;
  status?: number;
  body?: unknown;
  request: ObservedRequest;
  findings: Finding[];
}

/**
 * Every generated tool routes its network access through this gate instead of
 * calling fetch directly. That buys two things a static scan cannot have: the
 * request a tool actually made, and the ability to refuse it.
 *
 * `allowedOrigins` is the declared execution target — a mock server on
 * :4010, or a local app the operator is running. Those are cross-origin but
 * they are where the tools are *supposed* to go, so they are sent and marked
 * as the declared target. Everything else cross-origin is still refused, which
 * is what catches an exfiltration the tool metadata asked for.
 */
export class PolicyGate {
  readonly observed: ObservedRequest[] = [];
  readonly findings: Finding[] = [];
  private readonly allowed: Set<string>;

  constructor(
    private readonly selfOrigin: string,
    private readonly enforce = true,
    allowedOrigins: string[] = [],
  ) {
    this.allowed = new Set(
      allowedOrigins
        .map((entry) => {
          try {
            return new URL(/^https?:\/\//i.test(entry) ? entry : `http://${entry}`).origin;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is string => Boolean(entry)),
    );
  }

  /** True when a URL points at the declared execution target. */
  isDeclaredTarget(url: string): boolean {
    try {
      const resolved = new URL(url, this.selfOrigin);
      if (resolved.origin === new URL(this.selfOrigin).origin) return true;
      return this.allowed.has(resolved.origin);
    } catch {
      return false;
    }
  }

  private record(
    tool: string,
    method: string,
    url: string,
    body: Record<string, unknown> | undefined,
  ): ObservedRequest {
    let crossOrigin = false;
    try {
      crossOrigin = new URL(url, this.selfOrigin).origin !== new URL(this.selfOrigin).origin;
    } catch {
      crossOrigin = true;
    }

    const declaredTarget = this.isDeclaredTarget(url);

    const request: ObservedRequest = {
      tool,
      method,
      url,
      crossOrigin,
      declaredTarget,
      outcome: crossOrigin && !declaredTarget && this.enforce ? "blocked" : "sent",
      bodyKeys: body ? Object.keys(body) : [],
      at: Date.now(),
    };
    this.observed.push(request);
    return request;
  }

  private addFindings(findings: Finding[]): Finding[] {
    this.findings.push(...findings);
    return findings;
  }

  async send(
    tool: GeneratedTool | { name: string },
    method: string,
    url: string,
    body?: Record<string, unknown>,
  ): Promise<GateResult> {
    const request = this.record(tool.name, method, url, body);

    // Cross-origin, and not the target we said we would call: this is egress.
    if (request.crossOrigin && !request.declaredTarget) {
      const findings = this.addFindings(checkObservedEgress(tool.name, request));
      if (this.enforce) {
        return { allowed: false, request, findings };
      }
    }

    const response = await fetch(new URL(url, this.selfOrigin).toString(), {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    const findings: Finding[] = [];
    if ("annotations" in tool) {
      findings.push(...checkObservedMutation(tool, request, parsed));
    }
    this.addFindings(findings);

    return { allowed: true, status: response.status, body: parsed, request, findings };
  }
}
