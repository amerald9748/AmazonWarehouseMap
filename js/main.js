/**
 * 应用入口：状态管理 + 地图 / 侧边栏 / 详情 的联动
 * 两类数据：amazon（亚马逊仓点，聚合显示）与 internal（自营仓，菱形标记）
 */
import { CONFIG } from './config.js';
import { loadWorkbookFromUrl, parseWorkbookFile, registryToMap, KIND_LABEL } from './data/parser.js';
import { getSampleDataset } from './data/sample-data.js';
import { MapView } from './map/map-view.js';
import { $, $$, esc, icon, debounce, copyText } from './ui/dom.js';
import { renderKpis, renderChips, renderList, renderStatus, renderKindTabs } from './ui/sidebar.js';
import { renderDetail, renderTab, resolveTab, TABS_BY_KIND } from './ui/detail.js';
import { renderLegend } from './ui/legend.js';
import { toast } from './ui/toast.js';
import { COLORS } from './ui/badges.js';

const KINDS = ['amazon', 'internal'];
const FILTERS = {
  amazon: () => ({ province: null, heat: null, type: null, remote: false }),
  internal: () => ({ province: null, status: null }),
};
const newSet = (kind) => ({
  kind, dataset: null, all: [], byCode: new Map(), meta: {}, filters: FILTERS[kind](),
  byQuery: [], base: [], filtered: [], filteredKey: null, groups: [], order: [], provinces: [],
});

const state = {
  tab: 'amazon',
  sets: { amazon: newSet('amazon'), internal: newSet('internal') },
  known: { amazon: new Map(), internal: new Map() },
  query: '',
  terms: [],
  activeIndex: -1,
  selected: null,
  detailTab: 'overview',
  internalVisible: true,
};
const activeSet = () => state.sets[state.tab];

const els = {
  panel: $('#panel'),
  body: $('#panel-body'),
  list: $('#list'),
  detail: $('#detail-view'),
  search: $('#search'),
  searchClear: $('#search-clear'),
  kindTabs: $('#kind-tabs'),
  kpis: $('#kpis'),
  chips: $('#chips'),
  count: $('#result-count'),
  status: $('#data-status'),
  source: $('#source-label'),
  legend: $('#legend'),
  loader: $('#loader'),
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
};

let mapView;

boot();

// ================================================================ boot

async function boot() {
  renderStatus(els.status, { text: '正在加载仓库数据…', tone: 'loading' });
  bindUI();

  mapView = new MapView($('#map'), {
    getPadding,
    onSelect: (code, from, kind) => select(kind, code, { from }),
    onViewDetails: (code, kind) => viewDetails(kind, code),
    onHover: (code, on, kind) => $$(`.wh-item[data-kind="${kind}"][data-code="${CSS.escape(code)}"]`, els.list).forEach((n) => n.classList.toggle('is-hover', on)),
    onFitAll: () => fitAll(),
    onStyleFallback: (reason) => toast(`${reason}，已切换到免 Key 底图`, { tone: 'warn', timeout: 5000 }),
  });

  let mapReady = Promise.resolve();
  try {
    mapReady = mapView.init();
  } catch (err) {
    console.error('[地图] 初始化失败', err);
    toast(`地图初始化失败：${err.message}（需要支持 WebGL2 的浏览器）`, { tone: 'error', timeout: 10000 });
  }

  await loadRegistry();
  const [amazon, internal] = await Promise.all([loadAmazon(), loadInternal(), mapReady]);
  setDataset(amazon);
  if (internal) setDataset(internal);
  renderLegendPanel();
  updateStatus();
  recompute();

  const target = findByHash();
  if (target) setTimeout(() => select(target.kind, target.code, { from: 'hash' }), 400);
  else fitAll(2800);
  hideLoader();
}

