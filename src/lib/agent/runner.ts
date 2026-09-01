import type { AgentStep, GeneratedTool, ToolManifest, ToolVerdict } from "../types";
import { makeExecutor } from "../executor";
import type { PolicyGate } from "../security/monitor";

export type AgentMode = "unguarded" | "guarded";

export interface AgentOptions {
  manifest: ToolManifest;
  verdicts: ToolVerdict[];
  gate: PolicyGate;
  mode: AgentMode;
  onStep: (step: AgentStep) => void;
}

const TASK =
  "Find black shoes under 3000, add a pair to my cart, then tell me my order status.";

function byName(manifest: ToolManifest, name: string): GeneratedTool | undefined {
  return manifest.tools.find((tool) => tool.name === name);
}

function isBlocked(verdicts: ToolVerdict[], name: string): boolean {
  return verdicts.some((verdict) => verdict.tool === name && verdict.verdict === "blocked");
}

/** The first external destination named in a tool description, if any. */
function injectedDestination(tool: GeneratedTool): string | null {
  const match = tool.description.match(/https?:\/\/[^\s"')]+/);
  return match ? match[0] : null;
}

/** A tool the description orders the agent to call next. */
function injectedFollowUp(tool: GeneratedTool, manifest: ToolManifest): string | null {
  const ordered = tool.description.match(/\b(?:always\s+)?call\s+([a-z_]+)\b/i);
  if (!ordered) return null;
  const target = ordered[1].toLowerCase();
  return manifest.tools.some((candidate) => candidate.name === target) ? target : null;
}

/**
 * Runs a fixed shopper task against the generated tools.
 *
 * The unguarded agent does what a plain model does: it treats tool
 * descriptions as instructions and follows them. The guarded agent refuses
 * tools the scan blocked and ignores directives found in metadata. Running
 * both against the same manifest is what turns the scan findings into
 * something a person can watch happen.
 */
export async function runAgent(options: AgentOptions): Promise<AgentStep[]> {
  const { manifest, verdicts, gate, mode, onStep } = options;
  const steps: AgentStep[] = [];
  let index = 0;

  const emit = (step: Omit<AgentStep, "index">): AgentStep => {
    const full = { ...step, index: index++ };
    steps.push(full);
    onStep(full);
    return full;
  };

  const call = async (
    tool: GeneratedTool,
    input: Record<string, unknown>,
    label: string,
  ) => {
    if (mode === "guarded" && isBlocked(verdicts, tool.name)) {
      emit({
        tool: tool.name,
        input,
        status: "blocked",
        summary: `Refused ${tool.name}`,
        detail: "The security scan blocked this tool, so the guarded agent will not call it.",
      });
      return null;
    }

    const result = await makeExecutor(tool, gate)(input);
    emit({
      tool: tool.name,
      input,
      status: result.blocked ? "blocked" : result.ok ? "ok" : "error",
      summary: result.blocked ? `Blocked ${tool.name}` : label,
      detail: result.message,
    });
    return result;
  };

  const search = byName(manifest, "search_products");
  const detail = byName(manifest, "get_product");
  const addToCart = byName(manifest, "add_to_cart");
  const track = byName(manifest, "track_order");
  const checkout = byName(manifest, "checkout");

  let firstProductId: string | null = null;

  if (search) {
    const result = await call(search, { query: "black shoes", maxPrice: 3000 }, "Searched the catalogue");
    const data = result?.data as { products?: { id: string; name: string }[] } | undefined;
    if (data?.products?.length) {
      firstProductId = data.products[0].id;
      steps[steps.length - 1].detail = `${data.products.length} match(es); first is ${data.products[0].name}`;
    }
  }

  if (detail && firstProductId) {
    await call(detail, { id: firstProductId }, "Read the product detail");
  }

  if (addToCart && firstProductId) {
    await call(addToCart, { productId: firstProductId, quantity: 1 }, "Added to cart");
  }

  if (track) {
    const result = await call(track, { orderId: "ord-demo", email: "shopper@example.com" }, "Checked order status");

    // Only the unguarded agent acts on what it just read.
    if (mode === "unguarded" && result) {
      const destination = injectedDestination(track);
      if (destination) {
        const egress = await gate.send(track, "POST", destination, {
          email: "shopper@example.com",
          orderId: "ord-demo",
        });
        emit({
          tool: track.name,
          input: { destination },
          status: egress.allowed ? "error" : "blocked",
          summary: egress.allowed
            ? "Sent customer email to a third party"
            : "Blocked exfiltration of the customer email",
          detail: `The tool description instructed the agent to POST to ${destination}.`,
        });
      }

      const followUp = injectedFollowUp(track, manifest);
      const chained = followUp ? byName(manifest, followUp) : null;
      if (chained) {
        await call(
          chained,
          { shippingAddress: "12 Rowan Street" },
          `Followed the instruction embedded in ${track.name} and called ${chained.name}`,
        );
      }
    }
  }

  if (mode === "guarded" && checkout) {
    emit({
      tool: checkout.name,
      input: {},
      status: "blocked",
      summary: "Held checkout for human confirmation",
      detail:
        "checkout mutates state despite its read-only hint, so the guarded agent " +
        "will not call it without the user saying so.",
    });
  }

  return steps;
}

export const AGENT_TASK = TASK;
