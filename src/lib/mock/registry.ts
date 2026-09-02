import type { MockSpec } from "../types";

/**
 * Server-side registry of live mock targets.
 *
 * In-memory on purpose, like the demo storefront's cart: a mock target is
 * scoped to the session that generated it and there is nothing here worth
 * persisting. A cold start loses it, and the mock route falls back to
 * reconstructing an operation from the request itself.
 */
const MAX_SPECS = 20;
const TTL_MS = 60 * 60 * 1000;

interface Entry {
  spec: MockSpec;
  registeredAt: number;
}

// Held on globalThis, like the storefront's cart: route handlers are bundled
// separately in dev, so module-level state is not shared between the route
// that registers a mock and the route that serves it.
const globalKey = "__webmcp_forge_mocks__";
const globalScope = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;

function registryMap(): Map<string, Entry> {
  if (!globalScope[globalKey]) {
    globalScope[globalKey] = new Map<string, Entry>();
  }
  return globalScope[globalKey] as Map<string, Entry>;
}

function evict() {
  const registry = registryMap();
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (now - entry.registeredAt > TTL_MS) registry.delete(id);
  }
  while (registry.size > MAX_SPECS) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
}

export function registerMock(spec: MockSpec): MockSpec {
  evict();
  const registry = registryMap();
  registry.delete(spec.id);
  registry.set(spec.id, { spec, registeredAt: Date.now() });
  return spec;
}

export function getMock(id: string): MockSpec | null {
  const registry = registryMap();
  const entry = registry.get(id);
  if (!entry) return null;
  if (Date.now() - entry.registeredAt > TTL_MS) {
    registry.delete(id);
    return null;
  }
  return entry.spec;
}

export function listMocks(): Array<{ id: string; label: string; operations: number }> {
  evict();
  return [...registryMap().values()].map((entry) => ({
    id: entry.spec.id,
    label: entry.spec.label,
    operations: entry.spec.operations.length,
  }));
}
