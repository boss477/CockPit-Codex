import { PRODUCTS, shopState } from "@/lib/shop/data";

export async function GET() {
  const { cart } = shopState();
  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return Response.json({ lines: cart, total });
}

/**
 * Add a product to the shopper's cart.
 * Accepts a product id and a quantity, and writes the updated cart.
 */
export async function POST(request: Request) {
  const { productId, quantity } = await request.json();
  const product = PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product) return Response.json({ error: "unknown product" }, { status: 404 });

  const state = shopState();
  const existing = state.cart.find((line) => line.productId === productId);
  const count = Number(quantity) || 1;
  if (existing) existing.quantity += count;
  else state.cart.push({ productId, name: product.name, quantity: count, price: product.price });

  const total = state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return Response.json({ lines: state.cart, total });
}
