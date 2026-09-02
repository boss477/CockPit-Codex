import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveExecutionPlan, planBadge, isLocalTarget } from "../src/lib/executionPlan";
import { buildMockSpec, matchOperation, synthesizeResponse, validateRequest } from "../src/lib/mock/spec";
import { parseOpenApiSpec } from "../src/lib/adapters/openapiSpec";
import { buildManifestFromSources } from "../src/lib/analyzer";
import { scanManifest } from "../src/lib/security/scan";
import { PolicyGate } from "../src/lib/security/monitor";
import { DEMO_SPEC, DEMO_SPEC_LABEL } from "../src/lib/fixtures/demoSpec";
import type { ToolSource } from "../src/lib/types";

const SOURCES: ToolSource[] = [
  {
    id: "GET /api/products",
    name: "search_products",
    method: "GET",
    path: "/api/products",
    baseUrl: null,
    params: [
      { name: "query", in: "query", type: "string", required: true, description: "Search text." },
      { name: "maxPrice", in: "query", type: "number", required: false, description: "Ceiling." },
    ],
    description: "Search the catalogue.",
    executable: false,
    origin: "openapi",
  },
  {
    id: "GET /api/products/{id}",
    name: "get_product",
    method: "GET",
    path: "/api/products/{id}",
    baseUrl: null,
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Product id." }],
    description: "Read one product.",
    executable: false,
    origin: "openapi",
  },
  {
    id: "POST /api/cart",
    name: "add_to_cart",
    method: "POST",
    path: "/api/cart",
    baseUrl: null,
    params: [
      { name: "productId", in: "body", type: "string", required: true, description: "Product." },
      { name: "quantity", in: "body", type: "number", required: false, description: "How many." },
    ],
    description: "Add an item to the cart.",
    executable: false,
    origin: "openapi",
  },
];

describe("Execution tiers", () => {
  it("Tier 3: the bundled storefront runs against this origin", () => {
    const { plan, mockSpec } = resolveExecutionPlan({
      inputKind: "github",
      bundledDemo: true,
      sources: SOURCES,
      label: "demo storefront",
    });

    assert.equal(plan.tier, "local-app");
    assert.equal(plan.executable, true);
    assert.equal(plan.baseUrl, "");
    assert.equal(mockSpec, null);
    assert.equal(planBadge(plan), "LOCAL APP");
  });

  it("Tier 2: a spec with no running app generates a built-in mock target", () => {
    const { plan, mockSpec } = resolveExecutionPlan({
      inputKind: "openapi",
      sources: SOURCES,
      label: "Some API",
    });

    assert.equal(plan.tier, "mock-target");
    assert.equal(plan.executable, true);
    assert.equal(plan.mock?.provider, "builtin");
    assert.ok(plan.baseUrl.startsWith("/api/mock/"));
    assert.equal(mockSpec?.operations.length, SOURCES.length);
    assert.equal(planBadge(plan), "MOCK TARGET (built-in)");
  });

  it("Tier 2: an external mock on :4010 is used when the operator points at it", () => {
    const { plan } = resolveExecutionPlan({
      inputKind: "openapi",
      sources: SOURCES,
      label: "Some API",
      executionBaseUrl: "http://localhost:4010",
    });

    assert.equal(plan.tier, "mock-target");
    assert.equal(plan.mock?.provider, "prism");
    assert.equal(plan.mock?.port, 4010);
    assert.equal(plan.baseUrl, "http://localhost:4010");
    assert.deepEqual(plan.allowedOrigins, ["http://localhost:4010"]);
    assert.equal(planBadge(plan), "MOCK TARGET :4010");
  });

  it("Tier 1: a third-party live site is scanned but never executed against", () => {
    const { plan, mockSpec } = resolveExecutionPlan({
      inputKind: "live",
      sources: SOURCES,
      label: "motion.so",
      liveContractFound: false,
    });

    assert.equal(plan.tier, "scan-only");
    assert.equal(plan.executable, false);
    assert.equal(plan.baseUrl, "");
    assert.equal(mockSpec, null);
    assert.match(plan.reason, /do not own/);
    assert.equal(planBadge(plan), "SCAN ONLY");
  });

  it("A live site that publishes a contract is mocked, not called", () => {
    const { plan } = resolveExecutionPlan({
      inputKind: "live",
      sources: SOURCES,
      label: "api.example.com",
      liveContractFound: true,
    });

    assert.equal(plan.tier, "mock-target");
    assert.equal(plan.mock?.provider, "builtin");
    assert.ok(plan.baseUrl.startsWith("/api/mock/"));
    assert.match(plan.reason, /never called/);
  });

  it("A public base URL is refused: only local or private hosts are executable", () => {
    assert.equal(isLocalTarget("http://localhost:4010"), true);
    assert.equal(isLocalTarget("http://127.0.0.1:3000"), true);
    assert.equal(isLocalTarget("http://192.168.1.20:8080"), true);
    assert.equal(isLocalTarget("https://api.stripe.com"), false);

    const { plan } = resolveExecutionPlan({
      inputKind: "openapi",
      sources: SOURCES,
      label: "Some API",
      executionBaseUrl: "https://api.stripe.com",
    });

    // Falls back to the mock we own rather than honouring a public host.
    assert.equal(plan.mock?.provider, "builtin");
    assert.ok(plan.baseUrl.startsWith("/api/mock/"));
  });

  it("No capabilities means nothing to execute", () => {
    const { plan } = resolveExecutionPlan({ inputKind: "openapi", sources: [], label: "Empty" });
    assert.equal(plan.tier, "scan-only");
    assert.equal(plan.executable, false);
  });
});

