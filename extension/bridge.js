/**
 * WebMCP Universal Bridge - Main World Script
 * Injected natively in world: "MAIN" to bypass CSP and provide window.modelContext & document.modelContext
 */
(function () {
  console.log("%c[WebMCP Universal Bridge] Initializing window.modelContext...", "color: #3fb950; font-weight: bold; font-size: 12px;");

  // Avoid double initialization
  if (window.modelContext && window.modelContext._isWebMcpBridge) {
    console.log("[WebMCP Universal Bridge] Already initialized.");
    return;
  }

  const registeredTools = new Map();

  class ModelContext {
    constructor() {
      this._isWebMcpBridge = true;
      this._tools = registeredTools;
    }

    registerTool(toolDef) {
      if (!toolDef || !toolDef.name) {
        throw new Error("Tool definition must include a 'name' string");
      }
      this._tools.set(toolDef.name, toolDef);
      console.log(`%c[WebMCP Bridge] Registered tool: ${toolDef.name}`, "color: #58a6ff;");
      window.dispatchEvent(new CustomEvent("webmcp:tool-registered", { detail: { name: toolDef.name } }));
      return {
        unregister: () => {
          this._tools.delete(toolDef.name);
          console.log(`[WebMCP Bridge] Unregistered tool: ${toolDef.name}`);
        },
      };
    }

    unregisterTool(name) {
      this._tools.delete(name);
    }

    listTools() {
      return Array.from(this._tools.values()).map((t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || { type: "object" },
        readOnlyHint: Boolean(t.readOnlyHint),
      }));
    }

    async executeTool(name, input = {}) {
      const tool = this._tools.get(name);
      if (!tool) {
        throw new Error(`WebMCP tool "${name}" is not registered. Registered tools: ${Array.from(this._tools.keys()).join(", ")}`);
      }
      console.log(`%c[WebMCP Bridge] Executing tool "${name}" with input:`, "color: #d29922;", input);
      if (typeof tool.execute === "function") {
        return await tool.execute(input);
      }
      return { ok: true, message: `Tool "${name}" called with`, input };
    }

    // Alias for executeTool
    async callTool(name, input = {}) {
      return await this.executeTool(name, input);
    }
  }

  const instance = new ModelContext();

  try {
    window.modelContext = instance;
    document.modelContext = instance;
    navigator.modelContext = instance;
  } catch (e) {
    console.warn("[WebMCP Bridge] Could not set on document/navigator:", e);
  }

  // -------------------------------------------------------------
  // WHATSAPP WEB ADAPTER
  // -------------------------------------------------------------
  function registerWhatsAppTools() {
    console.log("%c[WebMCP Bridge] WhatsApp Web detected! Registering chat tools...", "color: #25D366; font-weight: bold;");

    instance.registerTool({
      name: "send_message",
      description: "Send a text message in the currently active WhatsApp chat",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message text to send" },
        },
        required: ["text"],
      },
      readOnlyHint: false,
      execute: async ({ text }) => {
        // Look for the main message input box in WhatsApp Web
        const messageBox =
          document.querySelector('footer div[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
          document.querySelector('div[contenteditable="true"]');

        if (!messageBox) {
          return {
            ok: false,
            error: "No open chat conversation found. Please click or select a chat first in WhatsApp Web.",
          };
        }

        // Focus and type text
        messageBox.focus();
        document.execCommand("insertText", false, text);
        messageBox.dispatchEvent(new Event("input", { bubbles: true }));

        // Wait brief moment for React state to update
        await new Promise((r) => setTimeout(r, 200));

        // Click Send button or press Enter
        const sendBtn =
          document.querySelector('footer button[aria-label="Send"]') ||
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('span[data-icon="send"]')?.closest("button");

        if (sendBtn) {
          sendBtn.click();
          return { ok: true, message: `Message sent: "${text}"` };
        } else {
          messageBox.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
          return { ok: true, message: `Message sent via Enter key: "${text}"` };
        }
      },
    });

    instance.registerTool({
      name: "search_chats",
      description: "Search conversations by contact name or keyword in WhatsApp Web",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term or contact name" },
        },
        required: ["query"],
      },
      readOnlyHint: true,
      execute: async ({ query }) => {
        const searchBox =
          document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
          document.querySelector('input[type="text"][placeholder*="Search"]');

        if (!searchBox) {
          return { ok: false, error: "Search input box not found." };
        }

        searchBox.focus();
        document.execCommand("insertText", false, query);
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true, message: `Searched WhatsApp chats for "${query}"` };
      },
    });

    instance.registerTool({
      name: "get_recent_messages",
      description: "Read recent visible message text bubbles from the active conversation",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum messages to return" },
        },
      },
      readOnlyHint: true,
      execute: async ({ limit = 5 }) => {
        const bubbles = Array.from(document.querySelectorAll("span.selectable-text"));
        const messages = bubbles.slice(-limit).map((b) => b.textContent?.trim()).filter(Boolean);
        return { ok: true, count: messages.length, messages };
      },
    });
  }

  // -------------------------------------------------------------
  // MOTION AI ADAPTER
  // -------------------------------------------------------------
  function registerMotionTools() {
    instance.registerTool({
      name: "create_task",
      description: "Trigger create task dialog in Motion",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
        },
        required: ["title"],
      },
      readOnlyHint: false,
      execute: async ({ title }) => {
        const addTaskBtn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.includes("Add Task") || b.textContent?.includes("Create")
        );
        if (addTaskBtn) {
          addTaskBtn.click();
          return { ok: true, message: `Opened task modal for "${title}"` };
        }
        return { ok: false, error: "Could not find Add Task button on current page view." };
      },
    });
  }

  // Register default generic tool
  instance.registerTool({
    name: "get_page_info",
    description: "Get current page title, URL, and interactive elements",
    inputSchema: { type: "object" },
    readOnlyHint: true,
    execute: async () => {
      return {
        title: document.title,
        url: window.location.href,
        buttons: Array.from(document.querySelectorAll("button")).length,
        inputs: Array.from(document.querySelectorAll("input, textarea")).length,
      };
    },
  });

  // Check host
  const host = window.location.hostname;
  if (host.includes("whatsapp.com")) {
    registerWhatsAppTools();
  } else if (host.includes("motion.so") || host.includes("usemotion.com")) {
    registerMotionTools();
  }

  // -------------------------------------------------------------
  // TWO-WAY FORGE BRIDGE LISTENER
  // -------------------------------------------------------------
  window.addEventListener("message", async (event) => {
    // Security: must originate from the same window
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.__forge !== "req") return;

    const { id, tool, args } = data;
    if (!id || !tool) return;

    console.log(`[WebMCP Bridge] Received execution request for "${tool}" (ID: ${id})`);

    try {
      const result = await instance.executeTool(tool, args || {});
      window.postMessage(
        {
          __forge: "res",
          id,
          payload: result && typeof result === "object" ? result : { ok: true, result },
        },
        "*"
      );
    } catch (err) {
      console.error(`[WebMCP Bridge] Error executing tool "${tool}":`, err);
      window.postMessage(
        {
          __forge: "res",
          id,
          payload: {
            ok: false,
            code: "TOOL_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        "*"
      );
    }
  });

  console.log(`%c[WebMCP Universal Bridge] Successfully loaded! ${instance.listTools().length} tools available.`, "color: #3fb950; font-weight: bold;");
})();