/** 已知坐标登记表：Excel 缺少坐标时按编码沿用 */
async function loadRegistry() {
  try {
    const res = await fetch(CONFIG.COORDS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.known.amazon = registryToMap(json.warehouses);
    state.known.internal = registryToMap(json.internal);
    console.log(`[坐标] 已知坐标登记表：亚马逊 ${state.known.amazon.size} 个 · 自营仓 ${state.known.internal.size} 个`);
  } catch (err) {
    console.warn(`[坐标] 无法加载 ${CONFIG.COORDS_URL}，缺少坐标的行将不会上图`, err);
  }
}

async function loadAmazon() {
  try {
    const ds = await loadWorkbookFromUrl(CONFIG.DATA_URL, { known: state.known, expectKind: 'amazon' });
    ds.origin = 'excel';
    return ds;
  } catch (err) {
    console.error('[仓点数据] 亚马逊仓点 Excel 加载失败，改用示例数据：', err);
    const ds = getSampleDataset();
    ds.origin = 'sample';
    ds.error = err.message;
    setTimeout(() => toast(`未能加载 ${CONFIG.DATA_URL}，当前显示示例数据`, { tone: 'warn', timeout: 6500 }), 900);
    return ds;
  }
}

async function loadInternal() {
  if (!CONFIG.INTERNAL_DATA_URL) return null;
  try {
    const ds = await loadWorkbookFromUrl(CONFIG.INTERNAL_DATA_URL, { known: state.known, expectKind: 'internal' });
    ds.origin = 'excel';
    return ds;
  } catch (err) {
    console.warn('[仓点数据] 自营仓 Excel 未加载：', err);
    return null;
  }
}

function hideLoader() {
  els.loader?.classList.add('is-hidden');
  setTimeout(() => els.loader?.remove(), 900);
}

// ================================================================ data

function haystack(r) {
  const common = [r.code, r.city, r.state.abbr, r.state.name, r.postal, r.postal.replace(/\s/g, ''), r.notes, ...r.extra.map((e) => e.value)];
  const specific = r.kind === 'internal'
    ? [r.name, r.address, r.addrCity, r.hours, r.status, r.statusLabel, r.dock, '自营']
    : [r.cityEn, r.heatLabel, r.typeLabel, r.remote ? '偏远' : '', r.region];
  return [...common, ...specific].join(' ').toLowerCase();
}

/** 写入一个数据集（不移动相机） */
function setDataset(ds) {
  const set = state.sets[ds.kind];
  set.dataset = ds;
  set.all = ds.records;
  set.meta = ds.meta;
  set.byCode = new Map(ds.records.map((r) => [r.code, r]));
  set.filters = FILTERS[ds.kind]();
  set.filteredKey = null;
  for (const r of ds.records) r._hay = haystack(r);
  // 本表中带坐标的记录加入「已知坐标」，之后导入的无坐标表格可以沿用
  for (const r of ds.records) {
    if (r.coordSource !== 'excel') continue;
    const prev = state.known[ds.kind].get(r.code);
    state.known[ds.kind].set(r.code, { lat: r.lat, lng: r.lng, precision: r.coordPrecision ?? prev?.precision ?? null, from: ds.meta.sourceName });
  }
  if (state.selected?.kind === ds.kind) {
    state.selected = null;
    mapView.clearSelection();
    showList();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
}

function updateStatus() {
  const a = state.sets.amazon.dataset;
  const i = state.sets.internal.dataset;
  const date = a?.meta.updatedAt instanceof Date ? a.meta.updatedAt.toLocaleDateString('zh-CN') : '';
  const parts = [`${a?.records.length ?? 0} 个亚马逊仓点`];
  if (i) parts.push(`${i.records.length} 个自营仓`);
  if (date && a?.origin === 'excel') parts.push(`更新于 ${date}`);
  const describe = (ds) => {
    if (!ds) return '';
    const s = ds.stats;
    return `${KIND_LABEL[ds.kind]}（${ds.meta.sourceName}）：解析 ${s.parsed} · 空行 ${s.blank} · 无编码 ${s.noCode} · 重复 ${s.duplicate} · 沿用坐标 ${s.inheritedCoords} · 缺坐标 ${s.noCoords} · 邮编纠正 ${s.fixedPostal}`;
  };
  const missing = (a?.stats.noCoords || 0) + (i?.stats.noCoords || 0);
  let tone = missing ? 'warn' : 'ok';
  let text = parts.join(' · ');
  if (a?.origin === 'sample') { tone = 'warn'; text = `示例数据（Excel 未加载）${i ? ` · ${i.records.length} 个自营仓` : ''}`; }
  else if (a?.origin === 'import' || i?.origin === 'import') { tone = 'info'; text += ' · 本地导入预览'; }
  renderStatus(els.status, { text, tone, title: [describe(a), describe(i), a?.error || ''].filter(Boolean).join('\n') });
}

function updateSourceLabel() {
  const ds = activeSet().dataset;
  if (!ds) {
    els.source.innerHTML = `${icon('file', 'size-3.5 shrink-0')}<span class="truncate">未加载${KIND_LABEL[state.tab]}数据</span>`;
    return;
  }
  els.source.innerHTML = `${icon('file', 'size-3.5 shrink-0')}<span class="truncate">${esc(ds.meta.sourceName)}${ds.meta.sheetName ? ` · ${esc(ds.meta.sheetName)}` : ''}</span>`;
  els.source.title = ds.meta.title || '';
}

function renderLegendPanel() {
  renderLegend(els.legend, state.sets.amazon.meta.definitions, {
    internalVisible: state.internalVisible,
    hasInternal: !!state.sets.internal.dataset,
    onToggleInternal: (v) => setInternalVisible(v),
  });
}

function setInternalVisible(v) {
  state.internalVisible = v;
  mapView.setInternalVisible(v);
  const toggle = $('[data-act="toggle-internal"]', els.legend);
  toggle?.setAttribute('aria-checked', String(v));
}

// ================================================================ filtering

function matchesQuery(r) {
  return state.terms.every((t) => r._hay.includes(t));
}

const PASSES = {
  amazon: (f) => (r) => (!f.heat || r.heat === f.heat) && (!f.type || r.type === f.type) && (!f.remote || r.remote),
  internal: (f) => (r) => !f.status || (f.status === 'active' ? r.isActive : !r.isActive),
};

function computeSet(set) {
  const f = set.filters;
  set.byQuery = set.all.filter(matchesQuery);
  set.base = set.byQuery.filter((r) => !f.province || r.state.abbr === f.province);
  set.filtered = set.base.filter(PASSES[set.kind](f));

  // 省份按经度自西向东排列
  const provinces = new Map();
  for (const r of set.all) {
    const key = r.state.abbr || '—';
    if (!provinces.has(key)) provinces.set(key, { abbr: key, name: r.state.name || '其他', lngSum: 0, n: 0, count: 0 });
    const p = provinces.get(key);
    if (r.hasCoords) { p.lngSum += r.lng; p.n++; }
  }
  for (const r of set.byQuery) provinces.get(r.state.abbr || '—').count++;
  set.provinces = [...provinces.values()].sort((a, b) => (a.n ? a.lngSum / a.n : 999) - (b.n ? b.lngSum / b.n : 999));
  set.groups = set.provinces
    .map((p) => ({
      ...p,
      items: set.filtered
        .filter((r) => (r.state.abbr || '—') === p.abbr)
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })),
    }))
    .filter((g) => g.items.length);
  set.order = set.groups.flatMap((g) => g.items);
}

