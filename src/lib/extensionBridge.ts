/**
 * WebMCP Extension Bridge Client
 * Transport library connecting the WebMCP Forge dashboard to the WebMCP Chrome Extension.
 *
 * Architecture:
 * Dashboard -> chrome.runtime.sendMessage -> Background SW -> chrome.tabs.sendMessage
 *   -> content.js (ISOLATED) -> window.postMessage -> bridge.js (MAIN) -> executeTool
 */

export const STATIC_EXTENSION_ID = "jhehjnekadhhojkkmapkaeadiebegnla";

export interface RemoteToolSuccess {
  ok: true;
  [key: string]: unknown;
}

export interface RemoteToolFailure {
  ok: false;
  code: "NO_TARGET_TAB" | "POLICY_BLOCKED" | "TIMEOUT" | "TOOL_ERROR" | "NO_EXTENSION" | "TAB_ERROR" | "INTERNAL_ERROR";
  rule?: string;
  reason?: string;
  message?: string;
  [key: string]: unknown;
}

export type RemoteToolResult = RemoteToolSuccess | RemoteToolFailure;

export interface ExtensionPingResponse {
  ok: boolean;
  version?: string;
  id?: string;
}

/**
 * Feature-detects whether the WebMCP Chrome Extension is installed and responsive.
 * Safe to call in browser environments; returns false during SSR or if extension is absent.
 */
export async function detectExtension(
  extensionId: string = STATIC_EXTENSION_ID,
  timeoutMs = 1200
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Check if chrome.runtime.sendMessage exists
  const chromeRuntime = (window as unknown as { chrome?: { runtime?: { sendMessage?: Function } } })?.chrome?.runtime;
  if (!chromeRuntime || typeof chromeRuntime.sendMessage !== "function") {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, timeoutMs);

    try {
      const send = chromeRuntime.sendMessage;
      if (typeof send === "function") {
        send.call(
          chromeRuntime,
          extensionId,
          { type: "ping" },
          (response: ExtensionPingResponse | undefined) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              const err = (window as unknown as { chrome?: { runtime?: { lastError?: Error } } })?.chrome?.runtime?.lastError;
              if (err || !response || !response.ok) {
                resolve(false);
              } else {
                resolve(true);
              }
            }
          }
        );
      } else {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    } catch {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

/**
 * Invokes a tool on a real target browser tab via the WebMCP Chrome extension.
 */
export async function callRemoteTool(
  target: "whatsapp" | "motion" | string,
  tool: string,
  args: Record<string, unknown> = {},
  extensionId: string = STATIC_EXTENSION_ID,
  timeoutMs = 12000
): Promise<RemoteToolResult> {
  if (typeof window === "undefined") {
    return { ok: false, code: "NO_EXTENSION", message: "Window is not available" };
  }

  const chromeRuntime = (window as unknown as { chrome?: { runtime?: { sendMessage?: Function } } })?.chrome?.runtime;
  if (!chromeRuntime || typeof chromeRuntime.sendMessage !== "function") {
    return {
      ok: false,
      code: "NO_EXTENSION",
      message: "Chrome runtime is not available in this browser environment.",
    };
  }

  return new Promise<RemoteToolResult>((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({
          ok: false,
          code: "TIMEOUT",
          message: `Remote tool invocation for "${tool}" timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    try {
      const send = chromeRuntime.sendMessage;
      if (typeof send !== "function") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            code: "NO_EXTENSION",
            message: "chrome.runtime.sendMessage is not a function",
          });
        }
        return;
      }

      send.call(
        chromeRuntime,
        extensionId,
        {
          type: "call_tool",
          target,
          tool,
          args,
        },
        (response: RemoteToolResult | undefined) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);

            const err = (window as unknown as { chrome?: { runtime?: { lastError?: { message?: string } } } })?.chrome?.runtime?.lastError;
            if (err) {
              resolve({
                ok: false,
                code: "NO_EXTENSION",
                message: err.message || "Failed to communicate with WebMCP extension",
              });
              return;
            }

            if (!response) {
              resolve({
                ok: false,
                code: "INTERNAL_ERROR",
                message: "No response received from extension bridge",
              });
              return;
            }

            resolve(response);
          }
        }
      );
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          code: "INTERNAL_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
