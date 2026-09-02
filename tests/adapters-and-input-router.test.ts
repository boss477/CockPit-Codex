import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { resolveInput } from "../src/lib/inputRouter";
import {
  extractToolSourcesFromFiles,
  nextAppRouterAdapter,
  nextPagesRouterAdapter,
  expressAdapter,
  fastapiAdapter,
  flaskAdapter,
} from "../src/lib/adapters";
import { parseOpenApiSpec } from "../src/lib/adapters/openapiSpec";
import { auditLiveUrl } from "../src/lib/liveAuditor";
import { extractUniversalRepoTools } from "../src/lib/universalRepoAnalyzer";
import { buildManifest } from "../src/lib/analyzer";
import { DEMO_REPO_FILES, DEMO_REPO_LABEL, DEMO_REPO_URL } from "../src/lib/fixtures/demoRepo";
import type { FileTree } from "../src/lib/types";

describe("Input Router (resolveInput)", () => {
  test("resolves github repository URLs", () => {
    assert.equal(resolveInput("https://github.com/owner/repo"), "github");
    assert.equal(resolveInput("https://github.com/owner/repo.git"), "github");
    assert.equal(resolveInput("github.com/owner/repo"), "github");
    assert.equal(resolveInput("owner/repo"), "github");
    assert.equal(resolveInput(""), "github");
  });

  test("resolves OpenAPI / Swagger URLs", () => {
    assert.equal(resolveInput("https://example.com/openapi.json"), "openapi");
    assert.equal(resolveInput("https://example.com/swagger.yaml"), "openapi");
    assert.equal(resolveInput("https://petstore.swagger.io/v2/swagger.json"), "openapi");
    assert.equal(resolveInput("https://api.example.com/v3/openapi.yml?key=123"), "openapi");
  });

  test("resolves live web URLs", () => {
    assert.equal(resolveInput("https://motion.so/agent"), "live");
    assert.equal(resolveInput("https://example.com/store"), "live");
    assert.equal(resolveInput("http://localhost:3000"), "live");
    assert.equal(resolveInput("https://web.whatsapp.com/"), "live");
  });
});

