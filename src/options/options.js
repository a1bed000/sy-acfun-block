/* AcFun 文章区助手 - options 脚本 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  let cfg = null;

  /* 工具 */
  function extractUid(text) {
    if (!text) return null;
    text = String(text).trim();
    const m = text.match(/\/(?:u|user)\/(\d+)/);
    if (m) return m[1];
    if (/^\d{1,20}$/.test(text)) return text;
    return null;
  }

  function showImportStatus(msg, ok) {
    const el = $('importStatus');
    el.className = 'status-line ' + (ok ? 'ok' : 'err');
    el.textContent = msg;
  }

  function setStatus(btn, text, ms) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, ms || 1200);
  }

  /* Tabs */
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.querySelector(`.panel[data-panel="${name}"]`).classList.add('active');
    });
  });

  /* 列表渲染 */
  function renderList(type) {
    const list = type === 'block' ? cfg.blockList : cfg.markList;
    const listEl = $(type + 'List');
    const search = $((type === 'block' ? 'block' : 'mark') + 'Search');
    const keyword = (search.value || '').trim().toLowerCase();

    if (!list || !list.length) {
      listEl.innerHTML = '<div class="empty">暂无' + (type === 'block' ? '屏蔽' : '关注') + '用户</div>';
      return;
    }

    let rows = list.map(uid => ({ uid, note: cfg.notes[uid] || '' }));
    if (keyword) {
      rows = rows.filter(r => r.uid.includes(keyword) || (r.note && r.note.toLowerCase().includes(keyword)));
    }
    rows.sort((a, b) => a.uid.localeCompare(b.uid));

    if (!rows.length) {
      listEl.innerHTML = '<div class="empty">没有匹配的记录</div>';
      return;
    }

    listEl.innerHTML = '';
    rows.forEach(({ uid, note }) => {
      const row = document.createElement('div');
      row.className = 'list-row';

      const a = document.createElement('a');
      a.className = 'uid';
      a.href = `https://www.acfun.cn/u/${uid}`;
      a.target = '_blank';
      a.textContent = uid;
      row.appendChild(a);

      const noteEl = document.createElement('input');
      noteEl.className = 'note-input';
      noteEl.value = note;
      noteEl.placeholder = '添加备注…';
      noteEl.addEventListener('change', async () => {
        await AcFunBlockStorage.setNote(uid, noteEl.value.trim());
        await reload();
      });
      noteEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') noteEl.blur();
      });
      row.appendChild(noteEl);

      const delBtn = document.createElement('button');
      delBtn.className = 'icon';
      delBtn.textContent = '✕';
      delBtn.title = '从' + (type === 'block' ? '屏蔽' : '关注') + '名单移除';
      delBtn.onclick = async () => {
        if (type === 'block') await AcFunBlockStorage.removeFromBlock(uid);
        else await AcFunBlockStorage.removeFromMark(uid);
        await reload();
      };
      row.appendChild(delBtn);

      listEl.appendChild(row);
    });
  }

  /* 设置渲染 */
  function renderSettings() {
    $('setEnabled').checked = !!cfg.enabled;
    $('setProcessComments').checked = !!cfg.processComments;
    $('setShowQuickButton').checked = !!cfg.showQuickButton;
    $('setMarkColor').value = cfg.markColor || '#fff3a0';
    document.querySelectorAll('input[name="blockMode"]').forEach(r => {
      r.checked = (r.value === (cfg.blockMode || 'hide'));
    });
    document.querySelectorAll('input[name="markStyle"]').forEach(r => {
      r.checked = (r.value === (cfg.markStyle || 'highlight'));
    });
  }

  function renderBadges() {
    $('tabBlockBadge').textContent = cfg.blockList.length;
    $('tabMarkBadge').textContent = cfg.markList.length;
  }

  async function reload() {
    cfg = await AcFunBlockStorage.loadConfig();
    renderBadges();
    renderList('block');
    renderList('mark');
    renderSettings();
  }

  /* 屏蔽 / 关注 添加按钮 */
  $('blockAddBtn').addEventListener('click', () => openModal('block'));
  $('markAddBtn').addEventListener('click', () => openModal('mark'));

  $('blockClearBtn').addEventListener('click', async () => {
    if (!confirm('确定清空所有屏蔽用户？此操作不可撤销。')) return;
    for (const uid of [...cfg.blockList]) {
      await AcFunBlockStorage.removeFromBlock(uid);
    }
    await reload();
  });
  $('markClearBtn').addEventListener('click', async () => {
    if (!confirm('确定清空所有关注用户？此操作不可撤销。')) return;
    for (const uid of [...cfg.markList]) {
      await AcFunBlockStorage.removeFromMark(uid);
    }
    await reload();
  });

  /* 搜索 */
  $('blockSearch').addEventListener('input', () => renderList('block'));
  $('markSearch').addEventListener('input', () => renderList('mark'));

  /* 批量添加 */
  async function bulkAdd(type, text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    for (const line of lines) {
      // 支持 "UID:备注" 或 "UID 备注" 格式
      const m1 = line.match(/^(\d{1,20})\s*[:：]\s*(.+)$/);
      const m2 = line.match(/^(\d{1,20})(?:\s+(.+))?$/);
      const m3 = line.match(/\/(?:u|user)\/(\d+)(?:\s*[:：]?\s*(.+))?$/);

      let uid = null, note = null;
      if (m1) { uid = m1[1]; note = m1[2].trim(); }
      else if (m3) { uid = m3[1]; note = m3[2] ? m3[2].trim() : null; }
      else if (m2) { uid = m2[1]; note = m2[2] ? m2[2].trim() : null; }

      if (!uid) { skipped++; continue; }
      if (type === 'block') await AcFunBlockStorage.addToBlock(uid, note);
      else await AcFunBlockStorage.addToMark(uid, note);
      added++;
    }
    return { added, skipped };
  }

  $('blockBulkBtn').addEventListener('click', async (e) => {
    const text = $('blockBulkInput').value;
    if (!text.trim()) return;
    const r = await bulkAdd('block', text);
    $('blockBulkInput').value = '';
    setStatus(e.target, `已添加 ${r.added} 个${r.skipped ? `，跳过 ${r.skipped} 个无效行` : ''}`);
    await reload();
  });

  $('markBulkBtn').addEventListener('click', async (e) => {
    const text = $('markBulkInput').value;
    if (!text.trim()) return;
    const r = await bulkAdd('mark', text);
    $('markBulkInput').value = '';
    setStatus(e.target, `已添加 ${r.added} 个${r.skipped ? `，跳过 ${r.skipped} 个无效行` : ''}`);
    await reload();
  });

  /* 设置项 change */
  $('setEnabled').addEventListener('change', (e) => AcFunBlockStorage.setEnabled(e.target.checked));
  $('setProcessComments').addEventListener('change', (e) => AcFunBlockStorage.saveConfig({ processComments: e.target.checked }));
  $('setShowQuickButton').addEventListener('change', (e) => AcFunBlockStorage.saveConfig({ showQuickButton: e.target.checked }));
  $('setMarkColor').addEventListener('change', (e) => AcFunBlockStorage.saveConfig({ markColor: e.target.value }));
  document.querySelectorAll('input[name="blockMode"]').forEach(r => {
    r.addEventListener('change', (e) => {
      if (e.target.checked) AcFunBlockStorage.saveConfig({ blockMode: e.target.value });
    });
  });
  document.querySelectorAll('input[name="markStyle"]').forEach(r => {
    r.addEventListener('change', (e) => {
      if (e.target.checked) AcFunBlockStorage.saveConfig({ markStyle: e.target.value });
    });
  });

  /* 模态框 */
  let modalMode = 'block';
  function openModal(mode) {
    modalMode = mode;
    $('modalTitle').textContent = mode === 'block' ? '添加到屏蔽名单' : '添加到关注名单';
    $('modalUid').value = '';
    $('modalNote').value = '';
    $('modal').hidden = false;
    $('modalUid').focus();
  }
  function closeModal() { $('modal').hidden = true; }
  $('modalCancelBtn').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('modalOkBtn').addEventListener('click', async () => {
    const uid = extractUid($('modalUid').value);
    if (!uid) { alert('请输入有效的 UID 或用户主页链接'); return; }
    const note = $('modalNote').value.trim();
    if (modalMode === 'block') await AcFunBlockStorage.addToBlock(uid, note);
    else await AcFunBlockStorage.addToMark(uid, note);
    closeModal();
    await reload();
  });
  $('modalUid').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('modalOkBtn').click(); });

  /* 导入 / 导出 */
  $('exportJsonBtn').addEventListener('click', () => {
    $('exportOutput').value = JSON.stringify({
      blockList: cfg.blockList,
      markList: cfg.markList,
      notes: cfg.notes
    }, null, 2);
  });

  $('exportTextBtn').addEventListener('click', () => {
    const lines = [];
    lines.push('# 屏蔽名单');
    cfg.blockList.forEach(uid => {
      const note = cfg.notes[uid];
      lines.push(note ? `${uid}: ${note}` : uid);
    });
    lines.push('');
    lines.push('# 关注名单');
    cfg.markList.forEach(uid => {
      const note = cfg.notes[uid];
      lines.push(note ? `${uid}: ${note}` : uid);
    });
    $('exportOutput').value = lines.join('\n');
  });

  $('copyExportBtn').addEventListener('click', async () => {
    const text = $('exportOutput').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus($('copyExportBtn'), '已复制');
    } catch (e) {
      $('exportOutput').select();
      document.execCommand('copy');
      setStatus($('copyExportBtn'), '已复制');
    }
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    $('importInput').value = text;
  });

  $('importTextBtn').addEventListener('click', async () => {
    const text = $('importInput').value.trim();
    if (!text) { showImportStatus('请输入或选择要导入的内容', false); return; }
    const mode = $('importMode').value;
    try {
      // 先尝试 JSON
      if (text.startsWith('{')) {
        const data = JSON.parse(text);
        await AcFunBlockStorage.importAll(data, mode);
        showImportStatus(`已${mode === 'replace' ? '替换' : '合并'}导入（JSON 格式）`, true);
      } else {
        // 解析纯文本
        const data = { blockList: [], markList: [], notes: {} };
        let section = null;
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          if (t.startsWith('# 屏蔽') || t.startsWith('# 屏蔽名单')) { section = 'block'; continue; }
          if (t.startsWith('# 关注') || t.startsWith('# 关注名单')) { section = 'mark'; continue; }
          if (t.startsWith('#')) { section = null; continue; }

          const m1 = t.match(/^(\d{1,20})\s*[:：]\s*(.+)$/);
          const m2 = t.match(/^(\d{1,20})$/);
          let uid = null, note = null;
          if (m1) { uid = m1[1]; note = m1[2].trim(); }
          else if (m2) { uid = m2[1]; }
          if (!uid) continue;
          if (section === 'block') data.blockList.push(uid);
          else if (section === 'mark') data.markList.push(uid);
          else data.blockList.push(uid);  // 无 section 时默认屏蔽
          if (note) data.notes[uid] = note;
        }
        await AcFunBlockStorage.importAll(data, mode);
        showImportStatus(`已${mode === 'replace' ? '替换' : '合并'}导入（文本格式）`, true);
      }
      $('importInput').value = '';
      await reload();
    } catch (err) {
      console.error(err);
      showImportStatus('导入失败：' + err.message, false);
    }
  });

  /* 启动 */
  AcFunBlockStorage.onChange((newCfg) => {
    cfg = newCfg;
    renderBadges();
    renderList('block');
    renderList('mark');
    renderSettings();
  });

  reload();
})();
