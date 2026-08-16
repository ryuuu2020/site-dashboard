// report-common.js — 关卡报表页共享逻辑（只读渲染，无外部依赖）
window.Report = (function () {
  const STATUS_TEXT = { done: '已打通', 'in-progress': '进行中', pending: '未开始', skipped: '跳过' };
  const STATUS_CLASS = { done: 'done', 'in-progress': 'in-progress', pending: 'pending', skipped: 'pending' };

  async function loadVoyage() {
    try {
      const resp = await fetch('../voyage.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) throw new Error(String(resp.status));
      return await resp.json();
    } catch (e) {
      console.warn('load voyage.json failed', e);
      return null;
    }
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 返回 null 表示「待补/待确认」
  function hasValue(v) {
    return v !== null && v !== undefined && v !== '';
  }

  function statusBadge(status) {
    return `<span class="badge ${STATUS_CLASS[status] || 'pending'}">${STATUS_TEXT[status] || status}</span>`;
  }

  function levelsMeta(voyage) {
    return voyage?.levelsMeta || [];
  }

  function findSite(voyage, dir) {
    return (voyage?.sites || []).find((s) => s.dir === dir) || (voyage?.sites || [])[0];
  }

  function findLevel(site, id) {
    return (site?.levels || []).find((l) => l.id === id);
  }

  // 顶部导航 + 站点/关卡切换
  function renderTopBar(voyage, site, levelId) {
    const el = document.getElementById('topbar');
    if (!el) return;

    const siteOptions = voyage.sites.map((s) =>
      `<option value="${esc(s.dir)}"${s.dir === site.dir ? ' selected' : ''}>${esc(s.name)}</option>`
    ).join('');

    const levels = levelsMeta(voyage);
    const levelOptions = levels.map((m) =>
      `<option value="${m.id}"${m.id === levelId ? ' selected' : ''}>关卡 ${m.id} · ${esc(m.name)}</option>`
    ).join('');

    el.innerHTML = `
      <div class="top-bar">
        <h1><span>◈</span> 关卡 ${levelId} · 完工报表</h1>
        <div class="top-actions">
          <a class="btn" href="../voyage.html">← 航海作业台</a>
          <select class="btn" id="site-switch" aria-label="切换站点">${siteOptions}</select>
          <select class="btn" id="level-switch" aria-label="切换关卡">${levelOptions}</select>
        </div>
      </div>`;

    document.getElementById('site-switch').addEventListener('change', (e) => {
      location.href = `level-${levelId}.html?site=${encodeURIComponent(e.target.value)}`;
    });
    document.getElementById('level-switch').addEventListener('change', (e) => {
      location.href = `level-${e.target.value}.html?site=${encodeURIComponent(site.dir)}`;
    });
  }

  // 站点 + 关卡信息头
  function renderSiteHead(site, level) {
    const el = document.getElementById('sitehead');
    if (!el) return;
    const meta = levelsMetaByIdAttr(site, level);
    const doneAt = level.doneAt ? `<span style="font-family:'SF Mono',monospace;font-size:0.6875rem;color:var(--text-muted)">完成于 ${esc(level.doneAt)}</span>` : '';
    el.innerHTML = `
      <div class="site-head">
        <div>
          <div class="name">${esc(site.name)}</div>
          <div class="domain">${esc(site.domain)}</div>
        </div>
        <div class="level-tag">
          <span class="lv">关卡 ${level.id}</span>
          <span class="lv-name">${esc(meta.name)}</span>
          ${statusBadge(level.status)}
          ${doneAt}
        </div>
      </div>`;
  }

  // 兜底：从 site.levels 拿不到 meta 时用 id 占位
  function levelsMetaByIdAttr(site, level) {
    // 关卡名从全局 levelsMeta 里取，避免依赖 site 内嵌 meta
    const meta = (window.__levelsMeta || []).find((m) => m.id === level.id);
    return meta || { id: level.id, name: '关卡 ' + level.id, goal: '' };
  }

  // 供各报表页注入关卡名
  function setLevelsMeta(voyage) {
    window.__levelsMeta = voyage?.levelsMeta || [];
  }

  return {
    loadVoyage,
    param,
    esc,
    hasValue,
    statusBadge,
    findSite,
    findLevel,
    renderTopBar,
    renderSiteHead,
    setLevelsMeta,
  };
})();
