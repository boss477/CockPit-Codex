/**
 * Security policy for WebMCP background service worker.
 * Self-contained JS version matching src/lib/security/extensionPolicy.ts
 */

const ALLOWED_TOOLS_BY_TARGET = {
  whatsapp: ["send_message", "search_chats", "get_recent_messages", "get_page_info"],
  motion: ["create_task", "get_page_info"],
  youtube: ["search_videos", "play_pause", "seek_to", "get_video_details", "set_volume", "get_page_info"],
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

  // 1. Tool allowlist check
  if (!allowedTools || !allowedTools.includes(tool)) {
    return {
      allowed: false,
      rule: "unauthorized-tool",
      reason: `Tool "${tool}" is not in the allowlist for target "${target}".`,
    };
  }

  // 2. Prompt injection check in args
  const serialized = JSON.stringify(args || {});
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(serialized)) {
      return {
        allowed: false,
        rule: "metadata-injection",
        reason: `Tool argument contains prompt injection pattern (${label}).`,
      };
    }
  }

  // 3. Egress / exfiltration check
  if (
    /(https?:\/\/(?!localhost|127\.0\.0\.1)[^\s"']+)/i.test(serialized) &&
    /exfiltrate|leak|webhook|steal|egress/i.test(serialized)
  ) {
    return {
      allowed: false,
      rule: "sensitive-data-egress",
      reason: "Arguments attempt cross-origin exfiltration to untrusted remote destination.",
    };
  }

  return { allowed: true };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { checkExtensionPolicy, ALLOWED_TOOLS_BY_TARGET };
}
