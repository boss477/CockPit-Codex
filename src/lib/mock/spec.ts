import type { MockOperation, MockSpec, ParamSpec, ToolSource } from "../types";

/**
 * Builds a mock target from the same contract the tools were generated from.
 *
 * This is the whole point of tier 2: the agent, the tools and the target all
 * come out of one description, so a call that works against the mock is a call
 * that was shaped correctly — nothing here is stubbed per tool.
 */
export function buildMockSpec(sources: ToolSource[], label: string, id?: string): MockSpec {
  const operations: MockOperation[] = sources.map((source) => ({
    name: source.name,
    method: source.method,
    path: source.path,
    // Header params never reach the mock as a matchable input.
    params: source.params.filter((param) => param.in !== "header"),
    description: source.description,
    example: undefined,
  }));

  return { id: id ?? mockId(label, operations), label, operations };
}

/** Stable id so re-analyzing the same contract reuses the same mock target. */
export function mockId(label: string, operations: MockOperation[]): string {
  const seed = `${label}::${operations.map((op) => `${op.method} ${op.path}`).join("|")}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `m${(hash >>> 0).toString(36)}`;
}

/** /api/products/{id} -> ^/api/products/([^/]+)$ , remembering the param order. */
function templateToRegex(path: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      const braced = segment.match(/^\{(.+)\}$/);
      if (braced) {
        names.push(braced[1]);
        return "([^/]+)";
      }
      const colon = segment.match(/^:(.+)$/);
      if (colon) {
        names.push(colon[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), names };
}

export interface MockMatch {
  operation: MockOperation;
  pathParams: Record<string, string>;
}

/** Finds the operation a method + path belongs to, honouring path templates. */
export function matchOperation(
  spec: MockSpec,
  method: string,
  path: string,
): MockMatch | null {
  const wanted = method.toUpperCase();
  const normalized = path.startsWith("/") ? path : `/${path}`;

  for (const operation of spec.operations) {
    if (operation.method !== wanted) continue;
    const { regex, names } = templateToRegex(operation.path);
    const found = normalized.match(regex);
    if (!found) continue;

    const pathParams: Record<string, string> = {};
    names.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(found[i + 1]);
    });
    return { operation, pathParams };
  }

  return null;
}

export interface ValidationIssue {
  param: string;
  in: ParamSpec["in"];
  problem: "missing" | "type";
  expected: string;
  received?: string;
}

/**
 * Validates an incoming request against the declared schema, the way Prism
 * does. A tool that was generated with the wrong parameter location fails here
 * instead of silently "succeeding" against a stub that accepts anything.
 */
export function validateRequest(
  operation: MockOperation,
  input: { path: Record<string, string>; query: Record<string, string>; body: Record<string, unknown> },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const param of operation.params) {
    const supplied =
      param.in === "path"
        ? input.path[param.name]
        : param.in === "body"
          ? input.body[param.name]
          : input.query[param.name];

    if (supplied === undefined || supplied === null || supplied === "") {
      if (param.required) {
        issues.push({ param: param.name, in: param.in, problem: "missing", expected: param.type });
      }
      continue;
    }

    if (param.type === "number" && Number.isNaN(Number(supplied))) {
      issues.push({
        param: param.name,
        in: param.in,
        problem: "type",
        expected: "number",
        received: String(supplied),
      });
    }

    if (param.type === "boolean" && !/^(true|false)$/i.test(String(supplied))) {
      issues.push({
        param: param.name,
        in: param.in,
        problem: "type",
        expected: "boolean",
        received: String(supplied),
      });
    }
  }

  return issues;
}

function sampleForParam(param: ParamSpec, supplied: unknown): unknown {
  if (supplied !== undefined && supplied !== "") {
    if (param.type === "number") return Number(supplied);
    if (param.type === "boolean") return String(supplied).toLowerCase() === "true";
    return supplied;
  }
  if (param.type === "number") return 1;
  if (param.type === "boolean") return true;
  if (param.type === "array") return [];
  if (param.type === "object") return {};
  return `sample-${param.name}`;
}

/**
 * Generates the response body from the declared example, or from the parameter
 * types when the contract carries no example. A mutating method reports the
 * mutation it performed, which is exactly what the runtime readonly-mismatch
 * check reads back.
 */
export function synthesizeResponse(
  match: MockMatch,
  input: { query: Record<string, string>; body: Record<string, unknown> },
): { status: number; body: Record<string, unknown> } {
  const { operation, pathParams } = match;
  if (operation.example !== undefined && operation.example !== null) {
    return {
      status: operation.method === "POST" ? 201 : 200,
      body: { mock: true, operation: operation.name, ...(operation.example as Record<string, unknown>) },
    };
  }

  const echoed: Record<string, unknown> = {};
  for (const param of operation.params) {
    const supplied =
      param.in === "path"
        ? pathParams[param.name]
        : param.in === "body"
          ? input.body[param.name]
          : input.query[param.name];
    echoed[param.name] = sampleForParam(param, supplied);
  }

  const mutating = operation.method !== "GET";
  const resource = operation.path.split("/").filter(Boolean).slice(-1)[0] ?? "resource";

  const body: Record<string, unknown> = {
    mock: true,
    operation: operation.name,
    endpoint: `${operation.method} ${operation.path}`,
    ...echoed,
  };

  if (mutating) {
    // The mock says plainly that it changed state. Nothing infers it.
    body.created = true;
    body.updated = true;
    body.status = "committed";
    body.message = `Mock target committed a ${operation.method} to ${operation.path}.`;
    body.id = `mock_${resource.replace(/[^a-z0-9]/gi, "")}_001`;
  } else {
    body.results = [
      { id: "mock_1", name: `Sample ${resource}`, price: 1999 },
      { id: "mock_2", name: `Sample ${resource} 2`, price: 2999 },
    ];
    body.products = body.results;
    body.count = 2;
  }

  return { status: mutating ? 201 : 200, body };
}
