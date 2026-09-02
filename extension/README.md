# WebMCP Universal Browser Extension

This Chrome Extension injects native **WebMCP (`window.modelContext` / `document.modelContext`)** tools into third-party web apps (such as **WhatsApp Web** and **Motion**) so that AI agents can interact with them directly via the WebMCP protocol.

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
   CockPit-Codex/extension
   ```
6. The extension **WebMCP Universal Bridge** is now installed and active!

---

## 💬 How to Test with WhatsApp Web

1. Open [https://web.whatsapp.com](https://web.whatsapp.com) in your browser.
2. Select any contact/chat conversation.
3. Open Developer Tools (`F12` or `Ctrl+Shift+I`) &rarr; **Console**.
4. Type and run:
   ```javascript
   await window.modelContext.executeTool("send_message", { 
     text: "Hello from WebMCP!" 
   });
   ```
5. You will see the text automatically typed into the WhatsApp message input box and sent!

---

## 🛠️ Supported Tools

### 1. WhatsApp Web (`https://web.whatsapp.com/*`)
- `send_message({ text })`: Types into the active chat box and dispatches Send or Enter.
- `search_chats({ query })`: Types into the conversation search bar.
- `get_recent_messages({ limit })`: Reads visible text bubbles from the open chat.

### 2. Motion AI (`https://app.usemotion.com/*` / `motion.so`)
- `create_task({ title })`: Triggers the task creation dialog.

### 3. Any Website (`<all_urls>`)
- `get_page_info()`: Returns page title, URL, and interactive element counts.
