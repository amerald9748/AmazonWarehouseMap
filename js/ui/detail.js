/**
 * 仓库详情
 *   亚马逊仓点：概览 / 运营指标 / 周边仓点
 *   自营仓：    概览 / 周边仓点
 */
import { esc, icon, haversineKm } from './dom.js';
import { COLORS, badge, heatColor, recordColor, recordBadges, internalBadges } from './badges.js';

export const TABS_BY_KIND = {
  amazon: [
    { id: 'overview', label: '概览' },
    { id: 'metrics', label: '运营指标' },
    { id: 'nearby', label: '周边仓点' },
  ],
  internal: [
    { id: 'overview', label: '概览' },
    { id: 'nearby', label: '周边仓点' },
  ],
};
/** 兼容旧引用 */
export const TABS = TABS_BY_KIND.amazon;

const tabsFor = (r) => TABS_BY_KIND[r.kind] || TABS_BY_KIND.amazon;
/** 当前标签在该类型中不存在时（例如自营仓没有「运营指标」）回到概览 */
export const resolveTab = (r, tab) => (tabsFor(r).some((t) => t.id === tab) ? tab : 'overview');

/**
 * @param {object} r 仓库记录（kind = amazon | internal）
 * @param {{ meta: object, amazon: object[], internal: object[], index: number, total: number, tab: string }} ctx
 */
