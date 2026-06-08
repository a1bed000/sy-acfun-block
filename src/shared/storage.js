/* AcFun 文章区助手 - 共享存储工具
 * 通过 IIFE 暴露为 window.AcFunBlockStorage，供 content/popup/options 共用
 * (content script 不能用 ES module，所以用全局命名空间)
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'acfun_block_data';

  const DEFAULT_CONFIG = {
    enabled: true,
    blockMode: 'hide',        // 'hide' | 'collapse' | 'dim'
    markStyle: 'highlight',   // 'highlight' | 'badge' | 'border'
    markColor: '#fff3a0',
    hideColor: '#2a2a2a',
    showPlaceholder: true,    // 折叠时显示占位
    processComments: true,    // 同时处理评论区
    showQuickButton: true,    // 文章卡片上显示快捷按钮
    blockList: [],
    markList: [],
    notes: {}                 // uid -> 备注
  };

  function deepMerge(target, source) {
    const out = Array.isArray(target) ? target.slice() : Object.assign({}, target);
    if (!source || typeof source !== 'object') return out;
    for (const key of Object.keys(source)) {
      const sv = source[key];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) && out[key] && typeof out[key] === 'object') {
        out[key] = deepMerge(out[key], sv);
      } else {
        out[key] = sv;
      }
    }
    return out;
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY] || {};
    return deepMerge(DEFAULT_CONFIG, stored);
  }

  async function saveConfig(patch) {
    const current = await loadConfig();
    const next = deepMerge(current, patch || {});
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function setEnabled(enabled) {
    return saveConfig({ enabled: !!enabled });
  }

  async function addToBlock(uid, note) {
    if (!uid) return loadConfig();
    const cfg = await loadConfig();
    if (!cfg.blockList.includes(uid)) cfg.blockList.push(uid);
    cfg.markList = cfg.markList.filter(id => id !== uid);
    if (note) cfg.notes[String(uid)] = note;
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function removeFromBlock(uid) {
    const cfg = await loadConfig();
    cfg.blockList = cfg.blockList.filter(id => id !== uid);
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function addToMark(uid, note) {
    if (!uid) return loadConfig();
    const cfg = await loadConfig();
    if (!cfg.markList.includes(uid)) cfg.markList.push(uid);
    cfg.blockList = cfg.blockList.filter(id => id !== uid);
    if (note) cfg.notes[String(uid)] = note;
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function removeFromMark(uid) {
    const cfg = await loadConfig();
    cfg.markList = cfg.markList.filter(id => id !== uid);
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function removeUser(uid) {
    const cfg = await loadConfig();
    cfg.blockList = cfg.blockList.filter(id => id !== uid);
    cfg.markList = cfg.markList.filter(id => id !== uid);
    delete cfg.notes[String(uid)];
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function setNote(uid, note) {
    const cfg = await loadConfig();
    if (note) cfg.notes[String(uid)] = note;
    else delete cfg.notes[String(uid)];
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function exportAll() {
    return loadConfig();
  }

  async function importAll(data, mode) {
    if (!data || typeof data !== 'object') throw new Error('数据格式错误');
    const cfg = await loadConfig();
    if (mode === 'replace') {
      return saveConfig({
        blockList: Array.isArray(data.blockList) ? data.blockList.slice() : [],
        markList: Array.isArray(data.markList) ? data.markList.slice() : [],
        notes: data.notes && typeof data.notes === 'object' ? Object.assign({}, data.notes) : {}
      });
    }
    // merge
    const merged = {
      blockList: Array.from(new Set([...(cfg.blockList || []), ...(data.blockList || [])])),
      markList: Array.from(new Set([...(cfg.markList || []), ...(data.markList || [])])),
      notes: Object.assign({}, cfg.notes || {}, data.notes || {})
    };
    return saveConfig(merged);
  }

  // 订阅变更：所有调用方都可以注册监听
  const listeners = new Set();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    for (const fn of listeners) {
      try { fn(changes[STORAGE_KEY].newValue); } catch (e) { console.error('[AcFunBlock] listener error', e); }
    }
  });

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  global.AcFunBlockStorage = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    setEnabled,
    addToBlock,
    removeFromBlock,
    addToMark,
    removeFromMark,
    removeUser,
    setNote,
    exportAll,
    importAll,
    onChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
