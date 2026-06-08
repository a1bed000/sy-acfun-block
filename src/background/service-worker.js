/* AcFun 文章区助手 - background service worker (MV3) */
importScripts('../shared/storage.js');

const { loadConfig, onChange } = self.AcFunBlockStorage;

async function refreshBadge() {
  const cfg = await loadConfig();
  const count = (cfg.blockList || []).length + (cfg.markList || []).length;
  const text = cfg.enabled ? (count > 0 ? String(count) : 'ON') : 'OFF';
  const color = cfg.enabled ? '#FB8C00' : '#9E9E9E';
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({
      title: `AcFun 文章区助手\n屏蔽 ${cfg.blockList.length} | 关注 ${cfg.markList.length}\n${cfg.enabled ? '已启用' : '已停用'}`
    });
  } catch (e) {
    // Badge update may fail in some contexts
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await refreshBadge();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(refreshBadge);

onChange(refreshBadge);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'ACFUN_BLOCK_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'ACFUN_BLOCK_GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) { sendResponse({ ok: false }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'ACFUN_BLOCK_GET_CURRENT_UIDS' }, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, ...resp, tabUrl: tab.url, tabTitle: tab.title });
        }
      });
    });
    return true; // 异步
  }
  if (msg.type === 'ACFUN_BLOCK_REFRESH_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'ACFUN_BLOCK_REFRESH' }, () => {
          sendResponse({ ok: true });
        });
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }
});

refreshBadge();
