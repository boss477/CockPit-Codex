import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, discoverCapabilities, generateTool } from "../src/lib/analyzer";
import { DEMO_REPO_FILES, DEMO_REPO_LABEL, DEMO_REPO_URL } from "../src/lib/fixtures/demoRepo";
import { buildRequest } from "../src/lib/executor";
import { generateIntegration } from "../src/lib/codegen";
import { scanManifest } from "../src/lib/security/scan";

describe("Tool Manifest & WebMCP Registration Pipeline", () => {
  test("Capability discovery: discovers 5 Next.js route capabilities from demo repo", () => {
    const capabilities = discoverCapabilities(DEMO_REPO_FILES);
    assert.equal(capabilities.length, 5);

    const methodsAndPaths = capabilities.map((c) => `${c.method} ${c.path}`);
    assert.ok(methodsAndPaths.includes("GET /api/products"));
    assert.ok(methodsAndPaths.includes("GET /api/products/{id}"));
    assert.ok(methodsAndPaths.includes("POST /api/cart"));
    assert.ok(methodsAndPaths.includes("POST /api/checkout"));
    assert.ok(methodsAndPaths.includes("GET /api/orders/track"));
  });

  test("Tool generation: produces valid WebMCP tool definitions with schemas and endpoints", () => {
    const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
    assert.equal(manifest.tools.length, 5);

    const toolNames = manifest.tools.map((t) => t.name);
    assert.deepEqual(toolNames, [
      "search_products",
      "get_product",
      "add_to_cart",
      "checkout",
      "track_order",
    ]);

    // Check search_products tool schema
    const searchTool = manifest.tools.find((t) => t.name === "search_products");
    assert.ok(searchTool);
    assert.equal(searchTool?.annotations.readOnlyHint, true);
    assert.equal(searchTool?.endpoint.method, "GET");
    assert.equal(searchTool?.endpoint.path, "/api/products");
    assert.ok("query" in searchTool.inputSchema.properties);
    assert.ok("maxPrice" in searchTool.inputSchema.properties);

    // Check checkout tool (intentional demo vulnerability: POST but readOnlyHint: true from doc prose)
    const checkoutTool = manifest.tools.find((t) => t.name === "checkout");
    assert.ok(checkoutTool);
    assert.equal(checkoutTool?.endpoint.method, "POST");
    assert.equal(checkoutTool?.annotations.readOnlyHint, true);

    // Check track_order tool
    const trackTool = manifest.tools.find((t) => t.name === "track_order");
    assert.ok(trackTool);
    assert.equal(trackTool?.endpoint.method, "GET");
    assert.ok(trackTool.description.includes("analytics-partner.example"));
  });

  test("Request builder: converts tool input into correct HTTP method, path, query and body", () => {
    const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
    
    // Path parameter test: get_product
    const getProductTool = manifest.tools.find((t) => t.name === "get_product")!;
    const getReq = buildRequest(getProductTool, { id: "p-101" });
    assert.equal(getReq.method, "GET");
    assert.equal(getReq.url, "/api/products/p-101");
    assert.equal(getReq.body, undefined);

    // Query parameter test: search_products
    const searchTool = manifest.tools.find((t) => t.name === "search_products")!;
    const searchReq = buildRequest(searchTool, { query: "shoes", maxPrice: 3000 });
    assert.equal(searchReq.method, "GET");
    assert.ok(searchReq.url.includes("/api/products?"));
    assert.ok(searchReq.url.includes("query=shoes"));
    assert.ok(searchReq.url.includes("maxPrice=3000"));

    // Body parameter test: add_to_cart
    const addTool = manifest.tools.find((t) => t.name === "add_to_cart")!;
    const addReq = buildRequest(addTool, { productId: "p-101", quantity: 2 });
    assert.equal(addReq.method, "POST");
    assert.equal(addReq.url, "/api/cart");
    assert.deepEqual(addReq.body, { productId: "p-101", quantity: 2 });
  });

  test("Integration code generation: exports valid JavaScript with document.modelContext registration", () => {
    const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
    const verdicts = scanManifest(manifest, "http://localhost:3000");

    const source = generateIntegration(manifest, verdicts);
    assert.ok(source.includes("export function registerGeneratedTools()"));
    assert.ok(source.includes("document.modelContext"));
    assert.ok(source.includes("modelContext.registerTool"));
    assert.ok(source.includes("search_products"));
    assert.ok(source.includes("WITHHELD by the security scan"));
  });
});
