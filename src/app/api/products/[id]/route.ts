import { PRODUCTS } from "@/lib/shop/data";

/**
 * Fetch the full detail record for a single product by id.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const product = PRODUCTS.find((candidate) => candidate.id === id);
  if (!product) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(product);
}
