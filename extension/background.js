/**
 * WebMCP Universal Bridge - Background Service Worker
 * Mediates communication between the WebMCP Forge dashboard and target web tabs.
 */

try {
  importScripts("policy.js");
} catch (e) {
  console.warn("[WebMCP Background] Could not import policy.js:", e);
}

const TARGET_URL_PATTERNS = {
  whatsapp: ["https://web.whatsapp.com/*"],
  motion: ["https://app.usemotion.com/*", "https://motion.so/*"],
};

/**
 * Resolves the most appropriate tab matching the target name.
 * If zero tabs match, returns null. If several, returns the most recently active.
 */
async function resolveTargetTab(targetName) {
  const norm = (targetName || "").toLowerCase();
  const patterns = TARGET_URL_PATTERNS[norm];
  if (!patterns) return null;

  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    if (!tabs || tabs.length === 0) return null;

    // Pick the most recently active or accessed tab
    tabs.sort((a, b) => {
      const timeA = a.lastAccessed || (a.active ? Date.now() : 0);
      const timeB = b.lastAccessed || (b.active ? Date.now() : 0);
      return timeB - timeA;
    });

    return tabs[0];
  } catch (err) {
    console.error("[WebMCP Background] Error querying tabs:", err);
    return null;
  }
}

// Listen for external messages from WebMCP Forge dashboard
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log("[WebMCP Background] Received external message:", message, "from sender:", sender.origin);

  // 1. Health check / Ping
  if (message && (message.type === "ping" || message === "ping")) {
    sendResponse({
      ok: true,
      version: "1.0.1",
      id: chrome.runtime.id,
    });
    return true;
  }

  // 2. Remote Tool Execution Request
  if (message && message.type === "call_tool") {
    const { target, tool, args = {} } = message;

    // 2a. Enforce security policy allowlist BEFORE touching tabs or DOM
    if (typeof checkExtensionPolicy === "function") {
      const policy = checkExtensionPolicy(target, tool, args);
      if (!policy.allowed) {
        console.warn(`[WebMCP Background] Policy blocked tool "${tool}" on target "${target}":`, policy.rule);
        sendResponse({
          ok: false,
          code: "POLICY_BLOCKED",
          rule: policy.rule || "disallowed",
          reason: policy.reason || "Disallowed by extension security policy",
        });
        return true;
      }
    }

    // 2b. Resolve target tab
    resolveTargetTab(target).then((tab) => {
      if (!tab || !tab.id) {
        sendResponse({
          ok: false,
          code: "NO_TARGET_TAB",
          message: `No active tab found for target "${target}". Please open ${target === "whatsapp" ? "https://web.whatsapp.com" : "https://app.usemotion.com"} first.`,
        });
        return;
      }

      // 2c. Forward execution request to content script on target tab
      chrome.tabs.sendMessage(
        tab.id,
        {
          __forge: "exec",
          tool,
          args,
        },
        (tabReply) => {
          if (chrome.runtime.lastError) {
            console.warn("[WebMCP Background] tabs.sendMessage error:", chrome.runtime.lastError.message);
            sendResponse({
              ok: false,
              code: "TAB_ERROR",
              message: chrome.runtime.lastError.message,
            });
          } else {
            sendResponse(tabReply);
          }
        }
      );
    }).catch((err) => {
      sendResponse({
        ok: false,
        code: "INTERNAL_ERROR",
        message: err.message,
      });
    });

    return true; // Keep message channel open for async response
  }

  sendResponse({ ok: false, error: "Unknown message type" });
  return true;
});
