/**
 * 渲染性能：为老旧 / 集成显卡自动启用「流畅模式」(lite)
 * ------------------------------------------------------------------
 * 判定顺序：URL ?perf=lite|high → config.PERFORMANCE_MODE → 上次运行时记录 → GPU 型号 → 运行时帧率监测
 * 流畅模式：像素比上限 1、3D 建筑简化（不透明、无渐变、z14.5 起）、关闭地球大气、
 *           去掉所有毛玻璃模糊与标记脉冲动画。
 * 调试：URL 加 ?fps=1 在右下角显示实时帧率。
 */
import { CONFIG } from './config.js';

const STORE_KEY = 'wh-perf';
const params = new URLSearchParams(location.search);

let state = null;

export function gpuRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { return ''; }
}

/** 软件渲染器与 2015 年前的 Intel 集成显卡（HD 2000–5600 / 无型号的 HD Graphics） */
const WEAK_GPU = /swiftshader|llvmpipe|software|basic render|intel.*hd graphics(?:\s+(?:[2-4]\d{3}|5[0-6]\d{2}))?(?!\s*\d)|mali-[t]?[4-6]\d\d|adreno.*\b[34]\d\d\b|powervr/i;

export function getPerf() {
  if (state) return state;
  const q = params.get('perf');
  let mode = 'high';
  let reason = '默认';
  if (q === 'lite' || q === 'high') {
    mode = q; reason = 'URL 参数';
    try { if (q === 'high') localStorage.removeItem(STORE_KEY); } catch { /* 忽略 */ }
  } else if (CONFIG.PERFORMANCE_MODE === 'lite' || CONFIG.PERFORMANCE_MODE === 'high') {
    mode = CONFIG.PERFORMANCE_MODE; reason = 'config.js';
  } else {
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch { /* 忽略 */ }
    const gpu = gpuRenderer();
    if (stored === 'lite') { mode = 'lite'; reason = '上次运行检测到帧率偏低'; }
    else if (WEAK_GPU.test(gpu)) { mode = 'lite'; reason = `显卡：${gpu}`; }
  }
  state = { mode, reason, auto: q == null && !['lite', 'high'].includes(CONFIG.PERFORMANCE_MODE) };
  document.documentElement.classList.toggle('perf-lite', mode === 'lite');
  console.info(`[性能] ${mode === 'lite' ? '流畅模式' : '标准模式'}（${reason}）`);
  return state;
}

export const isLite = () => getPerf().mode === 'lite';

/** 地图像素比：标准模式上限 2，流畅模式上限 1（高分屏上 GPU 负担降为 1/4） */
export const mapPixelRatio = () => Math.min(window.devicePixelRatio || 1, isLite() ? 1 : 2);

/** 3D 建筑在两种模式下的参数 */
export function buildingSpec() {
  return isLite()
    ? { minzoom: 14.5, rampEnd: 15.2, opacity: 1, gradient: false }
    : { minzoom: 14, rampEnd: 15, opacity: 0.92, gradient: true };
}

/** 运行时切换到流畅模式（不刷新页面） */
export function switchToLite(map, reason) {
  if (isLite()) return;
  state = { ...getPerf(), mode: 'lite', reason };
  document.documentElement.classList.add('perf-lite');
  try { localStorage.setItem(STORE_KEY, 'lite'); } catch { /* 忽略 */ }
  try { map.setPixelRatio(mapPixelRatio()); } catch { /* 旧版本无此 API */ }
  const b = buildingSpec();
  if (map.getLayer('wh-buildings-3d')) {
    map.setPaintProperty('wh-buildings-3d', 'fill-extrusion-opacity', b.opacity);
    map.setPaintProperty('wh-buildings-3d', 'fill-extrusion-vertical-gradient', b.gradient);
    map.setLayerZoomRange('wh-buildings-3d', b.minzoom, 24);
  }
  try { map.setSky({ 'atmosphere-blend': 0 }); } catch { /* 可选 */ }
  console.info(`[性能] 已切换到流畅模式（${reason}）`);
}

/**
 * 在相机移动期间采样帧时间；连续偏低则自动切到流畅模式。
 * 只在页面可见时计数，避免后台标签页被节流造成误判。
 */
export function watchFrameRate(map, onDowngrade) {
  if (!getPerf().auto || isLite()) return;
  const samples = [];
  let moving = false;
  let last = 0;
  const tick = (now) => {
    if (!moving) return;
    if (last && document.visibilityState === 'visible') samples.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  map.on('movestart', () => { moving = true; last = 0; requestAnimationFrame(tick); });
  map.on('moveend', () => {
    moving = false;
    if (samples.length < 90 || isLite()) return;
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const fps = 1000 / median;
    if (fps < 32) {
      switchToLite(map, `移动时帧率约 ${Math.round(fps)} fps`);
      onDowngrade?.(Math.round(fps));
    }
    samples.length = 0;
  });
}

/** ?fps=1：右下角实时帧率 */
export function maybeShowFps() {
  if (params.get('fps') !== '1') return;
  const el = document.createElement('div');
  el.className = 'wh-fps';
  document.body.append(el);
  let frames = 0;
  let t0 = performance.now();
  let worst = 0;
  let last = t0;
  const loop = (now) => {
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - t0 >= 500) {
      el.textContent = `${Math.round((frames * 1000) / (now - t0))} fps · 最慢 ${Math.round(worst)} ms · ${isLite() ? '流畅模式' : '标准模式'}`;
      frames = 0; t0 = now; worst = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