describe("Framework Adapters Extraction", () => {
  test("Next.js App Router adapter extracts demo storefront verbatim", () => {
    assert.ok(nextAppRouterAdapter.detect(DEMO_REPO_FILES));
    const tools = nextAppRouterAdapter.extract(DEMO_REPO_FILES);
    assert.equal(tools.length, 5);

    const names = tools.map((t) => t.name);
    assert.deepEqual(names, [
      "search_products",
      "get_product",
      "add_to_cart",
      "checkout",
      "track_order",
    ]);

    const manifest = buildManifest(DEMO_REPO_FILES, DEMO_REPO_URL, DEMO_REPO_LABEL);
    assert.equal(manifest.tools.length, 5);
    assert.deepEqual(
      manifest.tools.map((t) => t.name),
      ["search_products", "get_product", "add_to_cart", "checkout", "track_order"],
    );
  });

  test("Next.js Pages Router adapter extracts pages/api routes", () => {
    const pagesFiles: FileTree = [
      {
        path: "pages/api/users/[id].ts",
        content: `/**
 * Fetch a user profile by user ID.
 */
export default async function handler(req: any, res: any) {
  const { id } = req.query;
  res.json({ id });
}`,
      },
      {
        path: "pages/api/orders.ts",
        content: `/**
 * Place a new order.
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'POST') {
    const { item, quantity } = req.body;
    res.json({ ok: true });
  } else {
    const { status } = req.query;
    res.json([]);
  }
}`,
      },
    ];

    assert.ok(nextPagesRouterAdapter.detect(pagesFiles));
    const tools = nextPagesRouterAdapter.extract(pagesFiles);
    assert.equal(tools.length, 3);

    const userTool = tools.find((t) => t.path === "/api/users/{id}");
    assert.ok(userTool);
    assert.equal(userTool?.method, "GET");
    assert.ok(userTool?.params.some((p) => p.name === "id" && p.in === "path"));

    const postOrderTool = tools.find((t) => t.path === "/api/orders" && t.method === "POST");
    assert.ok(postOrderTool);
    assert.ok(postOrderTool?.params.some((p) => p.name === "item" && p.in === "body"));
  });

  test("Express adapter extracts routes from express app/router", () => {
    const expressFiles: FileTree = [
      {
        path: "src/routes/users.js",
        content: `const express = require('express');
const router = express.Router();

/**
 * List all registered users.
 */
router.get('/api/users', (req, res) => {
  const limit = req.query.limit;
  res.json([]);
});

/**
 * Create a new user account.
 */
router.post('/api/users', (req, res) => {
  const { username, email } = req.body;
  res.status(201).json({ id: 1 });
});

module.exports = router;`,
      },
    ];

    assert.ok(expressAdapter.detect(expressFiles));
    const tools = expressAdapter.extract(expressFiles);
    assert.equal(tools.length, 2);

    const listTool = tools.find((t) => t.method === "GET");
    assert.equal(listTool?.name, "list_users");
    assert.ok(listTool?.params.some((p) => p.name === "limit" && p.in === "query"));

    const createTool = tools.find((t) => t.method === "POST");
    assert.equal(createTool?.name, "create_user");
    assert.ok(createTool?.params.some((p) => p.name === "username" && p.in === "body"));
  });

  test("FastAPI adapter extracts routes and python docstrings", () => {
    const fastapiFiles: FileTree = [
      {
        path: "app/main.py",
        content: `from fastapi import FastAPI, Query
from typing import Optional
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: Optional[str] = None):
    """
    Retrieve item details by ID.
    """
    return {"item_id": item_id, "q": q}

@app.post("/items")
async def create_item(item: Item):
    """
    Create a new inventory item.
    """
    return item
`,
      },
    ];

    assert.ok(fastapiAdapter.detect(fastapiFiles));
    const tools = fastapiAdapter.extract(fastapiFiles);
    assert.equal(tools.length, 2);

    const getTool = tools.find((t) => t.method === "GET");
    assert.equal(getTool?.path, "/items/{item_id}");
    assert.equal(getTool?.name, "get_item");
    assert.ok(getTool?.description.includes("Retrieve item details"));
    assert.ok(getTool?.params.some((p) => p.name === "item_id" && p.in === "path"));
    assert.ok(getTool?.params.some((p) => p.name === "q" && p.in === "query"));

    const postTool = tools.find((t) => t.method === "POST");
    assert.equal(postTool?.path, "/items");
    assert.equal(postTool?.name, "create_item");
    assert.ok(postTool?.params.some((p) => p.name === "item" && p.in === "body"));
  });

  test("Flask adapter extracts routes, method lists, and request params", () => {
    const flaskFiles: FileTree = [
      {
        path: "app.py",
        content: `from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/orders/<order_id>", methods=["GET"])
def get_order(order_id):
    """
    Fetch an existing order status.
    """
    email = request.args.get("email")
    return jsonify({"order_id": order_id, "email": email})

@app.route("/orders", methods=["POST"])
def submit_order():
    """
    Place a new customer order.
    """
    data = request.json
    return jsonify({"status": "placed"})
`,
      },
    ];

    assert.ok(flaskAdapter.detect(flaskFiles));
    const tools = flaskAdapter.extract(flaskFiles);
    assert.equal(tools.length, 2);

    const getTool = tools.find((t) => t.method === "GET");
    assert.equal(getTool?.path, "/orders/{order_id}");
    assert.equal(getTool?.name, "get_order");
    assert.ok(getTool?.params.some((p) => p.name === "order_id" && p.in === "path"));
    assert.ok(getTool?.params.some((p) => p.name === "email" && p.in === "query"));

    const postTool = tools.find((t) => t.method === "POST");
    assert.equal(postTool?.path, "/orders");
    assert.equal(postTool?.name, "place_order");
  });

  test("Repo-level OpenAPI spec is preferred when present", () => {
    const specRepoFiles: FileTree = [
      {
        path: "openapi.json",
        content: JSON.stringify({
          openapi: "3.0.0",
          paths: {
            "/api/v1/health": {
              get: {
                summary: "Health check endpoint",
                description: "Returns service health status",
                responses: { "200": { description: "OK" } },
              },
            },
          },
        }),
      },
      {
        path: "src/app/api/route.ts",
        content: "export async function GET() {}",
      },
    ];

    const result = extractToolSourcesFromFiles(specRepoFiles);
    assert.equal(result.usedSpec, true);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].path, "/api/v1/health");
    assert.equal(result.sources[0].description, "Health check endpoint. Returns service health status");
  });
});

