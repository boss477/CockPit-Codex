/**
 * WebMCP Universal Bridge - Background Service Worker
 * Mediates communication between the WebMCP Forge dashboard and target web tabs.
 */

const ALLOWED_TOOLS_BY_TARGET = {
  whatsapp: ["send_message", "search_chats", "get_recent_messages", "get_page_info"],
  motion: ["create_task", "get_page_info"],
  youtube: ["search_videos", "select_video", "play_pause", "seek_to", "get_video_details", "set_volume", "get_page_info"],
  amazon: ["search_amazon", "get_product_details", "add_to_cart", "get_cart_count", "go_to_cart", "get_page_info"],
};

const INJECTION_PATTERNS = [
  { pattern: /ignore\s+(any\s+|all\s+)?(previous|prior|earlier)/i, label: "instruction override" },
  { pattern: /\bdo not (mention|tell|inform|reveal|disclose)\b/i, label: "concealment directive" },
  { pattern: /\byou must\b/i, label: "imperative aimed at the model" },
  { pattern: /\balways call\b/i, label: "forced tool chaining" },
  { pattern: /note (for|to) the (assistant|agent|ai|model|llm)/i, label: "direct address to the model" },
  { pattern: /\bdisregard\b.*\b(rule|restriction|policy|instruction)/i, label: "policy override" },
  { pattern: /\bsystem prompt\b/i, label: "prompt reference" },
];

function checkExtensionPolicy(target, tool, args = {}) {
  const normTarget = (target || "").toLowerCase();
  const allowedTools = ALLOWED_TOOLS_BY_TARGET[normTarget];
  if (!allowedTools || !allowedTools.includes(tool)) {
    return {
      allowed: false,
      rule: "unauthorized-tool",
      message: `Tool "${tool}" is not in the allowlist for target "${target}".`,
    };
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      for (const { pattern, label } of INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          return {
            allowed: false,
            rule: "metadata-injection",
            reason: `Argument "${key}" contains prompt injection directive: ${label}`,
          };
        }
      }
      if (/https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(value)) {
        return {
          allowed: false,
          rule: "cross-origin-egress",
          reason: `Argument "${key}" contains external URL payload`,
        };
      }
    }
  }

  return { allowed: true };
}

const TARGET_URL_PATTERNS = {
  whatsapp: ["https://web.whatsapp.com/*"],
  motion: ["https://app.usemotion.com/*", "https://motion.so/*"],
  youtube: ["https://www.youtube.com/*", "https://youtube.com/*"],
  amazon: ["https://*.amazon.com/*", "https://*.amazon.in/*", "https://*.amazon.co.uk/*", "https://*.amazon.de/*", "https://*.amazon.ca/*", "https://*.amazon.co.jp/*"],
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
    console.error("[WebMCP Background] resolveTargetTab error:", err);
    return null;
  }
}

// -------------------------------------------------------------
// EXTENSION LIFECYCLE: Connect existing tabs on install/reload
// -------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[WebMCP Background] Extension installed/reloaded. Connecting existing open tabs...");
  for (const [target, patterns] of Object.entries(TARGET_URL_PATTERNS)) {
    try {
      const tabs = await chrome.tabs.query({ url: patterns });
      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://")) {
          try {
            if (chrome.scripting && chrome.scripting.executeScript) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["bridge.js"],
                  world: "MAIN",
                });
              } catch {}
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
              });
              console.log(`[WebMCP Background] Connected bridge.js (MAIN) & content.js to existing ${target} tab (${tab.id})`);
            }
          } catch (e) {
            // Tab may not be scriptable or unloaded
          }
        }
      }
    } catch (err) {
      console.warn(`[WebMCP Background] Error scanning tabs for ${target}:`, err);
    }
  }
});

// -------------------------------------------------------------
// EXTERNAL MESSAGE LISTENER (from Forge Dashboard)
// -------------------------------------------------------------
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // 1. Health check / Ping
  if (message && (message.type === "ping" || message === "ping")) {
    sendResponse({
      ok: true,
      version: "1.0.4",
      id: chrome.runtime.id,
    });
    return true;
  }

  // 2. Remote Tool Execution Request
  if (message && message.type === "call_tool") {
    const { target, tool, args = {} } = message;

    // 2a. Enforce security policy allowlist BEFORE touching tabs or DOM
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

      // 2c. Dispatch to content script with ping handshake
      const dispatchExec = () => {
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
      };

      // Fast ping handshake to verify content script readiness
      chrome.tabs.sendMessage(tab.id, { __forge: "ping" }, async (pong) => {
        const err = chrome.runtime.lastError;
        if (err || !pong || !pong.ok) {
          try {
            if (chrome.scripting && chrome.scripting.executeScript) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["bridge.js"],
                  world: "MAIN",
                });
              } catch {}
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
              });
              setTimeout(dispatchExec, 250);
              return;
            }
          } catch (injectErr) {
            console.warn("[WebMCP Background] Auto-injection fallback failed:", injectErr);
          }
        }
        dispatchExec();
      });
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