function kpiItems(set) {
  const f = set.filters;
  const b = set.base;
  if (set.kind === 'internal') {
    return [
      { key: 'all', label: '自营仓', value: b.length, color: '#e2e8f0', active: !f.status, title: '显示全部自营仓' },
      { key: 'active', label: '运营中', value: b.filter((r) => r.isActive).length, color: COLORS.internal, active: f.status === 'active', title: '只看运营中的仓库' },
      { key: 'attention', label: '状态提醒', value: b.filter((r) => !r.isActive).length, color: COLORS.warn, active: f.status === 'attention', title: '状态不是 Active 的仓库（如即将弃用）' },
    ];
  }
  return [
    { key: 'all', label: '仓点', value: b.length, color: '#e2e8f0', active: !f.heat && !f.type && !f.remote, title: '显示全部（清除快速筛选）' },
    { key: 'hot', label: '热门', value: b.filter((r) => r.heat === 'hot').length, color: COLORS.hot, active: f.heat === 'hot', title: '只看热门仓' },
    { key: 'oversize', label: '大件', value: b.filter((r) => r.type === 'oversize').length, color: COLORS.oversize, active: f.type === 'oversize', title: '只看大件仓' },
    { key: 'remote', label: '偏远', value: b.filter((r) => r.remote).length, color: COLORS.remote, active: f.remote, title: '只看偏远仓' },
  ];
}

const hasFilters = (set) => !!(state.terms.length || Object.values(set.filters).some(Boolean));

