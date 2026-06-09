/* AcFun 文章区助手 - options 脚本 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  let cfg = null;

  /* 工具 */
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
    if (!cfg.blockList.length) return;
    if (!confirm('确定清空所有屏蔽用户？此操作不可撤销。')) return;
    await AcFunBlockStorage.clearBlock();
    await reload();
  });
  $('markClearBtn').addEventListener('click', async () => {
    if (!cfg.markList.length) return;
    if (!confirm('确定清空所有关注用户？此操作不可撤销。')) return;
    await AcFunBlockStorage.clearMark();
    await reload();
  });

  /* 搜索 */
  $('blockSearch').addEventListener('input', () => renderList('block'));
  $('markSearch').addEventListener('input', () => renderList('mark'));

  /* 批量添加（解析后走单次 bulkAddToBlock / bulkAddToMark IO） */
  function parseBulkLine(line) {
    // 支持 "UID:备注" / "UID 备注" / "链接 备注"
    const m1 = line.match(/^(\d{1,20})\s*[:：]\s*(.+)$/);
    if (m1) return { uid: m1[1], note: m1[2].trim() };
    const m3 = line.match(/\/(?:u|user)\/(\d+)(?:\s*[:：]?\s*(.+))?$/);
    if (m3) return { uid: m3[1], note: m3[2] ? m3[2].trim() : null };
    const m2 = line.match(/^(\d{1,20})(?:\s+(.+))?$/);
    if (m2) return { uid: m2[1], note: m2[2] ? m2[2].trim() : null };
    return null;
  }

  async function bulkAdd(type, text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const items = [];
    let skipped = 0;
    for (const line of lines) {
      const parsed = parseBulkLine(line);
      if (!parsed) { skipped++; continue; }
      items.push(parsed);
    }
    if (!items.length) return { added: 0, skipped };
    if (type === 'block') await AcFunBlockStorage.bulkAddToBlock(items);
    else await AcFunBlockStorage.bulkAddToMark(items);
    return { added: items.length, skipped };
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
    const uid = AcFunBlockStorage.extractUid($('modalUid').value);
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
      try { document.execCommand('copy'); } catch (_) {}
      setStatus($('copyExportBtn'), '已复制');
    }
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      $('importInput').value = text;
    } catch (err) {
      showImportStatus('读取文件失败：' + err.message, false);
    }
  });

  function parseImportText(text) {
    const data = { blockList: [], markList: [], notes: {} };
    let section = null;
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      if (t.startsWith('#')) {
        if (/^#\s*屏蔽/.test(t)) section = 'block';
        else if (/^#\s*关注/.test(t)) section = 'mark';
        else section = null;
        continue;
      }
      const parsed = parseBulkLine(t);
      if (!parsed) continue;
      if (section === 'block') data.blockList.push(parsed.uid);
      else if (section === 'mark') data.markList.push(parsed.uid);
      else data.blockList.push(parsed.uid);  // 无 section 时默认屏蔽
      if (parsed.note) data.notes[parsed.uid] = parsed.note;
    }
    return data;
  }

  $('importTextBtn').addEventListener('click', async () => {
    const text = $('importInput').value.trim();
    if (!text) { showImportStatus('请输入或选择要导入的内容', false); return; }
    const mode = $('importMode').value;
    try {
      let data;
      if (text.startsWith('{')) {
        data = JSON.parse(text);
      } else {
        data = parseImportText(text);
      }
      if (!data || typeof data !== 'object') throw new Error('解析结果为空');
      await AcFunBlockStorage.importAll(data, mode);
      showImportStatus(`已${mode === 'replace' ? '替换' : '合并'}导入`, true);
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
