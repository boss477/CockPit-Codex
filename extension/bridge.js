/**
 * WebMCP Universal Bridge - Main World Script
 * Injected directly into the target website window to provide document.modelContext
 * and automated DOM execution for WhatsApp Web, Motion, and generic sites.
 */
(function () {
  console.log("[WebMCP Bridge] Initializing WebMCP ModelContext in page context...");

  // In-memory tool registry
  const registeredTools = new Map();

  class ModelContext {
    constructor() {
      this._tools = registeredTools;
    }

    registerTool(toolDef) {
      if (!toolDef || !toolDef.name) {
        throw new Error("Tool definition must include a 'name' string");
      }
      this._tools.set(toolDef.name, toolDef);
      console.log(`[WebMCP Bridge] Registered tool: ${toolDef.name}`);
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
        throw new Error(`WebMCP tool "${name}" is not registered.`);
      }
      console.log(`[WebMCP Bridge] Executing tool "${name}" with input:`, input);
      if (typeof tool.execute === "function") {
        return await tool.execute(input);
      }
      return { ok: true, message: `Tool "${name}" called with`, input };
    }
  }

  const instance = new ModelContext();

  // Expose on both document.modelContext and navigator.modelContext
  try {
    Object.defineProperty(document, "modelContext", {
      value: instance,
      writable: false,
      configurable: true,
    });
  } catch (e) {
    document.modelContext = instance;
  }

  try {
    Object.defineProperty(navigator, "modelContext", {
      value: instance,
      writable: false,
      configurable: true,
    });
  } catch (e) {
    navigator.modelContext = instance;
  }

  window.modelContext = instance;

  // -------------------------------------------------------------
  // WHATSAPP WEB ADAPTER
  // -------------------------------------------------------------
  if (window.location.hostname.includes("whatsapp.com")) {
    console.log("[WebMCP Bridge] WhatsApp Web detected. Registering chat tools...");

    // 1. send_message
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
        const messageBox =
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
          document.querySelector('div[contenteditable="true"]');

        if (!messageBox) {
          return { ok: false, error: "No open chat conversation found. Please click a chat first." };
        }

        messageBox.focus();
        document.execCommand("insertText", false, text);
        messageBox.dispatchEvent(new Event("input", { bubbles: true }));

        await new Promise((r) => setTimeout(r, 150));

        const sendBtn =
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
          return { ok: true, message: `Message sent via Enter: "${text}"` };
        }
      },
    });

    // 2. search_chats
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
        return { ok: true, message: `Searched for "${query}"` };
      },
    });

    // 3. get_recent_messages
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
  if (window.location.hostname.includes("motion.so") || window.location.hostname.includes("usemotion.com")) {
    console.log("[WebMCP Bridge] Motion detected. Registering task tools...");

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

  // -------------------------------------------------------------
  // GENERIC WEB TOOLS (FOR ANY SITE)
  // -------------------------------------------------------------
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

  console.log(`[WebMCP Bridge] Ready with ${instance.listTools().length} tools available.`);
})();
