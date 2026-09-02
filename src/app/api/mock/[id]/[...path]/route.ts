import { getMock } from "@/lib/mock/registry";
import { matchOperation, synthesizeResponse, validateRequest } from "@/lib/mock/spec";
import type { HttpMethod, MockOperation } from "@/lib/types";

/**
 * The generated mock target.
 *
 * Requests are validated against the declared schema before anything is
 * returned, so a tool that mapped a parameter to the wrong place fails here
 * with a 422 rather than appearing to work. Every response says `mock: true`;
 * nothing on this route pretends to be a real service.
 */

interface Context {
  params: Promise<{ id: string; path: string[] }>;
}

function jsonHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "content-type": "application/json",
    "x-webmcp-forge-mock": "1",
    ...extra,
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "DELETE") return {};
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The registry is in-memory, so a cold start can lose a spec that the client
 * still holds. Rather than 404 the demo, answer from the request itself and
 * label the response so nobody mistakes it for the declared contract.
 */
function reconstruct(method: string, path: string): MockOperation {
  return {
    name: `reconstructed_${method.toLowerCase()}`,
    method: method.toUpperCase() as HttpMethod,
    path,
    params: [],
    description: "Reconstructed from the request. The registered spec was not found.",
  };
}

async function handle(request: Request, context: Context) {
  const { id, path } = await context.params;
  const url = new URL(request.url);
  const targetPath = `/${(path ?? []).join("/")}`;
  const query = Object.fromEntries(url.searchParams.entries());
  const body = await readBody(request);

  const spec = getMock(id);

  if (!spec) {
    const match = { operation: reconstruct(request.method, targetPath), pathParams: {} };
    const { status, body: payload } = synthesizeResponse(match, { query, body });
    return Response.json(
      { ...payload, mockSource: "reconstructed", mockId: id },
      { status, headers: jsonHeaders({ "x-webmcp-forge-mock-source": "reconstructed" }) },
    );
  }

  const match = matchOperation(spec, request.method, targetPath);

  if (!match) {
    return Response.json(
      {
        mock: true,
        error: `No operation ${request.method} ${targetPath} in the contract "${spec.label}".`,
        available: spec.operations.map((op) => `${op.method} ${op.path}`),
      },
      { status: 404, headers: jsonHeaders() },
    );
  }

  const issues = validateRequest(match.operation, {
    path: match.pathParams,
    query,
    body,
  });

  if (issues.length > 0) {
    return Response.json(
      {
        mock: true,
        error: "Request does not satisfy the declared schema.",
        operation: match.operation.name,
        issues,
      },
      { status: 422, headers: jsonHeaders() },
    );
  }

  const { status, body: payload } = synthesizeResponse(match, { query, body });
  return Response.json(
    { ...payload, mockSource: "contract", mockId: id },
    { status, headers: jsonHeaders({ "x-webmcp-forge-mock-source": "contract" }) },
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
