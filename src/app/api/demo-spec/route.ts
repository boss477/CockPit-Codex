import { DEMO_SPEC_JSON } from "@/lib/fixtures/demoSpec";

/**
 * Serves the bundled contract so the OpenAPI path can be exercised as a real
 * URL — fetched, parsed and turned into a mock target like any other spec.
 */
export function GET() {
  return new Response(DEMO_SPEC_JSON, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
}
