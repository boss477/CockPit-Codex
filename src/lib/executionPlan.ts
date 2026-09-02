import type { ExecutionPlan, InputKind, MockSpec, ToolSource } from "./types";
import { buildMockSpec } from "./mock/spec";

/**
 * Decides which of the three tiers an analyzed target qualifies for.
 *
 *   input -> tools -> SCAN (always runs)
 *                       |
 *             executable target available?
 *              |- repo   -> run the app you already have
 *              |- spec   -> generate a mock target and point at that
 *              '- live   -> scan only, VALIDATE disabled with a reason
 *
 * The rule the whole thing rests on: we never fire a generated request at a
 * host we do not own. A third-party live site gets the scan and nothing else.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export function isLocalTarget(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return true;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    const host = url.hostname.toLowerCase();
    return (
      LOCAL_HOSTS.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

export function portOf(value: string): number | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function originOf(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`).origin;
  } catch {
    return null;
  }
}

export interface PlanInput {
  inputKind: InputKind;
  /** True for the bundled storefront, whose routes are served by this app. */
  bundledDemo?: boolean;
  sources: ToolSource[];
  label: string;
  /** What the operator typed under Execution Settings. Empty means "not set". */
  executionBaseUrl?: string | null;
  /**
   * A live URL only becomes executable through a contract we fetched from it —
   * and then only against a mock, never against the site.
   */
  liveContractFound?: boolean;
}

export interface PlanResult {
  plan: ExecutionPlan;
  mockSpec: MockSpec | null;
}

export function resolveExecutionPlan(input: PlanInput): PlanResult {
  const { inputKind, sources, label } = input;
  const baseUrlSetting = (input.executionBaseUrl ?? "").trim();
  const hasLocalBaseUrl = isLocalTarget(baseUrlSetting);

  if (sources.length === 0) {
    return {
      plan: {
        tier: "scan-only",
        executable: false,
        baseUrl: "",
        reason: "No capabilities were discovered, so there is nothing to execute.",
        allowedOrigins: [],
      },
      mockSpec: null,
    };
  }

  // Tier 3 — the bundled storefront is this app. Its routes are real and ours.
  if (input.bundledDemo) {
    return {
      plan: {
        tier: "local-app",
        executable: true,
        baseUrl: "",
        reason:
          "The analyzed app is the storefront running in this deployment, so the " +
          "generated tools call its real routes.",
        allowedOrigins: [],
      },
      mockSpec: null,
    };
  }

  // Tier 3 — an app the operator is running themselves and pointed us at.
  if (hasLocalBaseUrl && inputKind === "github") {
    const origin = originOf(baseUrlSetting);
    return {
      plan: {
        tier: "local-app",
        executable: true,
        baseUrl: baseUrlSetting.replace(/\/$/, ""),
        reason: `Executing against the app you are running at ${baseUrlSetting}.`,
        allowedOrigins: origin ? [origin] : [],
      },
      mockSpec: null,
    };
  }

  const liveIsScanOnly = inputKind === "live" && !input.liveContractFound;

  // Tier 1 — a third-party site. Scanned, never called.
  if (liveIsScanOnly) {
    return {
      plan: {
        tier: "scan-only",
        executable: false,
        baseUrl: "",
        reason:
          `${label} is a live site we do not own, and no contract was published that ` +
          `a mock could be generated from. The scan runs; VALIDATE stays disabled ` +
          `rather than firing generated requests at someone's production server.`,
        allowedOrigins: [],
      },
      mockSpec: null,
    };
  }

  // Tier 2 — generate a target from the same contract the tools came from.
  const mockSpec = buildMockSpec(sources, label);

  // An external mock the operator started themselves, e.g. Prism on :4010.
  if (hasLocalBaseUrl) {
    const origin = originOf(baseUrlSetting);
    const port = portOf(baseUrlSetting);
    return {
      plan: {
        tier: "mock-target",
        executable: true,
        baseUrl: baseUrlSetting.replace(/\/$/, ""),
        reason:
          `Executing against the mock server you are running at ${baseUrlSetting} ` +
          `(e.g. prism mock, started from this same contract).`,
        allowedOrigins: origin ? [origin] : [],
        mock: {
          provider: "prism",
          baseUrl: baseUrlSetting.replace(/\/$/, ""),
          port,
          operations: mockSpec.operations.length,
          label,
        },
      },
      mockSpec,
    };
  }

  const builtinBaseUrl = `/api/mock/${mockSpec.id}`;
  return {
    plan: {
      tier: "mock-target",
      executable: true,
      baseUrl: builtinBaseUrl,
      reason:
        inputKind === "live"
          ? `${label} publishes a contract, so a mock target was generated from it. ` +
            `Requests go to that mock; ${label} itself is never called.`
          : `No running app for ${label}, so a mock target was generated from its ` +
            `contract. It validates requests against the declared schemas.`,
      allowedOrigins: [],
      mock: {
        provider: "builtin",
        baseUrl: builtinBaseUrl,
        port: null,
        operations: mockSpec.operations.length,
        label,
      },
    },
    mockSpec,
  };
}

/** Short label for the badge next to the validation panel. */
export function planBadge(plan: ExecutionPlan | null): string {
  if (!plan) return "NO TARGET";
  if (plan.tier === "scan-only") return "SCAN ONLY";
  if (plan.tier === "local-app") return "LOCAL APP";
  if (plan.mock?.provider === "prism") {
    return plan.mock.port ? `MOCK TARGET :${plan.mock.port}` : "MOCK TARGET";
  }
  return "MOCK TARGET (built-in)";
}
