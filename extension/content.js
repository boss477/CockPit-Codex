/**
 * WebMCP Universal Bridge - Content Script (ISOLATED World)
 * Bridges communication between Chrome extension runtime (background SW)
 * and the page's MAIN world (where window.modelContext lives).
 */
(function () {
  console.log("[WebMCP Bridge Content] Loaded in isolated world, listening for Forge commands...");

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    // 10-second timeout
    timer = setTimeout(() => {
      cleanup();
      sendResponse({
        ok: false,
        code: "TIMEOUT",
        message: `Execution of tool "${tool}" timed out after 10000ms`,
      });
    }, 10000);

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
