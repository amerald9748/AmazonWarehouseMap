/**
 * 地图视图：MapLibre 初始化、点聚合、脉冲 HTML 标记、弹窗、相机动画
 */
import * as maplibregl from 'maplibre-gl';
import { CONFIG } from '../config.js';
import { resolveStyle, fallbackStyle, enhanceBasemap } from './basemap.js';
import { toGeoJSON, assignDisplayPositions } from '../data/parser.js';
import { esc, icon } from '../ui/dom.js';
import { COLORS, heatColor, recordBadges, internalBadges, recordColor } from '../ui/badges.js';

const SRC = 'warehouses';
const SEL_SRC = 'wh-selected';
const EMPTY = { type: 'FeatureCollection', features: [] };

export class MapView {
  /**
   * @param {HTMLElement} container
   * @param {{ getPadding: () => object, onSelect: (code: string, from: string) => void,
   *           onViewDetails: (code: string) => void, onHover?: (code: string, on: boolean) => void,
   *           onStyleFallback?: (reason: string) => void }} hooks
   */
  constructor(container, hooks) {
    this.container = container;
    this.hooks = hooks;
    this.records = new Map();
    this.meta = {};
    this.geojson = EMPTY;
    this.markers = new Map();
    this.internalRecords = new Map();
    this.internalMeta = {};
    this.internalMarkers = new Map();
    this.selected = null;
    this.hoverCode = null;
    this.popup = null;
    this.syncQueued = false;
    this.fellBack = false;
  }

  /** 返回在首个样式加载完成后 resolve 的 Promise */
  init() {
    this.theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    this.style = resolveStyle(this.theme);
    const map = (this.map = new maplibregl.Map({
      container: this.container,
      style: this.style.url,
      center: CONFIG.INITIAL_VIEW.center,
      zoom: CONFIG.INITIAL_VIEW.zoom,
      maxPitch: 72,
      attributionControl: { compact: true },
      localIdeographFontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans GB", sans-serif',
      fadeDuration: 180,
    }));
    window.__whMap = map; // 方便在控制台调试

    // 底图引用了 sprite 中不存在的图标（如 circle-11 城市圆点）时，现场画一个，避免控制台告警
    if (typeof map.setMissingStyleImageResolver === 'function') {
      map.setMissingStyleImageResolver((id) => {
        if (!map.hasImage(id)) map.addImage(id, drawDot(/circle|dot/i.test(id)), { pixelRatio: 2 });
      });
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl((this.toolbar = new ToolbarControl(this)), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');

    map.on('error', (e) => this.handleError(e));
    map.on('style.load', () => this.handleStyleLoad());
    const schedule = () => this.scheduleSync();
    map.on('move', schedule);
    map.on('moveend', schedule);
    map.on('sourcedata', (e) => { if (e.sourceId === SRC && map.isSourceLoaded(SRC)) schedule(); });
    map.on('pitchend', () => this.toolbar.update3D(map.getPitch() > 5));

    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      map.once('load', finish);
      this.onFirstStyle = finish;
      setTimeout(finish, 12000); // 网络很慢时也不阻塞界面
    });
  }

  handleError(e) {
    const status = e?.error?.status;
    const url = e?.error?.url || '';
    if (this.style.provider === 'maptiler' && !this.fellBack && (status === 401 || status === 403 || (!this.styleReady && /maptiler/.test(url)))) {
      this.fellBack = true;
      const reason = status ? `MapTiler 返回 ${status}` : 'MapTiler 样式加载失败';
      console.warn(`[底图] ${reason}，切换到免 Key 底图`, e.error);
      this.style = fallbackStyle(this.theme);
      this.map.setStyle(this.style.url);
      this.hooks.onStyleFallback?.(reason);
      return;
    }
    console.debug('[地图]', e?.error?.message || e);
  }

  /** 切换深色 / 浅色底图；数据图层在 style.load 中自动重新添加，HTML 标记不受影响 */
  setTheme(theme) {
    if (theme === this.theme || !this.map) return;
    this.theme = theme;
    this.style = this.fellBack ? fallbackStyle(theme) : resolveStyle(theme);
    this.styleReady = false;
    this.map.setStyle(this.style.url);
  }

  handleStyleLoad() {
    enhanceBasemap(this.map, this.style.provider, this.theme);
    this.addDataLayers();
    this.styleReady = true;
    this.onFirstStyle?.();
    this.scheduleSync();
  }