function recompute({ fit = false } = {}) {
  KINDS.forEach((k) => computeSet(state.sets[k]));
  const set = activeSet();
  state.activeIndex = -1;

  renderKindTabs(els.kindTabs, { amazon: state.sets.amazon.filtered.length, internal: state.sets.internal.filtered.length }, state.tab);
  renderKpis(els.kpis, kpiItems(set));
  renderChips(els.chips, set.provinces, set.filters.province);
  renderList(els.list, set.groups, {
    terms: state.terms, selected: state.selected, total: set.all.length, hasFilters: hasFilters(set), kind: set.kind,
    emptyText: set.dataset ? '' : `未加载${KIND_LABEL[set.kind]}数据`,
  });
  const label = KIND_LABEL[set.kind];
  els.count.textContent = hasFilters(set) ? `筛选出 ${set.filtered.length} / ${set.all.length} 个${label}` : `共 ${set.all.length} 个${label}`;
  updateSourceLabel();

  const a = state.sets.amazon;
  const aKey = a.filtered.map((r) => r.code).join('|');
  if (aKey !== a.filteredKey) { a.filteredKey = aKey; mapView.setData(a.filtered, a.meta); }
  const i = state.sets.internal;
  const iKey = i.filtered.map((r) => r.code).join('|');
  if (iKey !== i.filteredKey) { i.filteredKey = iKey; mapView.setInternal(i.filtered, i.meta); }

  if (fit && set.filtered.length) mapView.fitTo(set.filtered, { duration: 1300 });
}

function resetFilters() {
  activeSet().filters = FILTERS[state.tab]();
  state.query = '';
  state.terms = [];
  els.search.value = '';
  els.searchClear.hidden = true;
  recompute({ fit: true });
}

function switchKind(kind) {
  if (state.tab === kind) return;
  state.tab = kind;
  if (kind === 'internal' && !state.internalVisible) setInternalVisible(true);
  showList();
  recompute({ fit: true });
}

function fitAll(duration = 1400) {
  mapView.popup?.remove();
  const visible = [...state.sets.amazon.filtered, ...(state.internalVisible ? state.sets.internal.filtered : [])];
  const all = [...state.sets.amazon.all, ...state.sets.internal.all];
  mapView.fitTo(visible.length ? visible : all, { duration });
}

// ================================================================ selection & views

function findByHash() {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  if (!code) return null;
  for (const kind of KINDS) if (state.sets[kind].byCode.has(code)) return { kind, code };
  return null;
}

function select(kind, code, { from = 'list', fly = true } = {}) {
  const r = state.sets[kind]?.byCode.get(code);
  if (!r) return;
  state.selected = r;
  if (state.tab !== kind) {
    // 切换到对应类型，返回列表时回到正确的列表
    state.tab = kind;
    recompute();
  }
  if (kind === 'internal' && !state.internalVisible) setInternalVisible(true);
  state.detailTab = resolveTab(r, state.detailTab);
  renderDetailView();
  showDetail();
  $$('.wh-item', els.list).forEach((n) => {
    const on = n.dataset.kind === kind && n.dataset.code === code;
    n.classList.toggle('is-selected', on);
    n.setAttribute('aria-selected', String(on));
  });
  // 手机上详情已在底部面板中，不再弹出重复的地图弹窗
  const onMap = mapView.select(r, { fly, popup: isDesktop() });
  if (!onMap) toast(`${code} 缺少有效坐标，无法在地图上定位`, { tone: 'warn' });
  history.replaceState(null, '', `#${encodeURIComponent(code)}`);
  console.debug(`[交互] 选中 ${KIND_LABEL[kind]} ${code}（来源：${from}）`);
}

function viewDetails(kind, code) {
  if (els.panel.classList.contains('is-collapsed')) setCollapsed(false);
  if (state.selected?.kind !== kind || state.selected?.code !== code) select(kind, code, { fly: false });
  showDetail();
  const hero = $('.wh-hero', els.detail);
  hero?.classList.remove('wh-flash');
  void hero?.offsetWidth;
  hero?.classList.add('wh-flash');
}

function back() {
  state.selected = null;
  mapView.clearSelection();
  showList();
  $$('.wh-item.is-selected', els.list).forEach((n) => { n.classList.remove('is-selected'); n.setAttribute('aria-selected', 'false'); });
  history.replaceState(null, '', location.pathname + location.search);
}

function orderFor(r) {
  const set = state.sets[r.kind];
  return set.order.includes(r) ? set.order : set.all;
}

function step(delta) {
  const r = state.selected;
  if (!r) return;
  const order = orderFor(r);
  if (!order.length) return;
  const i = order.indexOf(r);
  select(r.kind, order[(i + delta + order.length) % order.length].code, { from: 'step' });
}

function detailContext() {
  const r = state.selected;
  const order = orderFor(r);
  return {
    meta: state.sets[r.kind].meta,
    amazon: state.sets.amazon.all,
    internal: state.sets.internal.all,
    index: order.indexOf(r),
    total: order.length,
    tab: state.detailTab,
  };
}

