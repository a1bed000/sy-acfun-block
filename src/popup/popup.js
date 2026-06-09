/* AcFun 文章区助手 - popup 脚本 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const enabledEl = $('enabled');
  const blockCountEl = $('blockCount');
  const markCountEl = $('markCount');
  const pageCountEl = $('pageCount');
  const pageUrlEl = $('pageUrl');
  const addForm = $('addForm');
  const addUidEl = $('addUid');
  const addMarkBtn = $('addMarkBtn');
  const pageUsersEl = $('pageUsers');
  const refreshBtn = $('refreshBtn');
  const optionsBtn = $('optionsBtn');

  // 缓存当前页 UID 列表（供按钮操作后立即重渲染）
  let currentUids = [];

  function renderConfig(cfg) {
    enabledEl.checked = !!cfg.enabled;
    blockCountEl.textContent = cfg.blockList.length;
    markCountEl.textContent = cfg.markList.length;
  }

  function renderPageUsers(uids, cfg) {
    currentUids = uids || [];
    pageCountEl.textContent = currentUids.length;
    if (!currentUids.length) {
      pageUsersEl.innerHTML = '<div class="empty">未检测到（可能不在文章区页面）</div>';
      return;
    }
    pageUsersEl.innerHTML = '';
    currentUids.slice(0, 20).forEach(uid => {
      const row = document.createElement('div');
      row.className = 'user-row';

      const inBlock = cfg.blockList.includes(uid);
      const inMark = cfg.markList.includes(uid);

      const uidEl = document.createElement('span');
      uidEl.className = 'uid';
      uidEl.textContent = uid;
      row.appendChild(uidEl);

      const status = document.createElement('span');
      status.className = 'status ' + (inBlock ? 'blocked' : inMark ? 'marked' : 'normal');
      status.textContent = inBlock ? '已屏蔽' : inMark ? '已关注' : '正常';
      row.appendChild(status);

      const btn = document.createElement('button');
      if (inBlock) {
        btn.textContent = '解除';
        btn.className = 'unblock';
        btn.onclick = async () => {
          await AcFunBlockStorage.removeFromBlock(uid);
          sendRefresh();
        };
      } else if (inMark) {
        btn.textContent = '取消';
        btn.className = 'unmark';
        btn.onclick = async () => {
          await AcFunBlockStorage.removeFromMark(uid);
          sendRefresh();
        };
      } else {
        btn.textContent = '屏蔽';
        btn.onclick = async () => {
          await AcFunBlockStorage.addToBlock(uid);
          sendRefresh();
        };
      }
      row.appendChild(btn);
      pageUsersEl.appendChild(row);
    });
    if (currentUids.length > 20) {
      const more = document.createElement('div');
      more.className = 'empty';
      more.textContent = `…还有 ${currentUids.length - 20} 个`;
      pageUsersEl.appendChild(more);
    }
  }

  function sendRefresh() {
    try {
      chrome.runtime.sendMessage({ type: 'ACFUN_BLOCK_REFRESH_TAB' });
    } catch (e) { /* popup 关闭中 */ }
  }

  async function refresh() {
    const cfg = await AcFunBlockStorage.loadConfig();
    renderConfig(cfg);
    try {
      chrome.runtime.sendMessage({ type: 'ACFUN_BLOCK_GET_TAB_INFO' }, (resp) => {
        if (chrome.runtime.lastError) {
          pageUrlEl.textContent = '（无法读取当前页面）';
          renderPageUsers([], cfg);
          return;
        }
        if (!resp || !resp.ok) {
          pageUrlEl.textContent = '（无法读取当前页面，可能不是 acfun.cn）';
          renderPageUsers([], cfg);
          return;
        }
        pageUrlEl.textContent = resp.tabUrl || resp.url || '';
        renderPageUsers(resp.uids || [], cfg);
      });
    } catch (e) {
      pageUrlEl.textContent = '（无法读取当前页面）';
      renderPageUsers([], cfg);
    }
  }

  // 事件绑定
  enabledEl.addEventListener('change', async (e) => {
    await AcFunBlockStorage.setEnabled(e.target.checked);
    sendRefresh();
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = AcFunBlockStorage.extractUid(addUidEl.value);
    if (!uid) { addUidEl.focus(); return; }
    await AcFunBlockStorage.addToBlock(uid);
    addUidEl.value = '';
    sendRefresh();
  });

  addMarkBtn.addEventListener('click', async () => {
    const uid = AcFunBlockStorage.extractUid(addUidEl.value);
    if (!uid) { addUidEl.focus(); return; }
    await AcFunBlockStorage.addToMark(uid);
    addUidEl.value = '';
    sendRefresh();
  });

  refreshBtn.addEventListener('click', () => { sendRefresh(); refresh(); });
  optionsBtn.addEventListener('click', () => { try { chrome.runtime.openOptionsPage(); } catch (e) {} });

  // 订阅 storage 变化，避免 storage 变更后 popup UI 滞后
  AcFunBlockStorage.onChange((newCfg) => {
    renderConfig(newCfg);
    // 当前页 UID 列表不变，但每个用户的状态变了，重渲染
    if (currentUids.length) renderPageUsers(currentUids, newCfg);
  });

  // 启动
  refresh();
})();
