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

  function extractUidFromInput(text) {
    if (!text) return null;
    text = text.trim();
    const m1 = text.match(/\/(?:u|user)\/(\d+)/);
    if (m1) return m1[1];
    if (/^\d+$/.test(text)) return text;
    return null;
  }

  function renderConfig(cfg) {
    enabledEl.checked = !!cfg.enabled;
    blockCountEl.textContent = cfg.blockList.length;
    markCountEl.textContent = cfg.markList.length;
  }

  function renderPageUsers(uids, cfg) {
    pageCountEl.textContent = uids.length;
    if (!uids.length) {
      pageUsersEl.innerHTML = '<div class="empty">未检测到（可能不在文章区页面）</div>';
      return;
    }
    pageUsersEl.innerHTML = '';
    uids.slice(0, 20).forEach(uid => {
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
          const cfg2 = await AcFunBlockStorage.loadConfig();
          renderConfig(cfg2);
          renderPageUsers(uids, cfg2);
          sendRefresh();
        };
      } else if (inMark) {
        btn.textContent = '取消';
        btn.className = 'unmark';
        btn.onclick = async () => {
          await AcFunBlockStorage.removeFromMark(uid);
          const cfg2 = await AcFunBlockStorage.loadConfig();
          renderConfig(cfg2);
          renderPageUsers(uids, cfg2);
          sendRefresh();
        };
      } else {
        btn.textContent = '屏蔽';
        btn.onclick = async () => {
          await AcFunBlockStorage.addToBlock(uid);
          const cfg2 = await AcFunBlockStorage.loadConfig();
          renderConfig(cfg2);
          renderPageUsers(uids, cfg2);
          sendRefresh();
        };
      }
      row.appendChild(btn);
      pageUsersEl.appendChild(row);
    });
    if (uids.length > 20) {
      const more = document.createElement('div');
      more.className = 'empty';
      more.textContent = `…还有 ${uids.length - 20} 个`;
      pageUsersEl.appendChild(more);
    }
  }

  function sendRefresh() {
    chrome.runtime.sendMessage({ type: 'ACFUN_BLOCK_REFRESH_TAB' });
  }

  async function refresh() {
    const cfg = await AcFunBlockStorage.loadConfig();
    renderConfig(cfg);
    chrome.runtime.sendMessage({ type: 'ACFUN_BLOCK_GET_TAB_INFO' }, (resp) => {
      if (!resp || !resp.ok) {
        pageUrlEl.textContent = '（无法读取当前页面，可能不是 acfun.cn）';
        renderPageUsers([], cfg);
        return;
      }
      pageUrlEl.textContent = resp.tabUrl || resp.url || '';
      renderPageUsers(resp.uids || [], cfg);
    });
  }

  // 事件绑定
  enabledEl.addEventListener('change', async (e) => {
    await AcFunBlockStorage.setEnabled(e.target.checked);
    sendRefresh();
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = extractUidFromInput(addUidEl.value);
    if (!uid) {
      addUidEl.focus();
      return;
    }
    await AcFunBlockStorage.addToBlock(uid);
    addUidEl.value = '';
    sendRefresh();
    refresh();
  });

  addMarkBtn.addEventListener('click', async () => {
    const uid = extractUidFromInput(addUidEl.value);
    if (!uid) { addUidEl.focus(); return; }
    await AcFunBlockStorage.addToMark(uid);
    addUidEl.value = '';
    sendRefresh();
    refresh();
  });

  refreshBtn.addEventListener('click', () => { sendRefresh(); refresh(); });
  optionsBtn.addEventListener('click', () => { chrome.runtime.openOptionsPage(); });

  // 启动
  refresh();
})();
