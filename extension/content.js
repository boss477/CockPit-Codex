/**
 * WebMCP Universal Bridge - Content Script (ISOLATED World)
 * Bridges communication between Chrome extension runtime (background SW)
 * and the page's MAIN world (where window.modelContext lives).
 * Includes resilient direct DOM fallback for zero-timeout execution.
 */
(function () {
  // Guard against duplicate script injection / duplicate event listeners
  if (window.__forgeInjected) {
    return;
  }
  window.__forgeInjected = true;

  console.log("[WebMCP Bridge Content] Loaded in isolated world, listening for Forge commands...");

  async function executeDomFallback(tool, args = {}) {
    const text = args.text || args.message || "";
    const query = args.query || "";

    if (tool === "send_message") {
      const box =
        document.querySelector('footer div[contenteditable="true"]') ||
        document.querySelector('#main footer div[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
        document.querySelector('div[contenteditable="true"][aria-label*="Type"]') ||
        document.querySelector('footer div[role="textbox"]') ||
        document.querySelector('#main div[contenteditable="true"]');

      if (!box) {
        return { ok: false, error: "WhatsApp chat input not found." };
      }

      box.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch {}

      try {
        box.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
        box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch {}

      await new Promise((r) => setTimeout(r, 150));

      const sendBtn =
        document.querySelector('button[data-testid="send"]') ||
        document.querySelector('span[data-testid="send"]')?.closest("button") ||
        document.querySelector('span[data-icon="send"]')?.closest("button") ||
        document.querySelector('button[data-testid="compose-btn-send"]') ||
        document.querySelector('footer button[aria-label="Send"]') ||
        document.querySelector('button[aria-label="Send"]');

      if (sendBtn) {
        sendBtn.click();
      } else {
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
      return { ok: true, message: `Dispatched message to chat: "${text}"` };
    }

    if (tool === "search_chats") {
      const searchBox =
        document.querySelector('div[data-testid="chat-list-search"]') ||
        document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
        document.querySelector('div[role="textbox"][data-tab="3"]') ||
        document.querySelector('div[aria-label*="Search"]') ||
        document.querySelector('input[placeholder*="Search"]');

      if (searchBox) {
        searchBox.focus();
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, query);
        } catch {}
        searchBox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }));
        await new Promise((r) => setTimeout(r, 400));
        searchBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const first = document.querySelector('div[data-testid="cell-frame-container"]') || document.querySelector('div[role="listitem"]');
        if (first) first.click();
      }
      return { ok: true, message: `Searched and selected chat for "${query}"` };
    }

    if (tool === "get_recent_messages") {
      const bubbles = Array.from(document.querySelectorAll("span.selectable-text"));
      const messages = bubbles.slice(-5).map((b) => b.textContent?.trim()).filter(Boolean);
      return { ok: true, count: messages.length, messages };
    }

    return { ok: false, error: `Direct execution not supported for tool "${tool}"` };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Fast ping/pong handshake to verify readiness
    if (message && message.__forge === "ping") {
      sendResponse({ ok: true, __forge: "pong" });
      return false;
    }

    if (!message || message.__forge !== "exec") {
      return false;
    }

    const { tool, args } = message;
    const id = "req_" + Math.random().toString(36).slice(2) + "_" + Date.now();

    let timer = null;

    const onWindowMessage = (event) => {
      // Security: must come from the same window
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.__forge !== "res") return;
      if (data.id !== id) return;

      // Matched response! Clean up and reply to background
      cleanup();
      sendResponse(data.payload);
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onWindowMessage);
    };

    // Fast 2.5-second fallback: if bridge.js in MAIN world doesn't reply, run direct DOM fallback!
    timer = setTimeout(async () => {
      cleanup();
      console.log(`[WebMCP Content] Running direct DOM execution fallback for "${tool}"...`);
      try {
        const fallbackRes = await executeDomFallback(tool, args);
        sendResponse(fallbackRes);
      } catch (err) {
        sendResponse({
          ok: false,
          code: "TIMEOUT",
          message: `Execution of tool "${tool}" timed out: ${err.message}`,
        });
      }
    }, 2500);

    window.addEventListener("message", onWindowMessage);

    // Dispatch request into the MAIN execution world
    window.postMessage(
      {
        __forge: "req",
        id,
        tool,
        args,
      },
      "*"
    );

    return true; // Keep async message channel open
  });
})();