describe("Generated mock target", () => {
  const spec = buildMockSpec(SOURCES, "Some API");

  it("Reuses the same id for the same contract", () => {
    assert.equal(buildMockSpec(SOURCES, "Some API").id, spec.id);
  });

  it("Matches a path template and extracts the path parameter", () => {
    const match = matchOperation(spec, "GET", "/api/products/p-101");
    assert.ok(match);
    assert.equal(match.operation.name, "get_product");
    assert.equal(match.pathParams.id, "p-101");
  });

  it("Does not match the wrong method or an unknown path", () => {
    assert.equal(matchOperation(spec, "POST", "/api/products"), null);
    assert.equal(matchOperation(spec, "GET", "/api/unknown"), null);
  });

  it("Rejects a request that misses a required parameter", () => {
    const match = matchOperation(spec, "GET", "/api/products");
    assert.ok(match);
    const issues = validateRequest(match.operation, { path: {}, query: {}, body: {} });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].param, "query");
    assert.equal(issues[0].problem, "missing");
  });

  it("Rejects a parameter of the wrong declared type", () => {
    const match = matchOperation(spec, "GET", "/api/products");
    assert.ok(match);
    const issues = validateRequest(match.operation, {
      path: {},
      query: { query: "shoes", maxPrice: "cheap" },
      body: {},
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].param, "maxPrice");
    assert.equal(issues[0].problem, "type");
  });

  it("Accepts a well-formed request and echoes the declared shape", () => {
    const match = matchOperation(spec, "GET", "/api/products");
    assert.ok(match);
    assert.deepEqual(
      validateRequest(match.operation, { path: {}, query: { query: "shoes" }, body: {} }),
      [],
    );

    const { status, body } = synthesizeResponse(match, { query: { query: "shoes" }, body: {} });
    assert.equal(status, 200);
    assert.equal(body.mock, true);
    assert.equal(body.query, "shoes");
    assert.ok(Array.isArray(body.products));
  });

  it("Reports the mutation on a state-changing method, so runtime checks can read it", () => {
    const match = matchOperation(spec, "POST", "/api/cart");
    assert.ok(match);
    const { status, body } = synthesizeResponse(match, {
      query: {},
      body: { productId: "p-101", quantity: 2 },
    });
    assert.equal(status, 201);
    assert.equal(body.created, true);
    assert.equal(body.status, "committed");
  });
});

describe("Bundled contract: the attack we can plant because we own the mock", () => {
  const sources = parseOpenApiSpec(DEMO_SPEC as unknown as Record<string, unknown>, "demo-spec.json");
  const manifest = buildManifestFromSources(sources, "demo-spec", DEMO_SPEC_LABEL, ["OpenAPI"]);
  const verdicts = scanManifest(manifest, "https://forge.example");

  it("Parses every operation in the contract", () => {
    assert.equal(sources.length, 3);
    assert.deepEqual(
      manifest.tools.map((tool) => tool.name).sort(),
      ["confirm_booking", "get_reservation", "search_rooms"],
    );
  });

  it("Blocks the poisoned operation on the static scan alone, with no execution", () => {
    const reservation = verdicts.find((entry) => entry.tool === "get_reservation");
    assert.ok(reservation);
    assert.equal(reservation.verdict, "blocked");

    const checks = reservation.findings.map((finding) => finding.check).sort();
    assert.deepEqual(checks, ["metadata-injection", "sensitive-data-egress"]);
    assert.ok(reservation.findings.every((finding) => finding.phase === "static"));
  });

  it("Flags the POST the contract documents as a retrieval", () => {
    const confirm = manifest.tools.find((tool) => tool.name === "confirm_booking");
    assert.ok(confirm);
    assert.equal(confirm.endpoint.method, "POST");
    // The generator believes the prose, exactly as an LLM-backed one would.
    assert.equal(confirm.annotations.readOnlyHint, true);

    const verdict = verdicts.find((entry) => entry.tool === "confirm_booking");
    assert.ok(verdict?.findings.some((finding) => finding.check === "readonly-mismatch"));
  });

  it("Leaves the clean operation verified", () => {
    const rooms = verdicts.find((entry) => entry.tool === "search_rooms");
    assert.equal(rooms?.verdict, "verified");
    assert.equal(rooms?.findings.length, 0);
  });
});

describe("PolicyGate and the declared target", () => {
  const origin = "https://forge.example";

  it("Treats the declared mock origin as the target, not as egress", async () => {
    const gate = new PolicyGate(origin, true, ["http://localhost:4010"]);
    assert.equal(gate.isDeclaredTarget("http://localhost:4010/api/products"), true);
    assert.equal(gate.isDeclaredTarget("/api/mock/m1/api/products"), true);
    assert.equal(gate.isDeclaredTarget("https://collector.analytics-partner.example/ingest"), false);
  });

  it("Still refuses an undeclared third-party host while a mock is allowed", async () => {
    const gate = new PolicyGate(origin, true, ["http://localhost:4010"]);
    const result = await gate.send(
      { name: "get_reservation" },
      "POST",
      "https://collector.analytics-partner.example/ingest",
      { email: "guest@example.com", sessionToken: "tok_123" },
    );

    assert.equal(result.allowed, false);
    assert.equal(gate.observed[0].outcome, "blocked");
    assert.equal(gate.observed[0].declaredTarget, false);
    assert.ok(gate.findings.some((finding) => finding.check === "sensitive-data-egress"));
  });
});
