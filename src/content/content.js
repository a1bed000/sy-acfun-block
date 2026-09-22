/* AcFun 文章区助手 - content script
 * 负责：扫描文章列表/详情/评论，识别 UID，应用屏蔽/标记规则
 *
 * 性能策略：
 *   - 首次 / config 变更：全量扫描
 *   - MutationObserver 触发：仅处理新增节点中的 article links / comment items
 *   - 用 WeakSet 记录已处理元素，unprocessAll 时整体替换（WeakSet 不可 clear）
 *   - 按 card 去重，避免同一卡片内的多个 article link 抢处理
 */
(function () {
  'use strict';
  if (window.__acfunBlockInjected) return;
  window.__acfunBlockInjected = true;

  const USER_LINK_RE = /\/(?:u|user)\/(\d+)/;
  // 新版文章详情页 URL：https://www.acfun.cn/a/ac12345678
  const ARTICLE_DETAIL_RE = /^\/a\/ac\d+/;
  // 站内文章链接（频道页 / 列表页卡片，以及正文里的站内文章链接）
  const ARTICLE_LINK_RE = /\/a\/ac\d+/;
  // 旧版 /v/as<id> 详情页兼容（频道页同样命中该前缀，需要用 DOM 进一步区分）
  const LEGACY_DETAIL_RE = /^\/v\/as\d+/;
  const COMMENT_HINT_RE = /comment|reply|comment-item|commentItem|CommentList|comment-list/i;

  let config = null;
  let observer = null;
  let debounceTimer = null;
  let pendingMutations = [];

  // 已处理元素集合（WeakSet 不可 clear，通过"重新创建 + 切换引用"达到重置效果）
  let processedCards = new WeakSet();
  let processedComments = new WeakSet();
  let processedDetail = null;            // 详情页正文节点
  let processedPlaceholder = null;       // 当前占位卡片的 uid（防重复插入）

  function resetProcessedSets() {
    processedCards = new WeakSet();
    processedComments = new WeakSet();
    processedDetail = null;
    processedPlaceholder = null;
  }

  /* ============================================================
   * 工具函数
   * ============================================================ */
  function extractUid(href) {
    if (!href) return null;
    const m = String(href).match(USER_LINK_RE);
    return m ? m[1] : null;
  }

  function isOnArticleDetail() {
    if (ARTICLE_DETAIL_RE.test(location.pathname)) return true;
    // /v/as<id> 是文章频道页（如 /v/as7 情感）；只有旧版详情页才会有文章主体容器
    if (LEGACY_DETAIL_RE.test(location.pathname)) {
      return !!document.querySelector('#article-content, #article-up, .article-up');
    }
    return false;
  }

  function showTip(message, type) {
    const tip = document.createElement('div');
    tip.className = 'acfun-floating-tip' + (type ? ' is-' + type : '');
    tip.textContent = message;
    document.body.appendChild(tip);
    setTimeout(() => {
      tip.style.transition = 'opacity 0.3s';
      tip.style.opacity = '0';
      setTimeout(() => tip.remove(), 320);
    }, 1800);
  }

  /* ============================================================
   * 容器识别
   * ============================================================ */
  // 卡片容器特征类名（AcFun 文章卡片：article-item / weblog-item 等）
  const CARD_HINT_RE = /(?:^|[\s-])(?:article-item|weblog-item|feed-item|item|card)(?:[\s-]|$)/i;

  function findCardContainer(articleLink) {
    if (!articleLink) return null;
    // 链接自己就是卡片节点（少数列表直接以 li / article 承载）
    if (articleLink.tagName === 'LI' || articleLink.tagName === 'ARTICLE') return articleLink;

    // 向上找卡片容器；不要因为链接自身的 "item" 类名而返回链接本身
    let el = articleLink.parentElement;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (el.tagName === 'LI' || el.tagName === 'ARTICLE' || CARD_HINT_RE.test(cls)) {
        return el;
      }
      el = el.parentElement;
    }
    return articleLink.parentElement || articleLink;
  }

  function findAuthorInContainer(container) {
    if (!container) return null;
    // 在容器里找形如 /u/数字 的链接
    const links = container.querySelectorAll('a[href]');
    for (const link of links) {
      if (USER_LINK_RE.test(link.href)) {
        return link;
      }
    }
    return null;
  }

  function findDetailContainer() {
    // 只认文章详情页专属容器，不能用 main 兜底：
    // /v/as7 这类频道页也有 <main>，会把频道页第一篇文章的作者误判为“当前文章作者”。
    const candidates = [
      '#article-content',   // section#article-content：作者区 + 正文
      '#article-up',        // div#article-up：作者区（含正文）
      '.article-up',
      '[class*="article-detail"]',
      '[class*="ArticleDetail"]'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // 从单个节点向上找 comment 容器（单点版本，给增量扫描用）
  function findCommentContainerFor(link) {
    if (!USER_LINK_RE.test(link.href)) return null;
    let el = link;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      el = el.parentElement;
      if (!el) break;
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (COMMENT_HINT_RE.test(cls) || el.tagName === 'LI' && /comment/i.test(cls)) {
        return el;
      }
    }
    return null;
  }

  // 全量扫描评论区用
  function findCommentItems() {
    const out = [];
    const allLinks = document.querySelectorAll('a[href*="/u/"]');
    for (const link of allLinks) {
      const c = findCommentContainerFor(link);
      if (c) out.push({ el: c, authorLink: link });
    }
    return out;
  }

  /* ============================================================
   * 规则应用
   * ============================================================ */
  function clearMarks(el) {
    el.classList.remove(
      'acfun-block-hidden',
      'acfun-block-collapsed',
      'acfun-block-dim',
      'acfun-mark-highlight',
      'acfun-mark-badge',
      'acfun-mark-border',
      'acfun-quick-host'
    );
    el.removeAttribute('data-acfun-block-processed');
    el.removeAttribute('data-acfun-uid');
    el.removeAttribute('data-acfun-action');
    el.style.removeProperty('--acfun-mark-color');
    // 移除快捷按钮
    const btn = el.querySelector(':scope > .acfun-quick-action');
    if (btn) btn.remove();
  }

  function applyBlock(el, uid) {
    el.classList.remove('acfun-mark-highlight', 'acfun-mark-badge', 'acfun-mark-border');
    el.setAttribute('data-acfun-block-processed', '1');
    el.setAttribute('data-acfun-uid', uid);
    const mode = config.blockMode || 'hide';
    if (mode === 'collapse') {
      el.classList.add('acfun-block-collapsed');
    } else if (mode === 'dim') {
      el.classList.add('acfun-block-dim');
    } else {
      el.classList.add('acfun-block-hidden');
    }
  }

  function applyMark(el, uid) {
    el.classList.remove('acfun-block-hidden', 'acfun-block-collapsed', 'acfun-block-dim');
    el.setAttribute('data-acfun-block-processed', '1');
    el.setAttribute('data-acfun-uid', uid);
    const style = config.markStyle || 'highlight';
    el.style.setProperty('--acfun-mark-color', config.markColor || '#fff3a0');
    if (style === 'badge') el.classList.add('acfun-mark-badge');
    else if (style === 'border') el.classList.add('acfun-mark-border');
    else el.classList.add('acfun-mark-highlight');
  }

  function addQuickButton(el, uid) {
    if (!config.showQuickButton) return;
    if (el.querySelector(':scope > .acfun-quick-action')) return;

    // 让绝对定位的快捷按钮以卡片为参照
    el.classList.add('acfun-quick-host');

    const inBlock = config.blockList.includes(uid);
    const inMark = config.markList.includes(uid);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acfun-quick-action' + (inBlock ? ' is-blocked' : inMark ? ' is-marked' : '');
    btn.textContent = inBlock ? '已屏蔽' : inMark ? '已关注' : '屏蔽';
    btn.title = `UID: ${uid}`;
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await toggleUser(uid, inBlock ? 'unblock' : inMark ? 'unmark' : 'block');
    });
    el.appendChild(btn);
  }

  function processItem(el, uid, authorLink) {
    // 屏蔽：作用整个 el（卡片 / 详情页正文）
    // 关注：只作用作者署名那一小块，**不**染色整张卡片
    const byline = findBylineContainer(authorLink);

    // 先清掉 el 和 byline 上可能残留的标记
    clearMarks(el);
    if (byline && byline !== el) clearMarks(byline);

    if (config.blockList.includes(uid)) {
      applyBlock(el, uid);
    } else if (config.markList.includes(uid)) {
      if (byline) applyMark(byline, uid);
    }
    // 无论是否命中名单，都记录“已处理”，这样 unprocessAll 能清理快捷按钮并重建状态
    el.setAttribute('data-acfun-block-processed', '1');
    el.setAttribute('data-acfun-uid', uid);
    // 始终在卡片上添加快捷按钮（即便未屏蔽/标记也能快速操作）
    if (config.showQuickButton) addQuickButton(el, uid);
  }

  function findBylineContainer(authorLink) {
    if (!authorLink) return null;
    // 1) 优先找 class 含 author / byline / user 的祖先
    let el = authorLink.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 5) {
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (/author|byline|user[-_]?info|username|userName|publish|meta/i.test(cls)) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }
    // 2) 没有合适的祖先，用父级
    const parent = authorLink.parentElement;
    if (!parent) return authorLink;

    // 3) 父级太大（基本就是整张卡片），就降级到作者链接本身
    try {
      const pr = parent.getBoundingClientRect();
      const lr = authorLink.getBoundingClientRect();
      if (pr.width > lr.width * 4 && pr.height > lr.height * 3) {
        return authorLink;
      }
    } catch (e) { /* getBoundingClientRect 可能在隐藏元素上抛错 */ }
    return parent;
  }

  async function toggleUser(uid, action) {
    if (!uid) return;
    if (action === 'block') {
      await AcFunBlockStorage.addToBlock(uid);
      showTip(`已屏蔽 UID ${uid}`, 'success');
    } else if (action === 'unblock') {
      await AcFunBlockStorage.removeFromBlock(uid);
      showTip(`已解除屏蔽 UID ${uid}`, 'success');
    } else if (action === 'mark') {
      await AcFunBlockStorage.addToMark(uid);
      showTip(`已关注 UID ${uid}`, 'success');
    } else if (action === 'unmark') {
      await AcFunBlockStorage.removeFromMark(uid);
      showTip(`已取消关注 UID ${uid}`, 'success');
    }
  }

  /* ============================================================
   * 悬停浮动工具栏
   *   鼠标悬停在 /u/数字 链接上时弹出，可在任何页面/位置使用
   * ============================================================ */
  let hoverToolbar = null;
  let hoverCurrentLink = null;
  let hoverCurrentUid = null;
  let hoverHideTimer = null;

  function ensureHoverToolbar() {
    if (hoverToolbar) return hoverToolbar;
    hoverToolbar = document.createElement('div');
    hoverToolbar.className = 'acfun-hover-toolbar';
    hoverToolbar.setAttribute('data-acfun-block', 'hover-toolbar');
    document.body.appendChild(hoverToolbar);

    // 鼠标进入工具栏时取消隐藏，离开时延迟隐藏
    hoverToolbar.addEventListener('mouseenter', () => {
      if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
    });
    hoverToolbar.addEventListener('mouseleave', () => {
      scheduleHoverHide();
    });

    return hoverToolbar;
  }

  function renderHoverToolbar(uid) {
    const tb = ensureHoverToolbar();
    const inBlock = config.blockList.includes(uid);
    const inMark = config.markList.includes(uid);
    const note = (config.notes && config.notes[uid]) || '';

    tb.innerHTML = '';

    // 头部：UID + 状态标签
    const head = document.createElement('div');
    head.className = 'acfun-hover-head';

    const uidEl = document.createElement('span');
    uidEl.className = 'acfun-hover-uid';
    uidEl.textContent = 'UID ' + uid;
    head.appendChild(uidEl);

    if (inBlock) {
      const tag = document.createElement('span');
      tag.className = 'acfun-hover-tag is-blocked';
      tag.textContent = '已屏蔽';
      head.appendChild(tag);
    } else if (inMark) {
      const tag = document.createElement('span');
      tag.className = 'acfun-hover-tag is-marked';
      tag.textContent = '已关注';
      head.appendChild(tag);
    }
    tb.appendChild(head);

    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'acfun-hover-note';
      noteEl.textContent = '📝 ' + note;
      tb.appendChild(noteEl);
    }

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'acfun-hover-actions';

    if (inBlock) {
      const btn = mkBtn('acfun-btn-unblock', '✓ 解除屏蔽', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await AcFunBlockStorage.removeFromBlock(uid);
        showTip('已解除屏蔽 UID ' + uid, 'success');
        renderHoverToolbar(uid);
      });
      actions.appendChild(btn);
    } else {
      const btn = mkBtn('acfun-btn-block', '🚫 屏蔽此用户', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await AcFunBlockStorage.addToBlock(uid);
        showTip('已屏蔽 UID ' + uid, 'success');
        renderHoverToolbar(uid);
      });
      actions.appendChild(btn);
    }

    if (inMark) {
      const btn = mkBtn('acfun-btn-unmark', '取消关注', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await AcFunBlockStorage.removeFromMark(uid);
        showTip('已取消关注 UID ' + uid, 'success');
        renderHoverToolbar(uid);
      });
      actions.appendChild(btn);
    } else {
      const btn = mkBtn('acfun-btn-mark', '⭐ 关注', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await AcFunBlockStorage.addToMark(uid);
        showTip('已关注 UID ' + uid, 'success');
        renderHoverToolbar(uid);
      });
      actions.appendChild(btn);
    }

    // 主页链接
    const profile = document.createElement('a');
    profile.className = 'acfun-btn-profile';
    profile.href = 'https://www.acfun.cn/u/' + uid;
    profile.target = '_blank';
    profile.rel = 'noopener noreferrer';
    profile.textContent = '主页';
    profile.addEventListener('click', (e) => e.stopPropagation());
    actions.appendChild(profile);

    tb.appendChild(actions);
  }

  function mkBtn(cls, text, onclick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onclick);
    return b;
  }

  function positionHoverToolbar(link) {
    const tb = hoverToolbar;
    if (!tb) return;
    const rect = link.getBoundingClientRect();
    // 先临时显示以读取尺寸
    tb.style.visibility = 'hidden';
    tb.classList.add('show');
    const tbRect = tb.getBoundingClientRect();

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 6;

    // 默认放在链接下方
    let top = rect.bottom + gap;
    let left = rect.left;

    // 下方空间不够则放上方
    if (top + tbRect.height > vh - margin) {
      top = rect.top - tbRect.height - gap;
    }
    // 上方也不够就贴顶
    if (top < margin) top = margin;

    // 右侧超出则右对齐到视口
    if (left + tbRect.width > vw - margin) {
      left = vw - tbRect.width - margin;
    }
    if (left < margin) left = margin;

    tb.style.top = top + 'px';
    tb.style.left = left + 'px';
    tb.style.visibility = 'visible';
  }

  function showHoverToolbar(link) {
    if (!config || !config.enabled) return;
    const uid = extractUid(link.href);
    if (!uid) return;

    // 已经在同一个链接上显示了就不重渲染
    if (hoverCurrentLink === link && hoverToolbar && hoverToolbar.classList.contains('show')) {
      return;
    }
    hoverCurrentLink = link;
    hoverCurrentUid = uid;
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }

    renderHoverToolbar(uid);
    positionHoverToolbar(link);
  }

  function hideHoverToolbar() {
    if (hoverToolbar) hoverToolbar.classList.remove('show');
    hoverCurrentLink = null;
    hoverCurrentUid = null;
  }

  function scheduleHoverHide() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(hideHoverToolbar, 220);
  }

  function setupHoverDetection() {
    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest && e.target.closest('a[href]');
      if (!link) return;
      if (!USER_LINK_RE.test(link.href)) return;
      // 不要被工具栏里的链接（包括「主页」按钮）触发重新定位
      if (hoverToolbar && hoverToolbar.contains(link)) return;
      if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
      showHoverToolbar(link);
    }, true);

    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest && e.target.closest('a[href]');
      if (!link) return;
      if (!USER_LINK_RE.test(link.href)) return;
      // 如果鼠标移到了工具栏上，不隐藏
      if (e.relatedTarget && hoverToolbar && hoverToolbar.contains(e.relatedTarget)) return;
      scheduleHoverHide();
    }, true);

    // 滚动 / 按 Esc 关闭
    window.addEventListener('scroll', () => {
      if (hoverToolbar && hoverToolbar.classList.contains('show')) hideHoverToolbar();
    }, { passive: true, capture: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideHoverToolbar();
    });
  }

  /* ============================================================
   * 详情页：被屏蔽文章时显示占位
   * ============================================================ */
  function showBlockedArticlePlaceholder(uid) {
    // 只有真实文章详情页才显示“整篇屏蔽”占位；频道页 / 列表页不应弹窗
    if (!isOnArticleDetail()) return;
    if (processedPlaceholder === uid && document.querySelector('.acfun-blocked-article-placeholder')) {
      return;
    }

    // 移除可能残留的旧占位（处理切换 uid 场景）
    document.querySelectorAll('.acfun-blocked-article-placeholder').forEach(el => el.remove());

    processedPlaceholder = uid;

    const ph = document.createElement('div');
    ph.className = 'acfun-blocked-article-placeholder';

    const card = document.createElement('div');
    card.className = 'acfun-blocked-card';

    const icon = document.createElement('div');
    icon.className = 'acfun-blocked-icon';
    icon.textContent = '🚫';
    card.appendChild(icon);

    const title = document.createElement('h2');
    title.textContent = '此文章作者已被屏蔽';
    card.appendChild(title);

    const uidP = document.createElement('p');
    const uidCode = document.createElement('code');
    uidCode.textContent = 'UID ' + uid;
    uidP.appendChild(document.createTextNode('作者：'));
    uidP.appendChild(uidCode);
    card.appendChild(uidP);

    const note = (config.notes && config.notes[uid]) || '';
    if (note) {
      const noteP = document.createElement('p');
      noteP.className = 'acfun-blocked-note';
      noteP.textContent = '备注：' + note;
      card.appendChild(noteP);
    }

    const actions = document.createElement('div');
    actions.className = 'acfun-blocked-actions';

    const unblockBtn = document.createElement('button');
    unblockBtn.className = 'acfun-btn-unblock';
    unblockBtn.textContent = '解除屏蔽';
    unblockBtn.onclick = async () => {
      await AcFunBlockStorage.removeFromBlock(uid);
      showTip('已解除屏蔽 UID ' + uid, 'success');
      setTimeout(() => location.reload(), 400);
    };
    actions.appendChild(unblockBtn);

    const backBtn = document.createElement('button');
    backBtn.className = 'acfun-btn-ghost';
    backBtn.textContent = '返回上一页';
    backBtn.onclick = () => {
      if (history.length > 1) history.back();
      else location.href = 'https://www.acfun.cn/';
    };
    actions.appendChild(backBtn);

    const openOpts = document.createElement('button');
    openOpts.className = 'acfun-btn-ghost';
    openOpts.textContent = '管理名单';
    openOpts.onclick = () => chrome.runtime.sendMessage({ type: 'ACFUN_BLOCK_OPEN_OPTIONS' });
    actions.appendChild(openOpts);

    card.appendChild(actions);
    ph.appendChild(card);
    document.body.appendChild(ph);
  }

  /* ============================================================
   * 处理（核心）
   * ============================================================ */
  function processCardEl(card) {
    if (!card || processedCards.has(card)) return;
    const authorLink = findAuthorInContainer(card);
    if (!authorLink) return;
    const uid = extractUid(authorLink.href);
    if (!uid) return;
    processedCards.add(card);
    processItem(card, uid, authorLink);
  }

  function processCommentEl(commentEl, authorLink) {
    if (!commentEl || processedComments.has(commentEl)) return;
    const uid = extractUid(authorLink.href);
    if (!uid) return;
    processedComments.add(commentEl);
    processItem(commentEl, uid, authorLink);
  }

  function processArticleLinksIn(root, seenCards) {
    if (!root || !root.querySelectorAll) return;
    const articleLinks = root.querySelectorAll('a[href*="/a/ac"]');
    articleLinks.forEach(articleLink => {
      if (!ARTICLE_LINK_RE.test(articleLink.href)) return;
      const card = findCardContainer(articleLink);
      if (!card) return;
      if (seenCards.has(card)) return;
      seenCards.add(card);
      processCardEl(card);
    });
  }

  function processUserLinksIn(root) {
    if (!root || !root.querySelectorAll) return;
    const userLinks = root.querySelectorAll('a[href*="/u/"]');
    userLinks.forEach(link => {
      const commentContainer = findCommentContainerFor(link);
      if (commentContainer) processCommentEl(commentContainer, link);
    });
  }

  function processDetailOnce() {
    if (!isOnArticleDetail()) return;
    const detail = findDetailContainer();
    if (!detail || detail === processedDetail) return;
    const authorLink = findAuthorInContainer(detail);
    // 作者区可能比正文晚渲染：没找到作者时先不缓存，等下一次 DOM 变化再试
    if (!authorLink) return;
    const uid = extractUid(authorLink.href);
    if (!uid) return;
    processedDetail = detail;
    processItem(detail, uid, authorLink);
    if (config.blockList.includes(uid)) {
      try { showBlockedArticlePlaceholder(uid); } catch (e) { console.warn('[AcFunBlock] placeholder', e); }
    }
  }

  // 全量扫描
  function processPage() {
    if (!config || !config.enabled) {
      unprocessAll();
      return;
    }

    // 详情页只处理正文和评论，避免把页面内的推荐卡片 / 侧栏当成列表
    if (isOnArticleDetail()) {
      processDetailOnce();
      if (config.processComments) processUserLinksIn(document);
      return;
    }

    // 1. 文章卡片（频道页 / 列表页 / 首页）
    const seenCards = new Set();
    processArticleLinksIn(document, seenCards);

    // 2. 评论区
    if (config.processComments) {
      processUserLinksIn(document);
    }
  }

  // 增量扫描：仅处理新增节点（避免 250ms 全量重扫）
  function processIncremental(mutations) {
    if (!config || !config.enabled) return;
    const detailPage = isOnArticleDetail();
    const seenCards = new Set();
    for (const m of mutations) {
      if (m.type !== 'childList' || !m.addedNodes || !m.addedNodes.length) continue;
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue; // 只处理元素
        if (node.tagName === 'A' && node.href) {
          if (!detailPage && ARTICLE_LINK_RE.test(node.href)) {
            const card = findCardContainer(node);
            if (card && !seenCards.has(card)) {
              seenCards.add(card);
              processCardEl(card);
            }
          }
          if (config.processComments && USER_LINK_RE.test(node.href)) {
            const commentContainer = findCommentContainerFor(node);
            if (commentContainer) processCommentEl(commentContainer, node);
          }
        } else {
          if (!detailPage) processArticleLinksIn(node, seenCards);
          if (config.processComments) processUserLinksIn(node);
        }
      }
    }
    // 详情页主体可能被替换（路由切换 SPA）
    if (detailPage) processDetailOnce();
  }

  /* ============================================================
   * 清理
   * ============================================================ */
  function unprocessAll() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingMutations = [];
    document.querySelectorAll('[data-acfun-block-processed]').forEach(clearMarks);
    document.querySelectorAll('.acfun-blocked-article-placeholder').forEach(el => el.remove());
    resetProcessedSets();
  }

  /* ============================================================
   * 主流程
   * ============================================================ */
  function setupObserver() {
    if (observer) observer.disconnect();
    pendingMutations = [];
    observer = new MutationObserver((mutations) => {
      if (!config || !config.enabled) return;
      // 注意：debounce 期间必须累积所有 mutation，不能只保留最后一批，
      // 否则异步渲染的评论 / 卡片（分批插入）会被漏掉。
      if (mutations && mutations.length) pendingMutations.push(...mutations);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const batch = pendingMutations;
        pendingMutations = [];
        debounceTimer = null;
        processIncremental(batch);
      }, 250);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function init() {
    config = await AcFunBlockStorage.loadConfig();

    AcFunBlockStorage.onChange((newCfg) => {
      config = newCfg;
      unprocessAll();
      processPage();
    });

    // 等待 DOM 准备好
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', processPage);
    } else {
      processPage();
    }
    setupObserver();
    setupHoverDetection();

    // 监听来自 popup/options 的消息
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'ACFUN_BLOCK_REFRESH') {
        (async () => {
          try {
            config = await AcFunBlockStorage.loadConfig();
            unprocessAll();
            processPage();
            // 关闭可能还显示的悬停工具栏
            hideHoverToolbar();
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: String(e) });
          }
        })();
        return true;
      }
      if (msg.type === 'ACFUN_BLOCK_GET_CURRENT_UIDS') {
        const uids = collectCurrentUids();
        sendResponse({ uids, url: location.href });
        return;
      }
    });
  }

  function collectCurrentUids() {
    const set = new Set();
    document.querySelectorAll('a[href*="/u/"]').forEach(link => {
      const uid = extractUid(link.href);
      if (uid) set.add(uid);
    });
    return Array.from(set);
  }

  init();
})();
