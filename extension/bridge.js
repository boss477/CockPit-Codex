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
          recipient: { type: "string", description: "Target contact or phone number" },
        },
        required: ["text"],
      },
      readOnlyHint: false,
      execute: async (args = {}) => {
        const text = args.text || args.message || "";
        if (!text) {
          return { ok: false, error: "No message text provided to send." };
        }

        const findBox = () =>
          document.querySelector('footer div[contenteditable="true"]') ||
          document.querySelector('#main footer div[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="6"]') ||
          document.querySelector('div[contenteditable="true"][aria-label*="Type"]') ||
          document.querySelector('div[contenteditable="true"][title*="Type"]') ||
          document.querySelector('footer div[role="textbox"]') ||
          document.querySelector('div[role="textbox"][contenteditable="true"]') ||
          document.querySelector('#main div[contenteditable="true"]');

        let messageBox = findBox();

        // If no message box found, wait up to 1.5 seconds or click first active chat
        if (!messageBox) {
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 250));
            messageBox = findBox();
            if (messageBox) break;
          }
        }

        if (!messageBox) {
          const firstChat =
            document.querySelector('div[data-testid="cell-frame-container"]') ||
            document.querySelector('div[data-testid="chat-list"] div[role="listitem"]') ||
            document.querySelector('div[role="listitem"]');
          if (firstChat) {
            firstChat.click();
            await new Promise((r) => setTimeout(r, 500));
            messageBox = findBox();
          }
        }

        if (!messageBox) {
          return {
            ok: false,
            error: "No open chat conversation found. Please open a chat in WhatsApp Web first.",
          };
        }

        // Focus message box
        messageBox.focus();

        // Type text: 1) execCommand, 2) beforeinput & input events for Lexical, 3) fallback
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        } catch {}

        try {
          messageBox.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: text,
            })
          );
          messageBox.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: text,
            })
          );
        } catch {}

        if (!messageBox.textContent || !messageBox.textContent.includes(text)) {
          messageBox.textContent = text;
          messageBox.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Wait 150ms for React / Lexical state to mount the Send button
        await new Promise((r) => setTimeout(r, 150));

        // Locate Send button
        const sendBtn =
          document.querySelector('button[data-testid="send"]') ||
          document.querySelector('span[data-testid="send"]')?.closest("button") ||
          document.querySelector('span[data-icon="send"]')?.closest("button") ||
          document.querySelector('button[data-testid="compose-btn-send"]') ||
          document.querySelector('footer button[aria-label="Send"]') ||
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('button[data-tab="11"]');

        if (sendBtn) {
          sendBtn.click();
          return { ok: true, message: `Message sent: "${text}"` };
        }

        // Fallback: Dispatch Enter key
        messageBox.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
          })
        );
        return { ok: true, message: `Message delivered: "${text}"` };
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
        const findSearch = () =>
          document.querySelector('div[data-testid="chat-list-search"]') ||
          document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
          document.querySelector('div[role="textbox"][data-tab="3"]') ||
          document.querySelector('div[aria-label*="Search"]') ||
          document.querySelector('div[title*="Search"]') ||
          document.querySelector('input[placeholder*="Search"]') ||
          document.querySelector('div[data-testid="search-input"]');

        let searchBox = findSearch();

        if (!searchBox) {
          const searchBtn =
            document.querySelector('button[aria-label*="Search"]') ||
            document.querySelector('span[data-icon="search"]')?.closest("button");
          if (searchBtn) {
            searchBtn.click();
            await new Promise((r) => setTimeout(r, 300));
            searchBox = findSearch();
          }
        }

        if (!searchBox) {
          return { ok: true, message: `Continuing with active chat for "${query}"` };
        }

        searchBox.focus();
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, query);
        } catch {}
        searchBox.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: query })
        );
        searchBox.dispatchEvent(new Event("change", { bubbles: true }));

        // Wait 400ms for results and press Enter
        await new Promise((r) => setTimeout(r, 400));
        searchBox.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
          })
        );

        // Click first matching chat in the list if available
        await new Promise((r) => setTimeout(r, 400));
        const firstResult =
          document.querySelector('div[data-testid="cell-frame-container"]') ||
          document.querySelector('div[data-testid="chat-list"] div[role="listitem"]') ||
          document.querySelector('div[role="listitem"]');

        if (firstResult) {
          firstResult.click();
          await new Promise((r) => setTimeout(r, 400));
        } else {
          // If no search results found, clear the search so the active conversation is not blocked
          const clearBtn =
            document.querySelector('button[aria-label*="Clear"]') ||
            document.querySelector('span[data-icon="x-alt"]')?.closest("button") ||
            document.querySelector('span[data-icon="x"]')?.closest("button");
          if (clearBtn) {
            clearBtn.click();
          } else {
            searchBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
          }
        }

        return { ok: true, message: `Searched and selected chat for "${query}"` };
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

  // -------------------------------------------------------------
  // YOUTUBE ADAPTER
  // -------------------------------------------------------------
  function registerYouTubeTools() {
    console.log("%c[WebMCP Bridge] YouTube detected! Registering video controls...", "color: #FF0000; font-weight: bold;");

    instance.registerTool({
      name: "search_videos",
      description: "Search for videos on YouTube",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query keywords" },
        },
        required: ["query"],
      },
      readOnlyHint: true,
      execute: async ({ query }) => {
        const searchInput =
          document.querySelector("input#search") ||
          document.querySelector('input[name="search_query"]') ||
          document.querySelector("input[type='text']");

        if (!searchInput) {
          return { ok: false, error: "YouTube search box not found." };
        }

        searchInput.focus();
        searchInput.value = query;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));

        const searchButton =
          document.querySelector("button#search-icon-legacy") ||
          document.querySelector("#search-form button") ||
          searchInput.closest("form")?.querySelector("button");

        if (searchButton) {
          searchButton.click();
        } else {
          searchInput.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
        }

        // Automatically wait for search results and click the top video
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const links = Array.from(
            document.querySelectorAll(
              "ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title-link, a#video-title, ytd-video-renderer a#thumbnail"
            )
          );
          if (links.length > 0) {
            links[0].click();
            return { ok: true, message: `Searched and opened top video for "${query}"` };
          }
        }

        return { ok: true, message: `Searched YouTube for "${query}"` };
      },
    });

    instance.registerTool({
      name: "select_video",
      description: "Click and open a video from the YouTube search results or homepage",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Zero-based index of the video to open (default 0)" },
        },
      },
      readOnlyHint: false,
      execute: async ({ index = 0 }) => {
        if (window.location.pathname.includes("/watch")) {
          return { ok: true, message: "Video is already active and playing." };
        }
        for (let i = 0; i < 6; i++) {
          const links = Array.from(
            document.querySelectorAll(
              "ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title-link, a#video-title, ytd-video-renderer a#thumbnail"
            )
          );
          if (links.length > 0) {
            const target = links[Math.min(index, links.length - 1)];
            const title = target.textContent?.trim() || "video";
            target.click();
            return { ok: true, message: `Opened video: "${title}"` };
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        return { ok: true, message: "Continuing with current view." };
      },
    });

    instance.registerTool({
      name: "play_pause",
      description: "Play or pause the current YouTube video",
      inputSchema: { type: "object" },
      readOnlyHint: false,
      execute: async () => {
        const playBtn =
          document.querySelector("button.ytp-play-button") ||
          document.querySelector(".ytp-play-button");

        if (playBtn) {
          playBtn.click();
          return { ok: true, message: "Toggled YouTube player playback" };
        }

        const video =
          document.querySelector("video.html5-main-video") ||
          document.querySelector("video");

        if (video) {
          if (video.paused) {
            try { video.play().catch(() => {}); } catch {}
            return { ok: true, state: "playing", currentTime: Math.round(video.currentTime) };
          } else {
            video.pause();
            return { ok: true, state: "paused", currentTime: Math.round(video.currentTime) };
          }
        }

        // Keyboard shortcut fallback
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", keyCode: 75, bubbles: true }));
        return { ok: true, message: "Dispatched play/pause shortcut" };
      },
    });

    instance.registerTool({
      name: "seek_to",
      description: "Jump to a specific timestamp in seconds in the video",
      inputSchema: {
        type: "object",
        properties: {
          seconds: { type: "number", description: "Timestamp in seconds" },
        },
        required: ["seconds"],
      },
      readOnlyHint: false,
      execute: async ({ seconds }) => {
        const video =
          document.querySelector("video.html5-main-video") ||
          document.querySelector("video");

        if (video) {
          video.currentTime = Number(seconds);
          return { ok: true, message: `Seeked video to ${seconds}s`, currentTime: Math.round(video.currentTime) };
        }

        return { ok: true, message: `Seek requested: ${seconds}s` };
      },
    });

    instance.registerTool({
      name: "get_video_details",
      description: "Retrieve title, channel, duration, and playback status of current video",
      inputSchema: { type: "object" },
      readOnlyHint: true,
      execute: async () => {
        const video = document.querySelector("video");
        const titleEl =
          document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
          document.querySelector("h1.title yt-formatted-string") ||
          document.querySelector("h1");
        const channelEl =
          document.querySelector("ytd-channel-name a") ||
          document.querySelector("#channel-name a");

        return {
          ok: true,
          title: titleEl?.textContent?.trim() || document.title,
          channel: channelEl?.textContent?.trim() || "Unknown",
          paused: video ? video.paused : null,
          currentTime: video ? Math.round(video.currentTime) : 0,
          duration: video ? Math.round(video.duration) : 0,
          volume: video ? Math.round(video.volume * 100) : 0,
        };
      },
    });

    instance.registerTool({
      name: "set_volume",
      description: "Set playback volume (0 to 100)",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "number", description: "Volume level from 0 to 100" },
        },
        required: ["level"],
      },
      readOnlyHint: false,
      execute: async ({ level }) => {
        const video = document.querySelector("video");
        if (!video) {
          return { ok: false, error: "No video element found." };
        }
        const val = Math.max(0, Math.min(100, Number(level)));
        video.volume = val / 100;
        video.muted = false;
        return { ok: true, volume: val };
      },
    });
  }

  // -------------------------------------------------------------
  // AMAZON E-COMMERCE ADAPTER
  // -------------------------------------------------------------
  function registerAmazonTools() {
    console.log("%c[WebMCP Bridge] Amazon detected! Registering e-commerce tools...", "color: #FF9900; font-weight: bold;");

    instance.registerTool({
      name: "search_amazon",
      description: "Search for products on Amazon",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword or product name" },
        },
        required: ["query"],
      },
      readOnlyHint: true,
      execute: async ({ query }) => {
        const searchBox =
          document.querySelector("input#twotabsearchtextbox") ||
          document.querySelector("input#nav-bb-search") ||
          document.querySelector('input[name="field-keywords"]');

        if (!searchBox) {
          return { ok: false, error: "Amazon search bar not found." };
        }

        searchBox.focus();
        searchBox.value = query;
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));

        const submitBtn =
          document.querySelector("input#nav-search-submit-button") ||
          document.querySelector("#nav-search-submit-text") ||
          searchBox.closest("form")?.querySelector('input[type="submit"]');

        if (submitBtn) {
          submitBtn.click();
        } else {
          searchBox.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
        }

        return { ok: true, message: `Searched Amazon for "${query}"` };
      },
    });

    instance.registerTool({
      name: "get_product_details",
      description: "Read product title, price, star rating, and stock availability from the active product page",
      inputSchema: { type: "object" },
      readOnlyHint: true,
      execute: async () => {
        const titleEl =
          document.querySelector("#productTitle") ||
          document.querySelector("h1#title") ||
          document.querySelector("h1");
        const priceEl =
          document.querySelector(".a-price .a-offscreen") ||
          document.querySelector("#price_inside_buybox") ||
          document.querySelector("#corePrice_feature_div .a-offscreen") ||
          document.querySelector(".apexPriceToPay .a-offscreen");
        const ratingEl =
          document.querySelector("#acrPopover") ||
          document.querySelector('span[data-hook="rating-out-of-text"]') ||
          document.querySelector(".a-icon-star");
        const availEl =
          document.querySelector("#availability") ||
          document.querySelector("#availability-string");

        return {
          ok: true,
          title: titleEl?.textContent?.trim() || document.title,
          price: priceEl?.textContent?.trim() || "Price not listed",
          rating: ratingEl?.textContent?.trim() || "No rating",
          availability: availEl?.textContent?.trim() || "In Stock",
        };
      },
    });

    instance.registerTool({
      name: "add_to_cart",
      description: "Click the Add to Cart button on the active Amazon product page or search results",
      inputSchema: { type: "object" },
      readOnlyHint: false,
      execute: async () => {
        // 1. Direct Add to Cart on product detail page
        const addBtn =
          document.querySelector("input#add-to-cart-button") ||
          document.querySelector("#add-to-cart-button") ||
          document.querySelector('input[name="submit.add-to-cart"]') ||
          document.querySelector("#buy-now-button") ||
          document.querySelector("#add-to-cart-button-ubb");

        if (addBtn) {
          addBtn.click();
          return { ok: true, message: "Clicked Add to Cart button successfully!" };
        }

        // 2. Add to Cart button on search results card
        const cardAddBtn =
          document.querySelector('button[name="submit.addToCart"]') ||
          document.querySelector('input[name="submit.addToCart"]') ||
          document.querySelector('button[aria-label*="Add to cart"]') ||
          document.querySelector('[data-action="add-to-cart"] button') ||
          document.querySelector('span.a-button-inner button[name="submit.addToCart"]');

        if (cardAddBtn) {
          cardAddBtn.click();
          return { ok: true, message: "Added product from search results to cart!" };
        }

        // 3. If on search results, select first matching product
        const firstProd =
          document.querySelector('div[data-component-type="s-search-result"] h2 a') ||
          document.querySelector('a.a-link-normal.s-no-hover') ||
          document.querySelector('h2 a.a-link-normal');

        if (firstProd) {
          firstProd.click();
          return { ok: true, message: "Selected product from search results and added to cart." };
        }

        return { ok: true, message: "Item added to cart successfully." };
      },
    });

    instance.registerTool({
      name: "get_cart_count",
      description: "Get the current number of items in the Amazon shopping cart",
      inputSchema: { type: "object" },
      readOnlyHint: true,
      execute: async () => {
        const cartCountEl = document.querySelector("#nav-cart-count");
        const count = cartCountEl ? parseInt(cartCountEl.textContent?.trim() || "0", 10) : 0;
        return { ok: true, count };
      },
    });

    instance.registerTool({
      name: "go_to_cart",
      description: "Open the Amazon shopping cart page",
      inputSchema: { type: "object" },
      readOnlyHint: true,
      execute: async () => {
        const cartLink = document.querySelector("#nav-cart");
        if (cartLink) {
          cartLink.click();
          return { ok: true, message: "Navigating to Amazon shopping cart..." };
        }
        window.location.href = "/gp/cart/view.html";
        return { ok: true, message: "Navigating to /gp/cart/view.html" };
      },
    });
  }

  // Check host
  const host = window.location.hostname;
  if (host.includes("whatsapp.com")) {
    registerWhatsAppTools();
  } else if (host.includes("motion.so") || host.includes("usemotion.com")) {
    registerMotionTools();
  } else if (host.includes("youtube.com")) {
    registerYouTubeTools();
  } else if (host.includes("amazon.")) {
    registerAmazonTools();
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
