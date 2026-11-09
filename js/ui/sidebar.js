/** 侧边栏：数据状态、类型切换、KPI 快速筛选、省份标签、分组列表 */
import { esc, icon, highlight } from './dom.js';
import { COLORS, recordColor, recordBadges, internalBadges } from './badges.js';

export function renderStatus(el, { text, tone = 'ok', title = '' }) {
  const color = { ok: '#34d399', warn: '#fbbf24', info: '#38bdf8', error: '#fb7185', loading: '#64748b' }[tone];
  el.innerHTML = `<span class="wh-status-dot${tone === 'loading' ? ' is-loading' : ''}" style="--c:${color}"></span><span class="truncate">${esc(text)}</span>`;
  el.title = title;
}

/** 亚马逊仓点 | 自营仓 切换；数字为当前搜索下各自的匹配数 */
export function renderKindTabs(el, counts, active) {
  const tabs = [
    { id: 'amazon', label: '亚马逊仓点', icon: 'warehouse', color: COLORS.hot },
    { id: 'internal', label: '自营仓', icon: 'house', color: COLORS.internal },
  ];
  el.style.setProperty('--i', String(tabs.findIndex((t) => t.id === active)));
  el.innerHTML = `<span class="wh-kind__indicator" aria-hidden="true"></span>${tabs.map((t) => `
    <button type="button" role="tab" class="wh-kind__tab" data-kind-tab="${t.id}" aria-selected="${t.id === active}" style="--b:${t.color}">
      ${icon(t.icon, 'size-3.5')}<span>${t.label}</span><span class="wh-kind__count">${counts[t.id] ?? 0}</span>
    </button>`).join('')}`;
}