function renderDetailView() {
  els.detail.innerHTML = renderDetail(state.selected, detailContext());
}

function switchTab(id) {
  const r = state.selected;
  if (!r || state.detailTab === id) return;
  state.detailTab = id;
  const tabs = $('.wh-tabs', els.detail);
  tabs.style.setProperty('--i', String(TABS_BY_KIND[r.kind].findIndex((t) => t.id === id)));
  $$('[data-tab]', tabs).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  const panel = $('[data-tabpanel]', els.detail);
  panel.innerHTML = renderTab(id, r, detailContext());
  panel.scrollTop = 0;
}

function showDetail() {
  els.body.classList.add('is-detail');
  els.panel.classList.add('is-detail-open');
}
function showList() {
  els.body.classList.remove('is-detail');
  els.panel.classList.remove('is-detail-open');
}

// ================================================================ layout helpers

const isDesktop = () => matchMedia('(min-width: 768px)').matches;

/** 让相机中心落在侧边栏以外的可视区域 */
function getPadding() {
  const p = els.panel;
  const collapsed = p.classList.contains('is-collapsed');
  if (isDesktop()) return { top: 0, right: 0, bottom: 0, left: collapsed ? 0 : p.offsetLeft + p.offsetWidth };
  return { top: 0, right: 0, left: 0, bottom: collapsed ? 76 : Math.max(0, window.innerHeight - p.offsetTop) };
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f1f5f9' : '#020617');
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'light'));
  mapView.setTheme(theme);
}

function setCollapsed(v) {
  els.panel.classList.toggle('is-collapsed', v);
  document.body.classList.toggle('panel-collapsed', v);
  $('#panel-toggle').setAttribute('aria-expanded', String(!v));
  mapView.map?.easeTo({ padding: getPadding(), duration: 550 });
}

// ================================================================ events