export function renderDetail(r, ctx) {
  const tabs = tabsFor(r);
  const tab = resolveTab(r, ctx.tab);
  const tabIndex = tabs.findIndex((t) => t.id === tab);
  const internal = r.kind === 'internal';
  return `
    <div class="shrink-0 px-5 pb-3" style="--c:${recordColor(r)}">
      <div class="flex items-center justify-between">
        <button type="button" data-act="back" class="wh-ghost-btn -ml-2">${icon('chevronLeft', 'size-4')}返回${internal ? '自营仓' : '仓点'}列表</button>
        <div class="flex items-center gap-1 text-xs text-slate-500">
          <button type="button" data-act="prev" class="wh-icon-btn" title="上一个 (←)" aria-label="上一个">${icon('chevronLeft', 'size-4')}</button>
          <span class="min-w-[3.5rem] text-center font-mono tabular-nums">${ctx.index + 1} / ${ctx.total}</span>
          <button type="button" data-act="next" class="wh-icon-btn" title="下一个 (→)" aria-label="下一个">${icon('chevronRight', 'size-4')}</button>
        </div>
      </div>

      <div class="wh-hero mt-3 flex items-start gap-3.5">
        <div class="wh-hero__icon${internal ? ' is-internal' : ''}">${icon(internal ? 'house' : r.type === 'oversize' ? 'package' : 'warehouse', 'size-6')}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="truncate font-mono text-[28px] font-bold leading-none tracking-tight text-white">${esc(r.code)}</h2>
            <button type="button" class="wh-icon-btn shrink-0" data-copy="${esc(r.code)}" title="复制编码" aria-label="复制编码">${icon('copy', 'size-3.5')}</button>
          </div>
          ${internal
            ? `<p class="mt-1.5 truncate text-sm text-slate-200">${esc(r.name || r.city || '—')}</p>
               <p class="truncate text-xs text-slate-500">${esc([r.city, r.state.abbr].filter(Boolean).join(' · ') || '—')}${r.postal ? ` · <span class="font-mono">${esc(r.postal)}</span>` : ''}</p>`
            : `<p class="mt-1.5 truncate text-sm text-slate-200">${esc(r.city || '—')}${r.cityEn ? ` <span class="text-slate-500">${esc(r.cityEn)}</span>` : ''}</p>
               <p class="truncate text-xs text-slate-500">${esc([r.state.abbr, r.state.name].filter(Boolean).join(' · ') || '—')}${r.postal ? ` · <span class="font-mono">${esc(r.postal)}</span>` : ''}</p>`}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-1.5">${internal ? internalBadges(r, { size: 'md' }) : recordBadges(r, ctx.meta.definitions, { size: 'md' })}</div>

      <div class="wh-tabs mt-4" role="tablist" style="--i:${tabIndex};--n:${tabs.length}">
        <span class="wh-tabs__indicator" aria-hidden="true"></span>
        ${tabs.map((t) => `<button type="button" role="tab" class="wh-tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join('')}
      </div>
    </div>
    <div class="wh-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5" data-tabpanel>
      ${renderTab(tab, r, ctx)}
    </div>`;
}

export function renderTab(tab, r, ctx) {
  let body;
  if (tab === 'nearby') body = nearbyTab(r, ctx);
  else if (tab === 'metrics' && r.kind !== 'internal') body = metricsTab(r);
  else body = r.kind === 'internal' ? internalOverview(r) : overviewTab(r, ctx);
  return `<div class="wh-tabpanel" role="tabpanel">${body}</div>`;
}

// ------------------------------------------------------------------ shared pieces

function card(label, valueHtml, { desc = '', span = 1, iconName = null } = {}) {
  return `
    <div class="wh-card${span === 2 ? ' col-span-2' : ''}">
      <div class="wh-card__label">${iconName ? icon(iconName, 'size-3.5') : ''}${esc(label)}</div>
      <div class="wh-card__value">${valueHtml}</div>
      ${desc ? `<p class="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">${esc(desc)}</p>` : ''}
    </div>`;
}

const copyBtn = (value, title) =>
  `<button type="button" class="wh-icon-btn shrink-0" data-copy="${esc(value)}" title="${title}" aria-label="${title}">${icon('copy', 'size-3.5')}</button>`;

const PRECISION = {
  building: '建筑级（OSM 建筑轮廓）',
  postal: '邮编中心（约一个街区精度）',
  manual: '人工录入',
};

/** 坐标卡片：注明来源（Excel / 沿用已知坐标）与精度 */
function coordCard(r, label = '坐标') {
  if (!r.hasCoords) {
    return card(label, '<span class="text-amber-300">缺少有效坐标</span>', {
      span: 2, iconName: 'pin', desc: '在 Excel 的「纬度」「经度」列补充数值后即可上图。',
    });
  }
  const p = PRECISION[r.coordPrecision];
  const note = r.coordSource === 'inherited'
    ? `本表未提供坐标，已按编码沿用已知坐标（${r.coordFrom}）${p ? ` · ${p}` : ''}`
    : `来自 Excel${p ? ` · ${p}` : ''}`;
  const tag = r.coordSource === 'inherited' ? `<span class="wh-badge wh-badge--xs" style="--b:#a5b4fc">沿用</span>` : '';
  return card(label,
    `<span class="flex items-center gap-2"><span class="font-mono text-[13px] tabular-nums">${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span>${tag}${copyBtn(`${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`, '复制坐标')}</span>`,
    { span: 2, iconName: 'pin', desc: note });
}

function actions(r, query) {
  const gmaps = query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
  return `
    <div class="mt-3 grid grid-cols-2 gap-2.5">
      <button type="button" data-act="locate" class="wh-action"${r.hasCoords ? '' : ' disabled'}>${icon('navigation', 'size-4')}重新定位</button>
      ${gmaps ? `<a class="wh-action" href="${gmaps}" target="_blank" rel="noopener">${icon('external', 'size-4')}Google 地图</a>` : '<span></span>'}
    </div>
    <p class="mt-4 text-[11px] text-slate-500">数据来源：Excel 第 ${r.excelRow} 行</p>`;
}

// ------------------------------------------------------------------ 亚马逊 · 概览

function overviewTab(r, ctx) {
  const defs = ctx.meta.definitions || {};
  const cols = ctx.meta.columns || {};
  const dash = '<span class="text-slate-500">—</span>';
  const cards = [];
  if (cols.heat) cards.push(card(cols.heat, r.heatLabel ? badge(r.heatLabel, heatColor(r.heat), { size: 'md', iconName: r.heat === 'hot' ? 'flame' : null }) : dash, { desc: defs[r.heatLabel] }));
  if (cols.type) cards.push(card(cols.type, r.typeLabel ? badge(r.typeLabel, COLORS[r.type] || COLORS.other, { size: 'md', iconName: r.type === 'oversize' ? 'package' : null }) : dash, { desc: defs[r.typeLabel] }));
  if (cols.remote) cards.push(card(cols.remote, r.remote ? badge(r.remoteLabel || '偏远', COLORS.remote, { size: 'md' }) : '<span class="text-slate-300">否</span>', { desc: r.remote ? defs['偏远仓'] : '' }));
  if (cols.postal) {
    cards.push(card(cols.postal, r.postal
      ? `<span class="flex items-center gap-2"><span class="font-mono">${esc(r.postal)}</span>${copyBtn(r.postal, '复制邮编')}</span>`
      : dash));
  }
  cards.push(coordCard(r, cols.lat && cols.lng ? `坐标（${cols.lat} / ${cols.lng}）` : '坐标'));
  if (r.notes) cards.push(card(cols.notes || '备注', `<span class="text-[13.5px] font-medium text-slate-100">${esc(r.notes)}</span>`, { span: 2 }));
  if (r.colocatedWith.length) {
    cards.push(card('共仓', r.colocatedWith.map((code) => `<button type="button" class="wh-code-chip" data-code="${esc(code)}" data-kind="amazon">${esc(code)}</button>`).join(' '), { span: 2, iconName: 'layers', desc: '同一地址的仓点，地图上的标记已轻微错开以便分别点击。' }));
  }
  for (const e of r.extra) cards.push(card(e.label, `<span class="text-[13.5px]">${esc(e.value)}</span>`, { span: 2 }));
  if (r.region) cards.push(card(cols.region || '地区', esc(r.region)));
  return `<div class="grid grid-cols-2 gap-2.5">${cards.join('')}</div>${actions(r, r.hasCoords ? `${r.lat},${r.lng}` : '')}`;
}

// ------------------------------------------------------------------ 自营仓 · 概览

function internalOverview(r) {
  const dash = '<span class="text-slate-500">—</span>';
  const cards = [
    card('地址', r.address
      ? `<span class="flex items-start gap-2"><span class="text-[13.5px] leading-snug">${esc(r.address)}</span>${copyBtn(r.address, '复制地址')}</span>`
      : dash, { span: 2, iconName: 'pin' }),
    card('营业时间', r.hours ? `<span class="font-mono text-[13.5px] tabular-nums">${esc(r.hours)}</span>` : dash, { iconName: 'clock' }),
    card('状态', r.isActive ? badge('运营中', COLORS.internal, { size: 'md' }) : badge(r.statusLabel, COLORS.warn, { size: 'md', iconName: 'alert' }),
      { desc: r.isActive ? '' : '请留意：该仓库状态不是 Active，安排入仓前请先确认。' }),
    card('月台', r.dock ? `<span class="font-mono text-[13.5px]">${esc(r.dock)}</span>` : dash, { iconName: 'dock' }),
    card('城市/区域', esc(r.city || '—')),
  ];
  if (r.notes) cards.push(card('备注', `<span class="text-[13.5px] font-medium text-slate-100">${esc(r.notes)}</span>`, { span: 2 }));
  if (r.colocatedWith.length) {
    cards.push(card('同一地址', r.colocatedWith.map((code) => `<button type="button" class="wh-code-chip is-internal" data-code="${esc(code)}" data-kind="internal">${esc(code)}</button>`).join(' '), { span: 2, iconName: 'layers', desc: '共用同一地址的自营仓，地图上的标记已轻微错开以便分别点击。' }));
  }
  cards.push(coordCard(r));
  for (const e of r.extra) cards.push(card(e.label, `<span class="text-[13.5px]">${esc(e.value)}</span>`, { span: 2 }));
  return `<div class="grid grid-cols-2 gap-2.5">${cards.join('')}</div>${actions(r, r.address || (r.hasCoords ? `${r.lat},${r.lng}` : ''))}`;
}

// ------------------------------------------------------------------ 亚马逊 · 运营指标

const METRIC_HINTS = {
  capacity: '实时库容（高/中/低 或 百分比）',
  sqft: '仓库面积（平方英尺）',
  employees: '员工人数',
  inbound: '入库状态',
  outbound: '出库状态',
};

function placeholder(field) {
  return `<span class="text-xl font-semibold text-slate-600">—</span>
    <p class="mt-1 text-[11px] leading-snug text-slate-500">待补充 · Excel 列名「${esc(METRIC_HINTS[field])}」</p>`;
}

function metricCard(label, iconName, inner, filled, span = 1) {
  return `<div class="wh-card${filled ? '' : ' wh-card--placeholder'}${span === 2 ? ' col-span-2' : ''}">
      <div class="wh-card__label">${icon(iconName, 'size-3.5')}${esc(label)}</div>
      <div class="mt-2">${inner}</div>
    </div>`;
}

function capacityMeter(cap) {
  const LEVEL = { low: ['低', '#34d399', 30], medium: ['中', '#fbbf24', 62], high: ['高', '#fb7185', 92] };
  const [name, color, guess] = LEVEL[cap?.level] || ['—', '#64748b', 0];
  const pct = cap ? cap.pct ?? guess : 0;
  return `
    <div class="flex items-baseline justify-between">
      <span class="text-xl font-semibold" style="color:${cap ? color : '#475569'}">${cap ? esc(cap.label || name) : '—'}</span>
      ${cap?.pct != null ? `<span class="font-mono text-xs text-slate-400">${cap.pct}%</span>` : ''}
    </div>
    <div class="wh-meter mt-2${cap ? '' : ' is-empty'}" style="--m:${color};--p:${pct}%"><span class="wh-meter__fill"></span></div>
    <div class="mt-1 flex justify-between text-[10px] text-slate-500"><span>宽松</span><span>一般</span><span>紧张</span></div>`;
}

function statusChip(text) {
  if (!text) return '<span class="text-slate-600">—</span>';
  const tone = /拥堵|延迟|延误|紧张|排队|delay|congest/i.test(text) ? '#fbbf24'
    : /暂停|关闭|停止|拒收|closed|stop|suspend/i.test(text) ? '#fb7185'
      : /正常|顺畅|开放|畅通|normal|open|ok/i.test(text) ? '#34d399' : '#94a3b8';
  return badge(text, tone, { size: 'md' });
}

function metricsTab(r) {
  const m = r.metrics;
  const anyColumn = Object.values(r.metricColumns).some(Boolean);
  const fmtSqft = (n) => `${Math.round(n).toLocaleString('en-US')} <span class="text-xs font-normal text-slate-400">ft²</span>
      <p class="mt-1 text-[11px] text-slate-500">≈ ${Math.round(n * 0.092903).toLocaleString('en-US')} m²</p>`;
  const banner = anyColumn ? '' : `
    <div class="mb-3 flex gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/[0.06] p-3 text-[12px] leading-relaxed text-sky-100/80">
      ${icon('info', 'size-4 shrink-0 text-sky-300 mt-0.5')}
      <span>当前 Excel 尚未包含运营指标。在表中新增下列任意列名，重新加载后会自动显示。</span>
    </div>`;
  return `${banner}
    <div class="grid grid-cols-2 gap-2.5">
      ${metricCard('实时库容', 'gauge', m.capacity ? capacityMeter(m.capacity) : `${capacityMeter(null)}<p class="mt-2 text-[11px] text-slate-500">待补充 · Excel 列名「${METRIC_HINTS.capacity}」</p>`, !!m.capacity, 2)}
      ${metricCard('仓库面积', 'ruler', m.sqft != null ? `<div class="text-xl font-semibold text-white tabular-nums">${fmtSqft(m.sqft)}</div>` : placeholder('sqft'), m.sqft != null)}
      ${metricCard('员工人数', 'users', m.employees != null ? `<div class="text-xl font-semibold text-white tabular-nums">${Math.round(m.employees).toLocaleString('en-US')}</div>` : placeholder('employees'), m.employees != null)}
      ${metricCard('入库运输', 'inbound', m.inbound ? statusChip(m.inbound) : placeholder('inbound'), !!m.inbound)}
      ${metricCard('出库运输', 'outbound', m.outbound ? statusChip(m.outbound) : placeholder('outbound'), !!m.outbound)}
    </div>`;
}

// ------------------------------------------------------------------ 周边仓点

const fmtKm = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : d < 100 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-US')} km`);

function nearest(r, list, n) {
  return list
    .filter((o) => !(o.kind === r.kind && o.code === r.code) && o.hasCoords)
    .map((o) => ({ o, d: haversineKm(r, o) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

function nearItem({ o, d }, max) {
  const internal = o.kind === 'internal';
  const sub = internal
    ? `${esc(o.name || o.city || '—')}`
    : `${esc(o.city || '—')} · ${esc(o.state.abbr)}`;
  const flag = internal && !o.isActive ? `<span class="wh-badge wh-badge--xs shrink-0" style="--b:${COLORS.warn}" title="${esc(o.status)}">${esc(o.statusLabel)}</span>` : '';
  return `
    <button type="button" class="wh-near" data-code="${esc(o.code)}" data-kind="${o.kind}" style="--c:${recordColor(o)};--w:${Math.max(4, (d / max) * 100)}%">
      <span class="wh-near__dot${internal ? ' is-diamond' : ''}"></span>
      <span class="w-[4.6rem] shrink-0 truncate text-left font-mono text-[12.5px] font-bold text-white">${esc(o.code)}</span>
      <span class="min-w-0 flex-1 text-left">
        <span class="flex items-center gap-1.5"><span class="truncate text-xs text-slate-300">${sub}</span>${flag}</span>
        <span class="wh-near__bar"><i></i></span>
      </span>
      <span class="shrink-0 font-mono text-xs tabular-nums text-slate-300">${fmtKm(d)}</span>
    </button>`;
}

function nearSection(title, iconName, items, emptyText) {
  const max = Math.max(...items.map((x) => x.d), 1);
  return `
    <h3 class="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">${icon(iconName, 'size-3.5')}${title}</h3>
    <div class="space-y-1.5">${items.length ? items.map((x) => nearItem(x, max)).join('') : `<p class="px-1 py-2 text-xs text-slate-500">${emptyText}</p>`}</div>`;
}

function nearbyTab(r, ctx) {
  if (!r.hasCoords) return '<p class="py-8 text-center text-sm text-slate-500">该仓库缺少坐标，无法计算距离。</p>';
  const amazon = ctx.amazon || [];
  const internal = ctx.internal || [];
  const stat = (v, label, color) => `<div class="wh-card text-center"><div class="font-mono text-xl font-bold" style="color:${color}">${v}</div><div class="mt-1 text-[11px] text-slate-400">${label}</div></div>`;
  const prov = r.state.abbr;
  const sameAmazon = prov ? amazon.filter((o) => o.state.abbr === prov) : [];
  const sameInternal = prov ? internal.filter((o) => o.state.abbr === prov) : [];
  const stats = `
    <div class="grid grid-cols-3 gap-2.5">
      ${stat(sameAmazon.length, `${esc(prov || '同省')} 亚马逊仓点`, '#e2e8f0')}
      ${stat(sameAmazon.filter((o) => o.heat === 'hot').length, '其中热门', COLORS.hot)}
      ${stat(sameInternal.length, `${esc(prov || '同省')} 自营仓`, COLORS.internal)}
    </div>`;
  const note = '<p class="mt-4 text-[11px] text-slate-500">距离为直线距离，仅供参考，实际行车距离通常更长。</p>';
  const noInternal = internal.length ? '暂无其他自营仓' : '自营仓数据未加载';
  if (r.kind === 'internal') {
    return stats
      + nearSection('最近的亚马逊仓点 · 直线距离', 'route', nearest(r, amazon, 6), '亚马逊仓点数据未加载')
      + nearSection('其他自营仓', 'house', nearest(r, internal, 3), noInternal)
      + note;
  }
  return stats
    + nearSection('最近的自营仓 · 直线距离', 'house', nearest(r, internal, 3), noInternal)
    + nearSection('最近的亚马逊仓点', 'route', nearest(r, amazon, 5), '暂无其他仓点')
    + note;
}
