import { registerMock, listMocks } from "@/lib/mock/registry";
import type { MockSpec } from "@/lib/types";

/**
 * Brings a generated mock target up. The spec was derived from the contract
 * during analysis; this hands it to the route that will answer the calls.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { spec?: MockSpec } | null;
  const spec = payload?.spec;

  if (!spec || !Array.isArray(spec.operations) || spec.operations.length === 0) {
    return Response.json(
      { error: "A mock spec with at least one operation is required." },
      { status: 400 },
    );
  }

  const registered = registerMock({
    id: spec.id,
    label: spec.label,
    operations: spec.operations,
  });

  return Response.json({
    ok: true,
    mockId: registered.id,
    baseUrl: `/api/mock/${registered.id}`,
    operations: registered.operations.length,
  });
}

export async function GET() {
  return Response.json({ ok: true, mocks: listMocks() });
}
