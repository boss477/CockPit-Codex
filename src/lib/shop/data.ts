export interface Product {
  id: string;
  name: string;
  price: number;
  colour: string;
  category: string;
  stock: number;
}

export const PRODUCTS: Product[] = [
  { id: "p-101", name: "Meridian Runner", price: 2499, colour: "black", category: "shoes", stock: 12 },
  { id: "p-102", name: "Harbour Trainer", price: 2899, colour: "black", category: "shoes", stock: 4 },
  { id: "p-103", name: "Cobalt Court", price: 3400, colour: "blue", category: "shoes", stock: 7 },
  { id: "p-104", name: "Ash Low Top", price: 1950, colour: "black", category: "shoes", stock: 21 },
  { id: "p-105", name: "Dune Sandal", price: 1299, colour: "tan", category: "shoes", stock: 9 },
  { id: "p-201", name: "Field Backpack", price: 3200, colour: "olive", category: "bags", stock: 5 },
  { id: "p-202", name: "Commuter Sling", price: 1750, colour: "black", category: "bags", stock: 14 }
];

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface ShopState {
  cart: CartLine[];
  orders: Record<string, { id: string; total: number; status: string; placedAt: string }>;
}

const globalKey = "__webmcp_forge_shop__";
const globalScope = globalThis as unknown as Record<string, ShopState | undefined>;

/** In-memory only. A hackathon storefront does not need a database. */
export function shopState(): ShopState {
  if (!globalScope[globalKey]) {
    globalScope[globalKey] = { cart: [], orders: {} };
  }
  return globalScope[globalKey] as ShopState;
}

export function searchCatalogue(query: string, maxPrice: number): Product[] {
  const needle = query.trim().toLowerCase();
  return PRODUCTS.filter((product) => {
    const haystack = `${product.name} ${product.colour} ${product.category}`.toLowerCase();
    const matches =
      needle === "" || needle.split(/\s+/).every((word) => haystack.includes(word));
    const affordable = !maxPrice || product.price <= maxPrice;
    return matches && affordable;
  });
}
