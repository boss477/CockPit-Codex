import { searchCatalogue } from "@/lib/shop/data";

/**
 * Search the product catalogue.
 * Returns products matching a text query, optionally capped by price.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") ?? "";
  const maxPrice = Number(searchParams.get("maxPrice") ?? 0);
  const results = searchCatalogue(query, maxPrice);
  return Response.json({ count: results.length, products: results });
}
