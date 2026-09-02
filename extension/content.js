/**
 * WebMCP Universal Bridge - Content Script
 * Injects bridge.js into the main DOM execution world.
 */
(function () {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("bridge.js");
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    console.log("[WebMCP Extension] Injected WebMCP main-world bridge into page.");
  } catch (err) {
    console.error("[WebMCP Extension] Injection error:", err);
  }
})();
