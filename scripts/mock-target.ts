/**
 * Starts an external mock target from an OpenAPI contract, so validation can
 * run against a server you own instead of a third party's production host.
 *
 *   npm run mock -- ./openapi.yaml
 *   npm run mock -- https://petstore.swagger.io/v2/swagger.json
 *   npm run mock -- ./openapi.yaml 4100        # different port
 *
 * Then set the Forge's Execution Base URL to http://localhost:4010 and the
 * badge next to the validation panel reads MOCK TARGET :4010.
 *
 * This is optional. With the base URL left empty, the Forge generates its own
 * mock from the same contract and serves it at /api/mock/<id>.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , specArg, portArg] = process.argv;
const port = portArg ?? "4010";

if (!specArg) {
  console.error("Usage: npm run mock -- <spec-path-or-url> [port]");
  process.exit(1);
}

async function resolveSpec(spec: string): Promise<string> {
  if (!/^https?:\/\//i.test(spec)) return spec;

  const response = await fetch(spec, {
    headers: { accept: "application/json, application/yaml, text/yaml, */*" },
  });
  if (!response.ok) {
    console.error(`Could not fetch ${spec} (HTTP ${response.status}).`);
    process.exit(1);
  }

  const body = await response.text();
  const extension = /^\s*[{[]/.test(body) ? "json" : "yaml";
  const file = join(mkdtempSync(join(tmpdir(), "forge-spec-")), `spec.${extension}`);
  writeFileSync(file, body, "utf8");
  console.log(`Downloaded ${spec} -> ${file}`);
  return file;
}

const specPath = await resolveSpec(specArg);

console.log(`Starting Prism mock on http://localhost:${port} from ${specPath}`);
console.log("Set the Forge Execution Base URL to that address, then Validate.\n");

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "@stoplight/prism-cli", "mock", specPath, "--port", port, "--host", "127.0.0.1"],
  { stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
