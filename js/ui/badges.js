/** 徽章 / 颜色体系：列表、弹窗、详情、图例共用 */
import { esc, icon } from './dom.js';

export const COLORS = {
  hot: '#fbbf24',       // 热门仓 amber
  regular: '#38bdf8',   // 常规仓 sky
  other: '#94a3b8',
  oversize: '#a78bfa',  // 大件仓 violet
  standard: '#94a3b8',  // 标准仓 slate
  satellite: '#2dd4bf',
  fulfillment: '#38bdf8',
  sort: '#f472b6',
  remote: '#fb7185',    // 偏远 rose
  isNew: '#e879f9',     // 新开 fuchsia
  internal: '#34d399',  // 自营仓 emerald
  warn: '#fbbf24',      // 状态提醒
};

export const heatColor = (heat) => COLORS[heat] || COLORS.other;
/** 记录的主题色：自营仓统一 emerald，亚马逊按热门/常规 */
export const recordColor = (r) => (r?.kind === 'internal' ? COLORS.internal : heatColor(r?.heat));

/** 带释义 tooltip 的徽章 */
export function badge(label, color, { iconName, title, size = 'sm' } = {}) {
  if (!label) return '';
  const t = title ? ` title="${esc(title)}"` : '';
  return `<span class="wh-badge wh-badge--${size}" style="--b:${color}"${t}>${iconName ? icon(iconName, 'size-3') : ''}${esc(label)}</span>`;
}

/** 亚马逊仓点的状态徽章 */
export function recordBadges(r, defs = {}, opts = {}) {
  const out = [];
  if (r.heatLabel) out.push(badge(r.heatLabel, heatColor(r.heat), { iconName: r.heat === 'hot' ? 'flame' : null, title: defs[r.heatLabel], ...opts }));
  if (r.typeLabel) out.push(badge(r.typeLabel, COLORS[r.type] || COLORS.other, { iconName: r.type === 'oversize' ? 'package' : null, title: defs[r.typeLabel], ...opts }));
  if (r.remote) out.push(badge(r.remoteLabel && r.remoteLabel !== '是' ? r.remoteLabel : '偏远', COLORS.remote, { title: defs['偏远仓'], ...opts }));
  if (r.isNew) out.push(badge('新开', COLORS.isNew, { iconName: 'sparkles', title: r.notes, ...opts }));
  return out.join('');
}

/** 自营仓的状态徽章 */
export function internalBadges(r, opts = {}, { withKind = true } = {}) {
  const out = [];
  if (withKind) out.push(badge('自营仓', COLORS.internal, { iconName: 'house', ...opts }));
  out.push(r.isActive
    ? badge('运营中', COLORS.internal, opts)
    : badge(r.statusLabel, COLORS.warn, { iconName: 'alert', title: r.status, ...opts }));
  if (r.notes && r.notes.length <= 8) out.push(badge(r.notes, COLORS.regular, opts));
  return out.join('');
}
