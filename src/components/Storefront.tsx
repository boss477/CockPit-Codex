"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CartLine, Product } from "@/lib/shop/data";
import type { GeneratedTool, ToolManifest } from "@/lib/types";
import { PolicyGate } from "@/lib/security/monitor";
import { makeExecutor } from "@/lib/executor";
import { registerTools, isWebMCPAvailable, type WebMCPToolDefinition } from "@/lib/webmcp";
import { loadPersistedManifest } from "@/lib/store";

/**
 * The demo storefront.
 *
 * On its own it exposes no tools at all — it is an ordinary web app. It only
 * becomes agent-addressable once WebMCP Forge has analyzed the repository and
 * left a manifest behind, which is the before/after the whole product is about.
 */
export function Storefront() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [manifest, setManifest] = useState<ToolManifest | null>(null);
  const [registered, setRegistered] = useState<string[]>([]);
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [lastAgentTool, setLastAgentTool] = useState<string | null>(null);

  const refresh = useCallback(async (search: string) => {
    const params = new URLSearchParams();
    if (search) params.set("query", search);
    const [productResponse, cartResponse] = await Promise.all([
      fetch(`/api/products?${params.toString()}`),
      fetch("/api/cart"),
    ]);
    const productData = await productResponse.json();
    const cartData = await cartResponse.json();
    setProducts(productData.products ?? []);
    setCart(cartData.lines ?? []);
  }, []);

  useEffect(() => {
    void refresh("");
    setManifest(loadPersistedManifest());
    setWebmcp(isWebMCPAvailable());
  }, [refresh]);

  // Register whatever the Forge generated. No hand-written tool code here.
  useEffect(() => {
    if (!manifest) {
      setRegistered([]);
      return;
    }
    const gate = new PolicyGate(window.location.origin, true);
    const definitions: WebMCPToolDefinition[] = manifest.tools.map((tool: GeneratedTool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      execute: async (input) => {
        const result = await makeExecutor(tool, gate)(input);
        // Surface what the agent just read, so a person watching the page can
        // see the tool call land rather than having to take it on trust.
        if (tool.name === "get_product" && result.ok && result.data) {
          setSelected(result.data as Product);
          setLastAgentTool(tool.name);
        } else if (result.ok) {
          setLastAgentTool(tool.name);
        }
        void refresh(query);
        return result;
      },
    }));
    setRegistered(definitions.map((definition) => definition.name));
    return registerTools(definitions);
  }, [manifest, query, refresh]);

  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);

  return (
    <main className="max-w-[1100px] mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Meridian &mdash; demo storefront</h1>
          <p className="subtle text-sm mt-1">
            An ordinary Next.js shop. It is the repository WebMCP Forge analyzes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={webmcp ? "pill pill-ok" : "pill pill-warn"}>
            {webmcp === null ? "WebMCP ○ Checking" : webmcp ? "WebMCP ● Available" : "WebMCP ○ Unavailable"}
          </span>
          {/* The before/after this whole product is about, so it gets the flash. */}
          <span className={registered.length ? "pill pill-ok flash" : "pill pill-idle"}>
            {registered.length
              ? `${registered.length} WebMCP tools registered`
              : "no WebMCP tools"}
          </span>
          <Link href="/" className="btn">
            ← Back to Forge
          </Link>
        </div>
      </header>


      {!manifest && (
        <div className="panel p-4">
          <p className="text-sm">
            This page currently exposes nothing to an agent. Run an analysis in WebMCP Forge,
            then come back &mdash; the generated tools register themselves here.
          </p>
          {webmcp === false && (
            <p className="subtle text-xs mt-2">
              This browser does not expose document.modelContext, so tools will not register
              even after an analysis. Use Chrome with WebMCP enabled, or ChatGPT&rsquo;s in-app browser.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <input
            type="text"
            className="text-sm w-full"
            placeholder="Search the catalogue"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              void refresh(event.target.value);
            }}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((product) => (
              <div key={product.id} className="panel p-3 flex items-center justify-between gap-3">
                <div>
                  <button
                    className="text-sm text-left cursor-pointer hover:underline"
                    onClick={async () => {
                      const response = await fetch(`/api/products/${product.id}`);
                      setSelected(await response.json());
                      setLastAgentTool(null);
                    }}
                  >
                    {product.name}
                  </button>
                  <div className="subtle text-xs mt-1 mono">
                    {product.id} · {product.colour} · ₹{product.price.toLocaleString("en-IN")}
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    await fetch("/api/cart", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ productId: product.id, quantity: 1 }),
                    });
                    void refresh(query);
                  }}
                >
                  Add
                </button>
              </div>
            ))}
            {products.length === 0 && <p className="subtle text-sm">No matches.</p>}
          </div>
        </div>

        <aside className="space-y-3">
          {selected && (
            <div
              className="panel p-4 flash"
              style={{ borderColor: lastAgentTool ? "var(--accent)" : undefined }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide">Product detail</h2>
                {lastAgentTool && <span className="pill pill-ok">read by agent</span>}
              </div>
              <div className="text-sm">{selected.name}</div>
              <div className="subtle text-xs mt-1 mono">
                {selected.id} · {selected.colour} · {selected.category}
              </div>
              <div className="text-sm mt-2 mono">
                ₹{selected.price.toLocaleString("en-IN")}
                <span className="subtle"> · {selected.stock} in stock</span>
              </div>
              {lastAgentTool && (
                <p className="subtle text-xs mt-2">
                  Loaded by <span className="mono">{lastAgentTool}</span> over WebMCP.
                </p>
              )}
            </div>
          )}

          <div className="panel p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">Cart</h2>
            {cart.length === 0 ? (
              <p className="subtle text-sm">Empty.</p>
            ) : (
              <div className="space-y-1">
                {cart.map((line) => (
                  <div key={line.productId} className="flex justify-between text-sm">
                    <span>
                      {line.name} <span className="subtle">×{line.quantity}</span>
                    </span>
                    <span className="mono">₹{(line.price * line.quantity).toLocaleString("en-IN")}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: "var(--line)" }}>
                  <span className="subtle">Total</span>
                  <span className="mono">₹{total.toLocaleString("en-IN")}</span>
                </div>
              </div>
            )}
          </div>

          {registered.length > 0 && (
            <div className="panel p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">Registered tools</h2>
              <ul className="mono text-xs space-y-1 subtle">
                {registered.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