  addDataLayers() {
    const map = this.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, {
        type: 'geojson',
        data: this.geojson,
        cluster: true,
        clusterRadius: CONFIG.CLUSTER.radius,
        clusterMaxZoom: CONFIG.CLUSTER.maxZoom,
        clusterProperties: {
          hot: ['+', ['get', 'hot']],
          oversize: ['+', ['get', 'oversize']],
          remote: ['+', ['get', 'remote']],
        },
      });
    }
    // 透明锚点图层：保证数据瓦片被加载，HTML 标记依赖 querySourceFeatures
    if (!map.getLayer('wh-anchor')) {
      map.addLayer({ id: 'wh-anchor', type: 'circle', source: SRC, paint: { 'circle-radius': 1, 'circle-opacity': 0 } });
    }
    if (!map.getSource(SEL_SRC)) map.addSource(SEL_SRC, { type: 'geojson', data: this.selectionData() });
    const before = map.getLayer('wh-buildings-3d') ? 'wh-buildings-3d' : undefined;
    // 选中仓点的地面光晕（约 150 m 半径，随缩放保持实际尺寸）
    const groundRadius = (m) => ['interpolate', ['exponential', 2], ['zoom'], 8, m / 160, 18, (m / 160) * 1024];
    if (!map.getLayer('wh-selected-glow')) {
      map.addLayer({
        id: 'wh-selected-glow', type: 'circle', source: SEL_SRC,
        paint: {
          'circle-radius': groundRadius(160), 'circle-color': ['get', 'color'], 'circle-blur': 0.9,
          'circle-opacity': 0.42, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
        },
      }, before);
      map.addLayer({
        id: 'wh-selected-ring', type: 'circle', source: SEL_SRC,
        paint: {
          'circle-radius': groundRadius(95), 'circle-opacity': 0, 'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color'], 'circle-stroke-opacity': 0.75,
          'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
        },
      }, before);
    }
  }

  // ---------------------------------------------------------------- data

  /** 亚马逊仓点（参与聚合） */
  setData(records, meta = this.meta) {
    this.meta = meta;
    this.records = new Map(records.map((r) => [r.code, r]));
    this.geojson = toGeoJSON(records);
    this.map.getSource(SRC)?.setData(this.geojson);
    this.clearMarkers();
    this.scheduleSync();
  }

  // ---------------------------------------------------------------- markers

  scheduleSync() {
    if (this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => this.syncMarkers());
  }

  syncMarkers() {
    this.syncQueued = false;
    const map = this.map;
    if (!map?.getSource(SRC) || !map.isSourceLoaded(SRC)) return;
    const wanted = new Map();
    for (const f of map.querySourceFeatures(SRC)) {
      const p = f.properties;
      const key = p.cluster ? `c:${p.cluster_id}` : `p:${p.code}`;
      if (!wanted.has(key)) wanted.set(key, f);
    }
    for (const [key, entry] of this.markers) if (!wanted.has(key)) this.retireMarker(key, entry);
    for (const [key, f] of wanted) {
      const existing = this.markers.get(key);
      if (existing) {
        if (existing.leaving) { clearTimeout(existing.leaving); existing.leaving = null; existing.el.classList.remove('is-leaving'); }
        continue;
      }
      const entry = f.properties.cluster ? this.createClusterMarker(f) : this.createPointMarker(f);
      if (entry) this.markers.set(key, entry);
    }
  }

  retireMarker(key, entry) {
    if (entry.leaving) return;
    entry.el.classList.add('is-leaving');
    entry.leaving = setTimeout(() => { entry.marker.remove(); this.markers.delete(key); }, 220);
  }

  clearMarkers() {
    for (const entry of this.markers.values()) { clearTimeout(entry.leaving); entry.marker.remove(); }
    this.markers.clear();
  }

  createPointMarker(f) {
    const code = f.properties.code;
    const r = this.records.get(code);
    if (!r) return null;
    const el = document.createElement('div');
    el.className = 'wh-marker';
    el.dataset.code = code;
    el.style.setProperty('--c', heatColor(r.heat));
    const glyph = r.type === 'oversize' ? 'package' : 'warehouse';
    el.innerHTML = `
      <button class="wh-marker__body" type="button" aria-label="仓点 ${esc(code)}">
        <span class="wh-pulse"></span>${r.heat === 'hot' ? '<span class="wh-pulse wh-pulse--2"></span>' : ''}
        <span class="wh-pin${r.remote ? ' is-remote' : ''}${r.type === 'oversize' ? ' is-oversize' : ''}">${icon(glyph, 'wh-pin__icon')}</span>
        <span class="wh-tag">${esc(code)}${r.isNew ? '<i class="wh-tag__dot" title="新开"></i>' : ''}</span>
      </button>`;
    const body = el.firstElementChild;
    body.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.onSelect(code, 'map', 'amazon'); });
    body.addEventListener('mouseenter', () => this.hooks.onHover?.(code, true, 'amazon'));
    body.addEventListener('mouseleave', () => this.hooks.onHover?.(code, false, 'amazon'));
    if (this.isSelected('amazon', code)) el.classList.add('is-selected');
    if (this.isHover('amazon', code)) el.classList.add('is-hover');
    // 用记录里的精确坐标：querySourceFeatures 返回的是瓦片量化后的几何，低缩放级别下可能偏差数百米
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(r.displayLngLat || f.geometry.coordinates)
      .addTo(this.map);
    return { marker, el, code };
  }

  createClusterMarker(f) {
    const p = f.properties;
    const count = p.point_count;
    const hot = p.hot || 0;
    const size = Math.round(Math.min(66, 34 + Math.sqrt(count) * 8));
    const el = document.createElement('div');
    el.className = 'wh-cluster';
    el.style.setProperty('--size', `${size}px`);
    el.style.setProperty('--hot', `${(hot / count) * 360}deg`);
    el.innerHTML = `
      <button class="wh-cluster__body" type="button" aria-label="${count} 个仓点，点击展开">
        <span class="wh-cluster__ring"></span>
        <span class="wh-cluster__count">${count}</span>
      </button>
      <div class="wh-cluster__tip" role="tooltip"><span class="wh-cluster__tip-title">${count} 个仓点 · ${hot} 热门</span><span class="wh-cluster__codes">…</span></div>`;
    const src = this.map.getSource(SRC);
    el.firstElementChild.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const zoom = await src.getClusterExpansionZoom(p.cluster_id);
        this.map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.4, 16), duration: 900, padding: this.hooks.getPadding(), essential: true });
      } catch (err) {
        console.warn('[地图] 展开聚合失败', err);
      }
    });
    let loaded = false;
    el.addEventListener('mouseenter', async () => {
      if (loaded) return;
      loaded = true;
      try {
        const leaves = await src.getClusterLeaves(p.cluster_id, 40, 0);
        const codes = leaves.map((l) => l.properties.code).sort();
        el.querySelector('.wh-cluster__codes').innerHTML = codes
          .map((c) => `<b style="--c:${heatColor(this.records.get(c)?.heat)}">${esc(c)}</b>`).join('');
      } catch { loaded = false; }
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(f.geometry.coordinates)
      .addTo(this.map);
    return { marker, el };
  }

  // ---------------------------------------------------------------- internal warehouses (自营仓)

  /** 自营仓数量少且分散：直接用 HTML 标记，不参与聚合 */
  setInternal(records, meta = this.internalMeta) {
    this.internalMeta = meta;
    this.internalRecords = new Map(records.map((r) => [r.code, r]));
    for (const entry of this.internalMarkers.values()) entry.marker.remove();
    this.internalMarkers.clear();
    assignDisplayPositions(records);
    for (const r of records) {
      if (!r.hasCoords) continue;
      this.internalMarkers.set(r.code, this.createInternalMarker(r));
    }
  }

  createInternalMarker(r) {
    const el = document.createElement('div');
    el.className = 'wh-imarker';
    el.dataset.code = r.code;
    el.style.setProperty('--c', COLORS.internal);
    el.innerHTML = `
      <button class="wh-imarker__body" type="button" aria-label="自营仓 ${esc(r.code)}">
        <span class="wh-ipulse"></span>
        <span class="wh-diamond${r.isActive ? '' : ' is-warn'}">${icon('house', 'wh-diamond__icon')}</span>
        <span class="wh-tag wh-tag--internal">${esc(r.code)}${r.isActive ? '' : `<i class="wh-tag__warn" title="${esc(r.statusLabel)}">!</i>`}</span>
      </button>`;
    const body = el.firstElementChild;
    body.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.onSelect(r.code, 'map', 'internal'); });
    body.addEventListener('mouseenter', () => this.hooks.onHover?.(r.code, true, 'internal'));
    body.addEventListener('mouseleave', () => this.hooks.onHover?.(r.code, false, 'internal'));
    if (this.isSelected('internal', r.code)) el.classList.add('is-selected');
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(r.displayLngLat || [r.lng, r.lat])
      .addTo(this.map);
    return { marker, el, code: r.code };
  }

  setInternalVisible(visible) {
    this.container.classList.toggle('hide-internal', !visible);
    if (!visible && this.selected?.kind === 'internal') this.popup?.remove();
  }

  // ---------------------------------------------------------------- hover & selection state

  isSelected(kind, code) { return this.selected?.kind === kind && this.selected?.code === code; }
  isHover(kind, code) { return this.hover?.kind === kind && this.hover?.code === code; }

  setHover(code, on, kind = 'amazon') {
    this.hover = on && code ? { kind, code } : null;
    this.hoverCode = this.hover?.code ?? null;
    this.refreshMarkerStates();
  }

  refreshMarkerStates() {
    for (const entry of this.markers.values()) {
      if (!entry.code) continue;
      entry.el.classList.toggle('is-hover', this.isHover('amazon', entry.code));
      entry.el.classList.toggle('is-selected', this.isSelected('amazon', entry.code));
    }
    for (const entry of this.internalMarkers.values()) {
      entry.el.classList.toggle('is-hover', this.isHover('internal', entry.code));
      entry.el.classList.toggle('is-selected', this.isSelected('internal', entry.code));
    }
  }

  // ---------------------------------------------------------------- selection & camera

  selectionData() {
    const r = this.selected;
    if (!r?.hasCoords) return EMPTY;
    const coords = r.displayLngLat || [r.lng, r.lat];
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { color: recordColor(r) } }] };
  }

  /** 选中仓库：相机飞行 + 地面光晕 + 弹窗 */
  select(record, { fly = true, popup = true } = {}) {
    this.selected = record;
    this.refreshMarkerStates();
    this.map.getSource(SEL_SRC)?.setData(this.selectionData());
    this.popup?.remove();
    if (!record?.hasCoords) return false;
    if (fly) this.flyTo(record);
    if (popup) {
      const token = (this.popupToken = Symbol('popup'));
      const show = () => { if (this.popupToken === token && this.selected === record) { this.popupToken = null; this.showPopup(record); } };
      if (fly) { this.map.once('moveend', show); setTimeout(show, 4500); } else show();
    }
    return true;
  }

  clearSelection() {
    this.select(null, { fly: false, popup: false });
    this.popupToken = null;
  }

  flyTo(r) {
    const F = CONFIG.FLY_TO;
    this.map.flyTo({
      center: r.displayLngLat || [r.lng, r.lat],
      zoom: F.zoom, pitch: F.pitch, bearing: F.bearing, speed: F.speed, curve: F.curve,
      padding: this.hooks.getPadding(),
      essential: true,
    });
  }

  fitTo(records, { duration = 1600 } = {}) {
    const pts = records.filter((r) => r.hasCoords);
    if (!pts.length) return;
    const pad = this.hooks.getPadding();
    const padding = { top: pad.top + 56, bottom: pad.bottom + 56, left: pad.left + 56, right: pad.right + 70 };
    if (pts.length === 1) {
      this.map.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 11, pitch: 0, bearing: 0, padding: pad, duration, essential: true });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    pts.forEach((r) => b.extend([r.lng, r.lat]));
    try {
      this.map.fitBounds(b, { padding, pitch: 0, bearing: 0, duration, maxZoom: 11, essential: true });
    } catch {
      this.map.fitBounds(b, { pitch: 0, bearing: 0, duration, maxZoom: 11, essential: true });
    }
  }

  toggle3D() {
    const pitched = this.map.getPitch() > 5;
    this.map.easeTo({
      pitch: pitched ? 0 : CONFIG.FLY_TO.pitch,
      bearing: pitched ? 0 : this.map.getBearing() || CONFIG.FLY_TO.bearing,
      zoom: !pitched && this.map.getZoom() < 13 ? this.map.getZoom() + 0.6 : this.map.getZoom(),
      duration: 1000,
      essential: true,
    });
  }

  // ---------------------------------------------------------------- popup

  showPopup(r) {
    this.popup?.remove();
    const rows = [];
    const row = (label, value) => rows.push(`<dt>${esc(label)}</dt><dd>${value ? esc(value) : '<span class="wh-muted">—</span>'}</dd>`);
    if (r.kind === 'internal') return this.showInternalPopup(r, rows, row);
    // 行标签直接使用 Excel 表头原文
    const cols = this.meta.columns || {};
    if (cols.postal) row(cols.postal, r.postal);
    if (cols.state) row(cols.state, r.state.raw);
    if (cols.heat) row(cols.heat, r.heatLabel);
    if (cols.type) row(cols.type, r.typeLabel);
    if (cols.remote) row(cols.remote, r.remoteLabel || '否');
    if (cols.region && r.region) row(cols.region, r.region);
    if (cols.notes && r.notes) row(cols.notes, r.notes);
    for (const e of r.extra) row(e.label, e.value);

    const html = `
      <div class="wh-popup__inner" style="--c:${heatColor(r.heat)}">
        <div class="wh-popup__head">
          <span class="wh-popup__dot"></span>
          <div class="min-w-0">
            <div class="wh-popup__code">${esc(r.code)}</div>
            <div class="wh-popup__sub">${esc(r.city || '—')}${r.state.abbr ? ` · ${esc(r.state.abbr)}` : ''}</div>
          </div>
        </div>
        <div class="wh-popup__badges">${recordBadges(r, this.meta.definitions, { size: 'xs' })}</div>
        <dl class="wh-popup__rows">${rows.join('')}</dl>
        ${r.colocatedWith.length ? `<div class="wh-popup__note">${icon('layers', 'size-3')} 与 ${r.colocatedWith.map(esc).join('、')} 共仓（标记已错开显示）</div>` : ''}
        <button type="button" class="wh-popup__cta">查看详情 ${icon('chevronRight', 'size-3.5')}</button>
      </div>`;
    this.openPopup(r, html);
  }

  showInternalPopup(r, rows, row) {
    row('地址', r.address);
    row('营业时间', r.hours);
    row('状态', r.statusLabel);
    if (r.dock) row('月台', r.dock);
    if (r.notes) row('备注', r.notes);
    for (const e of r.extra) row(e.label, e.value);
    const html = `
      <div class="wh-popup__inner" style="--c:${COLORS.internal}">
        <div class="wh-popup__head">
          <span class="wh-popup__dot is-diamond"></span>
          <div class="min-w-0">
            <div class="wh-popup__code">${esc(r.code)}</div>
            <div class="wh-popup__sub">${esc(r.name || r.city || '—')}</div>
          </div>
        </div>
        <div class="wh-popup__badges">${internalBadges(r, { size: 'xs' })}</div>
        <dl class="wh-popup__rows">${rows.join('')}</dl>
        ${r.colocatedWith.length ? `<div class="wh-popup__note">${icon('layers', 'size-3')} 与 ${r.colocatedWith.map(esc).join('、')} 同一地址（标记已错开显示）</div>` : ''}
        <button type="button" class="wh-popup__cta">查看详情 ${icon('chevronRight', 'size-3.5')}</button>
      </div>`;
    this.openPopup(r, html);
  }

  openPopup(r, html) {
    this.popup = new maplibregl.Popup({
      offset: 24, closeButton: true, closeOnClick: false, maxWidth: '300px', className: 'wh-popup', focusAfterOpen: false,
    })
      .setLngLat(r.displayLngLat || [r.lng, r.lat])
      .setHTML(html)
      .addTo(this.map);
    this.popup.getElement().querySelector('.wh-popup__cta').addEventListener('click', () => this.hooks.onViewDetails(r.code, r.kind));
  }
}

/** 生成城市圆点图标（visible=false 时为透明占位） */
function drawDot(visible) {
  const size = 14;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (visible) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#7c8aa3';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(2,6,23,0.9)';
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/** 地图右上角工具条：显示全部 / 2D·3D 切换 */
class ToolbarControl {
  constructor(view) { this.view = view; }
  onAdd() {
    const el = (this.el = document.createElement('div'));
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group wh-toolbar';
    el.innerHTML = `
      <button type="button" data-act="fit" title="显示全部仓点" aria-label="显示全部仓点">${icon('scan', 'size-[18px]')}</button>
      <button type="button" data-act="3d" title="切换 2D / 3D 视角" aria-label="切换 2D / 3D 视角" aria-pressed="false"><span class="wh-3d-label">3D</span></button>`;
    el.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'fit') this.view.hooks.onFitAll?.();
      if (act === '3d') this.view.toggle3D();
    });
    return el;
  }
  update3D(on) {
    const b = this.el?.querySelector('[data-act="3d"]');
    if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.wh-3d-label').textContent = on ? '2D' : '3D';
  }
  onRemove() { this.el.remove(); }
}
