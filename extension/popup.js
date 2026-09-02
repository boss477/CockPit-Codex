/**
 * WebMCP Extension Popup Script
 */
document.addEventListener("DOMContentLoaded", async () => {
  const pageTitleEl = document.getElementById("page-title");
  const pageUrlEl = document.getElementById("page-url");
  const toolItemsEl = document.getElementById("tool-items");
  const testBtn = document.getElementById("test-btn");
  const statusEl = document.getElementById("status");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      pageTitleEl.textContent = tab.title || "Active Web Page";
      pageUrlEl.textContent = new URL(tab.url || "about:blank").hostname;

      if (tab.url?.includes("whatsapp.com")) {
        toolItemsEl.innerHTML = `
          <li>send_message({ text })</li>
          <li>search_chats({ query })</li>
          <li>get_recent_messages({ limit })</li>
        `;
      } else if (tab.url?.includes("motion.so") || tab.url?.includes("usemotion.com")) {
        toolItemsEl.innerHTML = `
          <li>create_task({ title })</li>
          <li>get_page_info()</li>
        `;
      } else {
        toolItemsEl.innerHTML = `
          <li>get_page_info()</li>
        `;
      }
    }
  } catch (err) {
    console.error(err);
  }

  testBtn.addEventListener("click", async () => {
    statusEl.textContent = "Calling get_page_info()...";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            world: "MAIN",
            func: async () => {
              if (window.modelContext) {
                return await window.modelContext.executeTool("get_page_info", {});
              }
              return { error: "window.modelContext not found" };
            },
          },
          (results) => {
            const res = results?.[0]?.result;
            statusEl.textContent = res ? JSON.stringify(res) : "Executed successfully!";
          }
        );
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    }
  });
});
