/* AcFun 文章区助手 - 共享存储工具
 * 通过 IIFE 暴露为 window.AcFunBlockStorage，供 content/popup/options/service-worker 共用
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

  /* ============================================================
   * 工具
   * ============================================================ */
  function extractUid(text) {
    if (!text) return null;
    const s = String(text).trim();
    if (!s) return null;
    const m = s.match(/\/(?:u|user)\/(\d+)/);
    if (m) return m[1];
    if (/^\d{1,20}$/.test(s)) return s;
    return null;
  }

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

  /* ============================================================
   * 基础读写
   * ============================================================ */
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

  // 直接覆盖整个 stored config（注意：会自动补齐默认值）
  async function replaceConfig(stored) {
    const next = deepMerge(DEFAULT_CONFIG, stored || {});
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function setEnabled(enabled) {
    return saveConfig({ enabled: !!enabled });
  }

  /* ============================================================
   * 单条 CRUD
   * 注意：addToBlock / addToMark 内部会做「屏蔽和关注互斥」处理
   * ============================================================ */
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

  /* ============================================================
   * 批量 IO：单次 storage 写入，避免 N 次 load+save
   * 入参 items: Array<{ uid, note? }>，uid 必填，note 可选
   * 行为：合并去重；不修改 markList / blockList 之间互斥（与单条一致）
   * ============================================================ */
  async function bulkAddToBlock(items) {
    if (!Array.isArray(items) || !items.length) return loadConfig();
    const cfg = await loadConfig();
    const blockSet = new Set(cfg.blockList);
    const markSet = new Set(cfg.markList);
    let changed = false;
    for (const it of items) {
      const uid = it && it.uid;
      if (!uid) continue;
      const sUid = String(uid);
      if (!blockSet.has(sUid)) {
        cfg.blockList.push(sUid);
        blockSet.add(sUid);
        changed = true;
      }
      if (markSet.delete(sUid)) {
        cfg.markList = cfg.markList.filter(id => id !== sUid);
        changed = true;
      }
      if (it.note) {
        cfg.notes[sUid] = it.note;
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function bulkAddToMark(items) {
    if (!Array.isArray(items) || !items.length) return loadConfig();
    const cfg = await loadConfig();
    const blockSet = new Set(cfg.blockList);
    const markSet = new Set(cfg.markList);
    let changed = false;
    for (const it of items) {
      const uid = it && it.uid;
      if (!uid) continue;
      const sUid = String(uid);
      if (!markSet.has(sUid)) {
        cfg.markList.push(sUid);
        markSet.add(sUid);
        changed = true;
      }
      if (blockSet.delete(sUid)) {
        cfg.blockList = cfg.blockList.filter(id => id !== sUid);
        changed = true;
      }
      if (it.note) {
        cfg.notes[sUid] = it.note;
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function clearBlock() {
    const cfg = await loadConfig();
    if (!cfg.blockList.length && !Object.keys(cfg.notes || {}).length) return cfg;
    cfg.blockList = [];
    // 屏蔽清空时，移除 notes 中所有属于屏蔽列表的（当前已为空，所以 notes 保留）
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  async function clearMark() {
    const cfg = await loadConfig();
    if (!cfg.markList.length) return cfg;
    cfg.markList = [];
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    return cfg;
  }

  /* ============================================================
   * 导入 / 导出
   * ============================================================ */
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

  /* ============================================================
   * 变更订阅
   * 所有调用方都可以注册监听；返回 unsubscribe 函数
   * ============================================================ */
  const listeners = new Set();
  let storageHookBound = false;

  function bindStorageHook() {
    if (storageHookBound) return;
    storageHookBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      // 失败回调吃掉异常，单个监听者错误不影响其他人
      for (const fn of listeners) {
        try { fn(changes[STORAGE_KEY].newValue); } catch (e) { console.error('[AcFunBlock] listener error', e); }
      }
    });
  }

  function onChange(fn) {
    bindStorageHook();
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ============================================================
   * 暴露
   * ============================================================ */
  global.AcFunBlockStorage = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    extractUid,
    loadConfig,
    saveConfig,
    replaceConfig,
    setEnabled,
    addToBlock,
    removeFromBlock,
    addToMark,
    removeFromMark,
    removeUser,
    setNote,
    bulkAddToBlock,
    bulkAddToMark,
    clearBlock,
    clearMark,
    exportAll,
    importAll,
    onChange
  };
})(
  // 兼容 service-worker（self）、content/popup/options（window）、Node（globalThis）
  typeof globalThis !== 'undefined' ? globalThis :
  typeof self !== 'undefined' ? self :
  typeof window !== 'undefined' ? window : {}
);
