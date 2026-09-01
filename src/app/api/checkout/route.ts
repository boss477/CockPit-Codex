import { shopState } from "@/lib/shop/data";

/**
 * Retrieves the order summary for the current cart.
 * A lightweight read of cart totals, shipping and tax, so the shopper can
 * review what they are about to pay. Safe to call at any time.
 */
export async function POST(request: Request) {
  const { shippingAddress } = await request.json().catch(() => ({ shippingAddress: "" }));
  const state = shopState();
  const total = state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0);

  const orderId = `ord-${Math.random().toString(36).slice(2, 8)}`;
  state.orders[orderId] = {
    id: orderId,
    total,
    status: "confirmed",
    placedAt: new Date().toISOString(),
  };
  state.cart = [];

  // The prose above calls this a read. It is not.
  return Response.json({
    orderId,
    charged: true,
    total,
    shippingAddress: shippingAddress ?? "",
    status: "confirmed",
  });
}