/** 数字滚动动画 */
function countUp(node, to) {
  const from = Number(node.dataset.value || 0);
  node.dataset.value = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = to; return; }
  const t0 = performance.now();
  const dur = 520;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = Math.round(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * KPI 快速筛选卡片
 * @param {{ key: string, label: string, value: number, color: string, active: boolean, title?: string }[]} items
 */
export function renderKpis(el, items) {
  const keys = items.map((k) => k.key).join('|');
  if (el.dataset.keys !== keys) {
    el.dataset.keys = keys;
    el.style.gridTemplateColumns = `repeat(${items.length}, minmax(0, 1fr))`;
    el.innerHTML = items.map((k) => `
      <button type="button" class="wh-kpi" data-kpi="${k.key}" style="--b:${k.color}" title="${esc(k.title || '')}" aria-pressed="false">
        <span class="wh-kpi__value" data-value="0">0</span>
        <span class="wh-kpi__label">${esc(k.label)}</span>
      </button>`).join('');
  }
  for (const k of items) {
    const btn = el.querySelector(`[data-kpi="${k.key}"]`);
    btn.classList.toggle('is-active', k.active);
    btn.setAttribute('aria-pressed', String(k.active));
    countUp(btn.querySelector('.wh-kpi__value'), k.value);
  }
}

export function renderChips(el, provinces, active) {
  const total = provinces.reduce((s, p) => s + p.count, 0);
  el.innerHTML = [
    `<button type="button" class="wh-chip${!active ? ' is-active' : ''}" data-province="">全部省份<span class="wh-chip__count">${total}</span></button>`,
    ...provinces.map((p) => `
      <button type="button" class="wh-chip${active === p.abbr ? ' is-active' : ''}" data-province="${esc(p.abbr)}" title="${esc(p.name)}"${p.count ? '' : ' disabled'}>
        ${esc(p.abbr)}<span class="wh-chip__name">${esc(p.name.replace(/省$|地区$/, ''))}</span><span class="wh-chip__count">${p.count}</span>
      </button>`),
  ].join('');
}

export function renderList(el, groups, { terms = [], selected = null, total = 0, hasFilters = false, kind = 'amazon', emptyText = '' } = {}) {
  if (!groups.length) {
    const noData = !total;
    el.innerHTML = `
      <div class="flex flex-col items-center px-6 py-14 text-center">
        <div class="grid size-12 place-items-center rounded-2xl bg-white/5 text-slate-500">${icon(noData ? 'file' : 'search', 'size-5')}</div>
        <p class="mt-4 text-sm font-medium text-slate-200">${noData ? esc(emptyText || '暂无数据') : '没有匹配的仓库'}</p>
        <p class="mt-1 text-xs text-slate-500">${noData ? '可将 Excel 拖拽到页面中导入' : kind === 'internal' ? '试试仓库编码（如 TOR-1140）、中文名、城市或地址' : '试试仓点编码（如 YYZ4）、城市、省份缩写或邮编'}</p>
        ${!noData && hasFilters ? '<button type="button" data-act="reset" class="wh-action mt-5 !w-auto px-4">清除搜索与筛选</button>' : ''}
      </div>`;
    return;
  }
  let i = 0;
  const isSel = (r) => selected && selected.kind === r.kind && selected.code === r.code;
  el.innerHTML = groups.map((g) => `
    <div class="wh-group" role="presentation">
      <span class="font-mono text-[11px] font-bold text-slate-200">${esc(g.abbr)}</span>
      <span class="truncate">${esc(g.name)}</span>
      <span class="ml-auto font-mono text-[10.5px] text-slate-500">${g.items.length}</span>
    </div>
    ${g.items.map((r) => (r.kind === 'internal' ? internalItem : amazonItem)(r, terms, isSel(r), i++)).join('')}
  `).join('');
}

function amazonItem(r, terms, selected, i) {
  const glyph = r.type === 'oversize' ? 'package' : 'warehouse';
  return `
    <button type="button" class="wh-item${selected ? ' is-selected' : ''}" data-code="${esc(r.code)}" data-kind="amazon" role="option"
      aria-selected="${selected}" style="--c:${recordColor(r)};animation-delay:${Math.min(i, 16) * 18}ms">
      <span class="wh-item__icon${r.remote ? ' is-remote' : ''}">${icon(glyph, 'size-[18px]')}</span>
      <span class="min-w-0 flex-1 text-left">
        <span class="flex items-center gap-1.5">
          <span class="font-mono text-[14.5px] font-bold tracking-tight text-white">${highlight(r.code, terms)}</span>
          ${r.isNew ? `<span class="wh-new" title="${esc(r.notes)}">NEW</span>` : ''}
          ${r.hasCoords ? '' : '<span class="wh-badge wh-badge--xs" style="--b:#fbbf24" title="缺少坐标，未在地图上显示">无坐标</span>'}
        </span>
        <span class="mt-0.5 block truncate text-xs text-slate-400">${highlight(r.city || '—', terms)}${r.cityEn ? ` <span class="text-slate-600">${highlight(r.cityEn, terms)}</span>` : ''}${r.postal ? ` · <span class="font-mono text-[11px]">${highlight(r.postal, terms)}</span>` : ''}</span>
      </span>
      <span class="flex max-w-[132px] shrink-0 flex-wrap justify-end gap-1">${recordBadges({ ...r, isNew: false }, {}, { size: 'xs' })}</span>
    </button>`;
}

function internalItem(r, terms, selected, i) {
  return `
    <button type="button" class="wh-item${selected ? ' is-selected' : ''}" data-code="${esc(r.code)}" data-kind="internal" role="option"
      aria-selected="${selected}" style="--c:${COLORS.internal};animation-delay:${Math.min(i, 16) * 18}ms">
      <span class="wh-item__icon is-internal">${icon('house', 'size-[17px]')}</span>
      <span class="min-w-0 flex-1 text-left">
        <span class="flex items-center gap-1.5">
          <span class="font-mono text-[14px] font-bold tracking-tight text-white">${highlight(r.code, terms)}</span>
          ${r.hasCoords ? '' : '<span class="wh-badge wh-badge--xs" style="--b:#fbbf24" title="缺少坐标，未在地图上显示">无坐标</span>'}
        </span>
        <span class="mt-0.5 block truncate text-xs text-slate-300">${highlight(r.name || '—', terms)}</span>
        <span class="block truncate text-[11px] text-slate-500">${highlight(r.address || r.city || '—', terms)}</span>
      </span>
      <span class="flex max-w-[120px] shrink-0 flex-wrap justify-end gap-1">${internalBadges(r, { size: 'xs' }, { withKind: false })}</span>
    </button>`;
}
