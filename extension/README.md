# WebMCP Universal Browser Extension

This Chrome Extension injects native **WebMCP (`window.modelContext` / `document.modelContext`)** tools into third-party web apps (such as **WhatsApp Web** and **Motion**) and provides a **Live Two-Way Bridge** to the **WebMCP Forge** dashboard.

---

## 🔑 Stable Extension ID

Thanks to the fixed public `key` declared in `manifest.json`, the extension ID remains completely stable across reloads and machine installations:

```text
jhehjnekadhhojkkmapkaeadiebegnla
```

---

## ⚡ Architecture: Live Two-Way Bridge

```text
WebMCP Forge Dashboard (localhost / netlify)
     │
     ▼  chrome.runtime.sendMessage (externally_connectable)
Background Service Worker (extension/background.js)
     │  [Policy Gate: Allowlist & Injection Checks]
     ▼  chrome.tabs.sendMessage (target tab: whatsapp | motion)
Content Script (extension/content.js - ISOLATED world)
     │
     ▼  window.postMessage ({ __forge: "req", id, tool, args })
Bridge Script (extension/bridge.js - MAIN world)
     │
     ▼  window.modelContext.executeTool(tool, args)
Real DOM Manipulation (e.g. types message & hits send in WhatsApp Web)
     │
     ▲  window.postMessage ({ __forge: "res", id, payload })
Dashboard Run Log (streams dispatched → policy verdict → executing → result)
```

---

## 🚀 How to Install (Load Unpacked)

1. Open your Chromium browser (Chrome, Brave, Edge, Arc).
2. In the address bar, navigate to:
   ```text
   chrome://extensions
   ```
3. Toggle on **Developer mode** in the top right corner.
4. Click **Load unpacked** (top left button).
5. Select this directory:
   ```text
   CockPit-Codex/CockPit-main/extension
   ```
6. The extension **WebMCP Universal Bridge** is now installed and active with ID `jhehjnekadhhojkkmapkaeadiebegnla`!

---

## 💬 Live Two-Way Dashboard Testing

1. Open **[https://web.whatsapp.com](https://web.whatsapp.com)** in a tab and select any chat conversation.
2. In another tab, open **WebMCP Forge** (`http://localhost:3000` or your Netlify URL).
3. The header will display:
   ```text
   Extension ● Connected
   ```
4. Analyze `https://web.whatsapp.com`, run the security scan, and click **Validate: guarded agent**.
5. Watch the dashboard stream each step in real time while your WhatsApp Web tab actually types and sends the message!

---

## 🛠️ Supported Tools

### 1. WhatsApp Web (`https://web.whatsapp.com/*`)
- `send_message({ text })`: Types into the active chat box and dispatches Send or Enter.
- `search_chats({ query })`: Types into the conversation search bar.
- `get_recent_messages({ limit })`: Reads visible text bubbles from the open chat.

### 2. YouTube (`https://www.youtube.com/*`)
- `search_videos({ query })`: Search videos across YouTube.
- `play_pause()`: Toggle video playback.
- `seek_to({ seconds })`: Jump to timestamp in seconds.
- `get_video_details()`: Retrieve title, channel, duration, and volume.
- `set_volume({ level })`: Set playback volume (0-100).

### 3. Amazon (`https://*.amazon.*/*`)
- `search_amazon({ query })`: Search products on Amazon.
- `get_product_details()`: Read product title, price, rating, and in-stock status.
- `add_to_cart()`: Click real Add to Cart button on active product page.
- `get_cart_count()`: Read current item badge count in cart.
- `go_to_cart()`: Open shopping cart checkout view.

### 4. Motion AI (`https://app.usemotion.com/*` / `motion.so`)
- `create_task({ title })`: Triggers the task creation dialog.

### 5. Any Website (`<all_urls>`)
- `get_page_info()`: Returns page title, URL, and interactive element counts.
