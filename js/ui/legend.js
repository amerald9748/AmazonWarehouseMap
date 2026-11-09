/** 右下角图例（释义取自 Excel 注释行）+ 自营仓图层开关 */
import { esc, icon } from './dom.js';
import { COLORS } from './badges.js';

const STORAGE_KEY = 'wh-legend-collapsed';

function readCollapsed() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* 隐私模式等情况下忽略 */ }
}

/**
 * @param {HTMLElement} el
 * @param {Record<string,string>} defs Excel 注释行中的释义
 * @param {{ internalVisible?: boolean, hasInternal?: boolean, onToggleInternal?: (v: boolean) => void }} opts
 */
export function renderLegend(el, defs = {}, { internalVisible = true, hasInternal = false, onToggleInternal } = {}) {
  const item = (swatch, label, title) =>
    `<li class="flex items-center gap-2.5"${title ? ` title="${esc(title)}"` : ''}>${swatch}<span>${esc(label)}</span>${title ? icon('info', 'size-3 text-slate-500') : ''}</li>`;
  const dot = (c) => `<span class="wh-legend-dot" style="--c:${c}"></span>`;
  el.innerHTML = `
    <button type="button" class="flex w-full items-center justify-between gap-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-200 transition" data-act="toggle" aria-expanded="true">
      <span class="flex items-center gap-1.5">${icon('layers', 'size-3.5')}图例</span>
      <span class="wh-legend-chevron">${icon('chevronDown', 'size-3.5')}</span>
    </button>
    <ul class="wh-legend-body mt-3 space-y-2 text-xs text-slate-300">
      ${item(dot(COLORS.hot), '热门仓', defs['热门仓'])}
      ${item(dot(COLORS.regular), '常规仓', defs['常规仓'])}
      ${item('<span class="wh-legend-dot is-square" style="--c:#cbd5e1"></span>', '大件仓', defs['大件仓'])}
      ${item('<span class="wh-legend-dot is-remote" style="--c:#cbd5e1"></span>', '偏远仓', defs['偏远仓'])}
      ${item('<span class="wh-legend-cluster"></span>', '热门仓比例', '')}
      ${hasInternal ? `
      <li class="!mt-3 border-t border-white/[0.07] pt-3">
        <button type="button" role="switch" aria-checked="${internalVisible}" data-act="toggle-internal" class="wh-switch flex w-full items-center gap-2.5 text-left">
          <span class="wh-legend-dot is-diamond" style="--c:${COLORS.internal}"></span>
          <span class="flex-1">自营仓</span>
          <span class="wh-switch__track"><span class="wh-switch__thumb"></span></span>
        </button>
      </li>` : ''}
    </ul>`;
  const setCollapsed = (v) => {
    el.classList.toggle('is-collapsed', v);
    el.querySelector('[data-act="toggle"]').setAttribute('aria-expanded', String(!v));
  };
  setCollapsed(readCollapsed());
  el.querySelector('[data-act="toggle"]').addEventListener('click', () => {
    const v = !el.classList.contains('is-collapsed');
    setCollapsed(v);
    writeCollapsed(v);
  });
  el.querySelector('[data-act="toggle-internal"]')?.addEventListener('click', (e) => {
    const next = e.currentTarget.getAttribute('aria-checked') !== 'true';
    e.currentTarget.setAttribute('aria-checked', String(next));
    onToggleInternal?.(next);
  });
  el.hidden = false;
}
