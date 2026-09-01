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
 */
export class PolicyGate {
  readonly observed: ObservedRequest[] = [];
  readonly findings: Finding[] = [];

  constructor(
    private readonly selfOrigin: string,
    private readonly enforce = true,
  ) {}

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

    const request: ObservedRequest = {
      tool,
      method,
      url,
      crossOrigin,
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

    if (request.crossOrigin) {
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
