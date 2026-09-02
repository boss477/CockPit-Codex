import type { FileTree, ToolSource } from "./types";
import { buildToolName, firstSentence, snake } from "./adapters/helpers";

interface ExtractedRepoResult {
  tools: ToolSource[];
  stackName: string;
}

/**
 * Universal repository analyzer that extracts or synthesizes WebMCP tools
 * for any repository (Python, JavaScript/TypeScript, Go, Rust, Ruby, PHP, Java, C++, etc.)
 */
export function extractUniversalRepoTools(
  files: FileTree,
  repoLabel: string,
): ExtractedRepoResult {
  const sources: ToolSource[] = [];
  const repoName = repoLabel.split("/")[1] || repoLabel;
  const cleanRepoName = snake(repoName);

  // Check language hints
  const hasPython = files.some((f) => f.path.endsWith(".py"));
  const hasJS = files.some((f) => /\.[tj]sx?$/.test(f.path));
  const hasGo = files.some((f) => f.path.endsWith(".go"));
  const hasRust = files.some((f) => f.path.endsWith(".rs"));
  const hasReadme = files.find((f) => /readme\.md$/i.test(f.path));

  // Extract from README description or headings if present
  let summary = "";
  if (hasReadme) {
    const lines = hasReadme.content.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstNonHeading = lines.find((l) => !l.startsWith("#") && l.length > 20);
    if (firstNonHeading) summary = firstNonHeading;
  }

  // 1. Scan for exported functions, classes, or endpoints across all files
  for (const file of files) {
    // JavaScript / TypeScript exported functions
    if (/\.[tj]sx?$/.test(file.path) && !file.path.includes(".test.") && !file.path.includes(".spec.")) {
      const exportFuncs = file.content.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g);
      for (const ef of exportFuncs) {
        const funcName = ef[1];
        if (funcName.startsWith("_") || funcName === "default" || funcName === "metadata") continue;
        const toolName = snake(funcName);
        if (!sources.some((s) => s.name === toolName) && sources.length < 8) {
          sources.push({
            id: `EXPORT ${file.path}:${funcName}`,
            name: toolName,
            method: /^get|fetch|read|list|search|find|check/i.test(funcName) ? "GET" : "POST",
            path: `/api/${toolName}`,
            baseUrl: null,
            params: [],
            description: `Execute ${funcName} function from ${file.path}.`,
            executable: true,
            origin: "repo",
            source: file.path,
            doc: `Execute ${funcName} function from ${file.path}.`,
          });
        }
      }
    }

    // Python functions / methods
    if (file.path.endsWith(".py") && !file.path.includes("test_")) {
      const pyFuncs = file.content.matchAll(/def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g);
      for (const pf of pyFuncs) {
        const funcName = pf[1];
        if (funcName.startsWith("__") || funcName.startsWith("_") || funcName === "main") continue;
        const toolName = snake(funcName);
        if (!sources.some((s) => s.name === toolName) && sources.length < 8) {
          sources.push({
            id: `PYTHON ${file.path}:${funcName}`,
            name: toolName,
            method: /^get|fetch|read|list|search|find|check/i.test(funcName) ? "GET" : "POST",
            path: `/api/${toolName}`,
            baseUrl: null,
            params: [],
            description: `Call ${funcName} operation defined in ${file.path}.`,
            executable: true,
            origin: "repo",
            source: file.path,
            doc: `Call ${funcName} operation defined in ${file.path}.`,
          });
        }
      }
    }
  }

  // 2. If repository has domain-specific patterns (like 3D viewer, data pipeline, CLI, ML)
  if (sources.length === 0) {
    // Check if 3D / graphics / vision repo (e.g. gods-eye-view)
    const is3dRepo = /eye|view|3d|splat|gaussian|render|mesh|pointcloud|camera/i.test(repoName) ||
      files.some((f) => /three|splat|ply|shader|camera/i.test(f.content));

    if (is3dRepo) {
      sources.push(
        {
          id: "GET /api/scene/status",
          name: `get_${cleanRepoName}_scene`,
          method: "GET",
          path: "/api/scene/status",
          baseUrl: null,
          params: [],
          description: `Retrieve 3D scene parameters and rendering status for ${repoLabel}.`,
          executable: true,
          origin: "repo",
        },
        {
          id: "POST /api/scene/render",
          name: `render_${cleanRepoName}_frame`,
          method: "POST",
          path: "/api/scene/render",
          baseUrl: null,
          params: [
            { name: "pitch", type: "number", in: "body", required: false, description: "Camera pitch angle in degrees." },
            { name: "yaw", type: "number", in: "body", required: false, description: "Camera yaw angle in degrees." },
            { name: "fov", type: "number", in: "body", required: false, description: "Field of view." },
          ],
          description: `Render a 3D viewpoint frame for ${repoLabel}.`,
          executable: true,
          origin: "repo",
        },
        {
          id: "POST /api/scene/load_model",
          name: `load_${cleanRepoName}_model`,
          method: "POST",
          path: "/api/scene/load_model",
          baseUrl: null,
          params: [
            { name: "modelPath", type: "string", in: "body", required: true, description: "Path or URL to 3D asset (PLY/GLB/Splat)." },
          ],
          description: `Load a 3D model asset into the visualization viewport.`,
          executable: true,
          origin: "repo",
        },
      );
    } else {
      // General application synthesis
      sources.push(
        {
          id: "GET /api/info",
          name: `get_${cleanRepoName}_info`,
          method: "GET",
          path: "/api/info",
          baseUrl: null,
          params: [],
          description: summary || `Retrieve project metadata and configuration for ${repoLabel}.`,
          executable: true,
          origin: "repo",
        },
        {
          id: "POST /api/run",
          name: `run_${cleanRepoName}_task`,
          method: "POST",
          path: "/api/run",
          baseUrl: null,
          params: [
            { name: "command", type: "string", in: "body", required: true, description: "Task or command name." },
            { name: "args", type: "string", in: "body", required: false, description: "Optional arguments in JSON format." },
          ],
          description: `Execute main application workflow for ${repoLabel}.`,
          executable: true,
          origin: "repo",
        },
        {
          id: "GET /api/status",
          name: `check_${cleanRepoName}_health`,
          method: "GET",
          path: "/api/status",
          baseUrl: null,
          params: [],
          description: `Check health status and execution logs for ${repoLabel}.`,
          executable: true,
          origin: "repo",
        },
      );
    }
  }

  const detectedLanguage = hasPython ? "Python" : hasGo ? "Go" : hasRust ? "Rust" : hasJS ? "JavaScript / TypeScript" : "Universal Project";

  return {
    tools: sources,
    stackName: `${detectedLanguage} (${repoLabel})`,
  };
}
