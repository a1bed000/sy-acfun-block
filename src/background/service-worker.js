/* AcFun 文章区助手 - background service worker (MV3) */
try { importScripts('../shared/storage.js'); } catch (e) { console.error('[AcFunBlock] importScripts failed', e); }

// 兜底：service worker 里 self / globalThis 都存在；按优先级取
const _g = (typeof globalThis !== 'undefined' && globalThis)
  || (typeof self !== 'undefined' && self)
  || {};
const { loadConfig, onChange } = _g.AcFunBlockStorage || {};

async function refreshBadge() {
  if (!_g.AcFunBlockStorage) return;
  const cfg = await loadConfig();
  const count = (cfg.blockList || []).length + (cfg.markList || []).length;
  const text = cfg.enabled ? (count > 0 ? String(count) : 'ON') : 'OFF';
  const color = cfg.enabled ? '#FB8C00' : '#9E9E9E';
  try {
    if (typeof chrome === 'undefined' || !chrome.action) return;
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({
      title: `AcFun 文章区助手\n屏蔽 ${cfg.blockList.length} | 关注 ${cfg.markList.length}\n${cfg.enabled ? '已启用' : '已停用'}`
    });
  } catch (e) {
    // Badge update may fail in some contexts (e.g. first install before id ready)
  }
}

function safeListener(fn) {
  // 包装一层：吃掉单个 listener 抛错；同时必须透传 return 值，
  // 否则 onMessage 的异步 return true 会被吞掉，导致 sendResponse 通道被关闭。
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      console.error('[AcFunBlock] listener error', e);
    }
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener((details) => {
    // 不阻塞 onInstalled 流程；badge 更新失败也无所谓
    refreshBadge();
    if (details && details.reason === 'install' && chrome.runtime.openOptionsPage) {
      try { chrome.runtime.openOptionsPage(); } catch (e) { /* ignore */ }
    }
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => { refreshBadge(); });
  }

  if (typeof onChange === 'function') {
    onChange(refreshBadge);
  }

  chrome.runtime.onMessage.addListener(safeListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ACFUN_BLOCK_OPEN_OPTIONS') {
      if (chrome.runtime.openOptionsPage) {
        try { chrome.runtime.openOptionsPage(); } catch (e) { /* ignore */ }
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ACFUN_BLOCK_GET_TAB_INFO') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) { sendResponse({ ok: false, error: 'no active tab' }); return; }
        chrome.tabs.sendMessage(tab.id, { type: 'ACFUN_BLOCK_GET_CURRENT_UIDS' }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true, ...(resp || {}), tabUrl: tab.url, tabTitle: tab.title });
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
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ ok: true });
            }
          });
        } else {
          sendResponse({ ok: false, error: 'no active tab' });
        }
      });
      return true;
    }
  }));
}

// SW 冷启动后再跑一次
refreshBadge();