describe("Universal Repository Analyzer (Any GitHub Repo)", () => {
  test("extracts WebMCP tools from arbitrary 3D/AI repository (e.g. gods-eye-view)", () => {
    const repoFiles: FileTree = [
      {
        path: "viewer.py",
        content: `def render_gaussian_splat(model_path: str):
    pass
`,
      },
      {
        path: "README.md",
        content: "# God's Eye View\nReal-time 3D Gaussian splatting and neural radiance field viewer.",
      },
    ];

    const result = extractUniversalRepoTools(repoFiles, "bilawalsidhu/gods-eye-view");
    assert.ok(result.tools.length > 0);
    const toolNames = result.tools.map((t) => t.name);
    assert.ok(toolNames.some((n) => n.includes("render") || n.includes("scene") || n.includes("splat")));
  });

  test("extracts WebMCP tools from exported functions in generic repo", () => {
    const repoFiles: FileTree = [
      {
        path: "src/utils.ts",
        content: `export async function calculateAnalytics(query: string) { return {}; }
export async function updateUserSettings(settings: object) { return true; }`,
      },
    ];

    const result = extractUniversalRepoTools(repoFiles, "acme/analytics-tool");
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].name, "calculate_analytics");
    assert.equal(result.tools[1].name, "update_user_settings");
  });
});

describe("Universal Live Website Analyzer (Any Website)", () => {
  test("extracts WebMCP tools for WhatsApp Web", async () => {
    const audit = await auditLiveUrl("https://web.whatsapp.com/");
    assert.equal(audit.success, true);
    assert.ok(audit.tools.length > 0);
    const names = audit.tools.map((t) => t.name);
    assert.ok(names.includes("send_message"));
    assert.ok(names.includes("search_chats"));
  });

  test("extracts WebMCP tools for Motion AI", async () => {
    const audit = await auditLiveUrl("https://motion.so/agent");
    assert.equal(audit.success, true);
    assert.ok(audit.tools.length > 0);
    const names = audit.tools.map((t) => t.name);
    assert.ok(names.includes("create_task"));
    assert.ok(names.includes("schedule_meeting"));
  });

  test("extracts WebMCP tools for YouTube", async () => {
    const audit = await auditLiveUrl("https://www.youtube.com");
    assert.equal(audit.success, true);
    assert.ok(audit.tools.length > 0);
    const names = audit.tools.map((t) => t.name);
    assert.ok(names.includes("search_videos"));
    assert.ok(names.includes("select_video"));
    assert.ok(names.includes("play_pause"));
    assert.ok(names.includes("get_video_details"));
  });

  test("extracts WebMCP tools for Amazon", async () => {
    const audit = await auditLiveUrl("https://www.amazon.com");
    assert.equal(audit.success, true);
    assert.ok(audit.tools.length > 0);
    const names = audit.tools.map((t) => t.name);
    assert.ok(names.includes("search_amazon"));
    assert.ok(names.includes("get_product_details"));
    assert.ok(names.includes("add_to_cart"));
    assert.ok(names.includes("get_cart_count"));
  });

  test("extracts WebMCP tools for arbitrary website", async () => {
    const audit = await auditLiveUrl("https://example.com/store");
    assert.equal(audit.success, true);
    assert.ok(audit.tools.length > 0);
    assert.equal(audit.tools[0].executable, false); // Always guarded read-only
  });
});

describe("OpenAPI Ingestion (parseOpenApiSpec)", () => {
  test("parses OpenAPI 3.x spec with paths, parameters, and requestBody", () => {
    const spec = {
      openapi: "3.0.2",
      servers: [{ url: "https://api.example.com/v1" }],
      paths: {
        "/users/{userId}": {
          get: {
            summary: "Get user by ID",
            description: "Fetches user profile details.",
            parameters: [
              {
                name: "userId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
          },
          delete: {
            summary: "Delete user",
            description: "Permanently removes a user.",
          },
        },
        "/users": {
          post: {
            summary: "Create new user",
            description: "Registers a user account.",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["username", "email"],
                    properties: {
                      username: { type: "string" },
                      email: { type: "string" },
                      age: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const sources = parseOpenApiSpec(spec);
    assert.equal(sources.length, 3);

    const getUser = sources.find((s) => s.id === "GET /users/{userId}");
    assert.ok(getUser);
    assert.equal(getUser?.name, "get_user");
    assert.equal(getUser?.params[0].name, "userId");
    assert.equal(getUser?.params[0].in, "path");
    assert.equal(getUser?.executable, false); // Remote base URL -> not executable

    const postUser = sources.find((s) => s.id === "POST /users");
    assert.ok(postUser);
    assert.equal(postUser?.name, "create_user");
    assert.ok(postUser?.params.some((p) => p.name === "username" && p.in === "body" && p.required));
    assert.ok(postUser?.params.some((p) => p.name === "age" && p.type === "number"));
  });

  test("marks localhost OpenAPI baseUrl as executable", () => {
    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "http://localhost:8080/api" }],
      paths: {
        "/status": {
          get: { summary: "Check system status" },
        },
      },
    };
    const sources = parseOpenApiSpec(spec);
    assert.equal(sources[0].executable, true);
  });
});