function bindUI() {
  // 搜索（同时作用于两类数据，标签上的数字随之变化）
  const runSearch = debounce(() => {
    state.query = els.search.value.trim();
    state.terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    showList();
    recompute();
  }, 110);
  els.search.addEventListener('input', () => {
    els.searchClear.hidden = !els.search.value;
    runSearch();
  });
  els.search.addEventListener('keydown', (e) => {
    const order = activeSet().order;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.activeIndex >= 0) select(state.tab, order[state.activeIndex].code, { from: 'keyboard' });
      else if (order.length === 1) select(state.tab, order[0].code, { from: 'search' });
      else if (order.length) mapView.fitTo(order, { duration: 1200 });
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (els.search.value) { els.search.value = ''; els.searchClear.hidden = true; runSearch(); } else els.search.blur();
    }
  });
  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    els.searchClear.hidden = true;
    runSearch();
    els.search.focus();
  });

  // 亚马逊 / 自营仓 切换
  els.kindTabs.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind-tab]')?.dataset.kindTab;
    if (kind) switchKind(kind);
  });

  // KPI 快速筛选
  els.kpis.addEventListener('click', (e) => {
    const key = e.target.closest('[data-kpi]')?.dataset.kpi;
    if (!key) return;
    const f = activeSet().filters;
    if (state.tab === 'internal') {
      f.status = key === 'all' ? null : f.status === key ? null : key;
    } else {
      if (key === 'all') Object.assign(f, { heat: null, type: null, remote: false });
      if (key === 'hot') f.heat = f.heat === 'hot' ? null : 'hot';
      if (key === 'oversize') f.type = f.type === 'oversize' ? null : 'oversize';
      if (key === 'remote') f.remote = !f.remote;
    }
    showList();
    recompute({ fit: true });
  });

  // 省份
  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-province]');
    if (!chip) return;
    const abbr = chip.dataset.province || null;
    const f = activeSet().filters;
    f.province = f.province === abbr ? null : abbr;
    showList();
    recompute({ fit: true });
    els.chips.querySelector(`[data-province="${CSS.escape(abbr || '')}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  });

  // 列表
  els.list.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="reset"]')) return resetFilters();
    const item = e.target.closest('.wh-item');
    if (item) select(item.dataset.kind, item.dataset.code, { from: 'list' });
  });
  els.list.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.wh-item');
    if (item && !(mapView.hover?.kind === item.dataset.kind && mapView.hover?.code === item.dataset.code)) {
      mapView.setHover(item.dataset.code, true, item.dataset.kind);
    }
  });
  els.list.addEventListener('mouseleave', () => mapView.setHover(null, false));

  // 详情
  els.detail.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.act === 'back') return back();
    if (t.dataset.act === 'prev') return step(-1);
    if (t.dataset.act === 'next') return step(1);
    if (t.dataset.act === 'locate') return state.selected && mapView.select(state.selected, { popup: isDesktop() });
    if (t.dataset.tab) return switchTab(t.dataset.tab);
    if (t.dataset.copy) {
      const ok = await copyText(t.dataset.copy);
      toast(ok ? `已复制 ${t.dataset.copy}` : '复制失败，请手动选择文本', { tone: ok ? 'success' : 'error', timeout: 1800 });
      if (ok) { const old = t.innerHTML; t.innerHTML = icon('check', 'size-3.5 text-emerald-400'); setTimeout(() => { t.innerHTML = old; }, 1200); }
      return;
    }
    if (t.dataset.code) return select(t.dataset.kind || state.selected?.kind || 'amazon', t.dataset.code, { from: 'detail' });
  });
  els.detail.addEventListener('mouseover', (e) => {
    const near = e.target.closest('.wh-near');
    mapView.setHover(near?.dataset.code || null, !!near, near?.dataset.kind);
  });

  // 深色 / 浅色模式
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('wh-theme', next); } catch { /* 隐私模式下不记忆，忽略 */ }
  });

  // 面板折叠
  $('#panel-toggle').addEventListener('click', () => setCollapsed(!els.panel.classList.contains('is-collapsed')));
  $('#panel-open').addEventListener('click', () => setCollapsed(false));
  window.addEventListener('resize', debounce(() => mapView.map?.easeTo({ padding: getPadding(), duration: 0 }), 200));

  // 导入 Excel（自动识别亚马逊仓点表 / 自营仓目录）
  $('#import-btn').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    if (file) importFile(file);
    els.fileInput.value = '';
  });
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; els.dropzone.classList.add('is-visible'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.dropzone.classList.remove('is-visible'); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.dropzone.classList.remove('is-visible');
    const file = e.dataTransfer.files?.[0];
    if (file) importFile(file);
  });

  // 全局快捷键
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); els.search.focus(); els.search.select(); return; }
    if (typing) return;
    if (e.key === 'Escape') { if (state.selected) back(); else mapView.popup?.remove(); }
    if (state.selected && e.key === 'ArrowLeft') step(-1);
    if (state.selected && e.key === 'ArrowRight') step(1);
  });

  window.addEventListener('hashchange', () => {
    const target = findByHash();
    if (target && !(state.selected?.kind === target.kind && state.selected?.code === target.code)) select(target.kind, target.code, { from: 'hash' });
  });
}

function moveActive(delta) {
  const order = activeSet().order;
  if (!order.length) return;
  state.activeIndex = (state.activeIndex + delta + order.length) % order.length;
  const r = order[state.activeIndex];
  $$('.wh-item', els.list).forEach((n) => n.classList.toggle('is-active', n.dataset.kind === r.kind && n.dataset.code === r.code));
  $(`.wh-item[data-kind="${r.kind}"][data-code="${CSS.escape(r.code)}"]`, els.list)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  mapView.setHover(r.code, true, r.kind);
}

async function importFile(file) {
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
    toast('请选择 Excel 文件（.xlsx / .xls / .csv）', { tone: 'error' });
    return;
  }
  try {
    const ds = await parseWorkbookFile(file, { known: state.known });
    if (!ds.records.length) throw new Error('文件中没有识别到仓库记录');
    ds.origin = 'import';
    setDataset(ds);
    if (ds.kind === 'amazon') renderLegendPanel();
    if (ds.kind === 'internal' && !state.internalVisible) setInternalVisible(true);
    state.tab = ds.kind;
    showList();
    updateStatus();
    recompute({ fit: true });
    const s = ds.stats;
    const extra = [s.inheritedCoords ? `${s.inheritedCoords} 个沿用已知坐标` : '', s.noCoords ? `${s.noCoords} 个缺少坐标` : ''].filter(Boolean).join('，');
    toast(`已导入${KIND_LABEL[ds.kind]} ${file.name}：${ds.records.length} 个${extra ? `（${extra}）` : ''} · 仅本地预览，未上传`, { tone: s.noCoords ? 'warn' : 'success', timeout: 6500 });
  } catch (err) {
    console.error('[导入] 失败', err);
    toast(`导入失败：${err.message}`, { tone: 'error', timeout: 6500 });
  }
}
