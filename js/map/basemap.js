/**
 * 底图：MapTiler（有 Key 时）→ OpenFreeMap（免 Key 回退）
 * 并在每次样式加载后：中文地名、深色调统一、3D 建筑挤出、地球大气。
 */
import { CONFIG } from '../config.js';

/** @param {'dark'|'light'} theme */
export function resolveStyle(theme = 'dark') {
  const key = (CONFIG.MAPTILER_API_KEY || '').trim();
  if (key) {
    const id = theme === 'light' ? CONFIG.MAPTILER_STYLE_LIGHT : CONFIG.MAPTILER_STYLE;
    return {
      provider: 'maptiler',
      theme,
      url: `https://api.maptiler.com/maps/${encodeURIComponent(id)}/style.json?key=${encodeURIComponent(key)}`,
    };
  }
  console.info('[底图] 未配置 MapTiler Key，使用免 Key 的 OpenFreeMap 底图（在 js/config.js 中填入 Key 即可切换）');
  return fallbackStyle(theme);
}

export function fallbackStyle(theme = 'dark') {
  return { provider: 'openfreemap', theme, url: theme === 'light' ? CONFIG.FALLBACK_STYLE_URL_LIGHT : CONFIG.FALLBACK_STYLE_URL };
}

/** 样式加载完成后调用（setStyle 之后也会再次调用） */
export function enhanceBasemap(map, provider, theme = 'dark') {
  const layers = map.getStyle()?.layers || [];
  if (provider === 'openfreemap' && theme === 'dark') tintDark(map, layers);
  if (CONFIG.MAP_LABEL_LANGUAGE === 'zh') localizeLabels(map, layers);
  if (CONFIG.BUILDINGS_3D) add3DBuildings(map, layers, theme);
  setupGlobe(map, theme);
}

/**
 * OpenFreeMap 的 dark 样式对比度极低（陆地 rgb12 / 水体 rgb27），
 * 这里重新调成与 UI 一致的「海军蓝 + slate」技术风配色。
 */
const DARK_TECH = [
  // [图层 id 正则, 属性, 值]
  [/^background$/, 'background-color', '#0b1322'],
  [/^water$/, 'fill-color', '#050912'],
  [/^waterway/, 'line-color', '#0a1220'],
  [/^landcover_(ice|glacier)/, 'fill-color', '#0e1828'],
  [/^landcover_wood|^landuse_park/, 'fill-color', '#0f1b2b'],
  [/^landuse_residential/, 'fill-color', '#111c2e'],
  [/^aeroway-area/, 'fill-color', '#121d30'],
  [/^aeroway-(runway|taxiway)$/, 'line-color', '#1e2a40'],
  [/^highway_motorway_inner/, 'line-color', '#3a4a66'],
  [/^highway_motorway_(casing|subtle)/, 'line-color', '#1c2840'],
  [/^highway_major_(inner|subtle)/, 'line-color', '#26344d'],
  [/^highway_major_casing/, 'line-color', '#141e30'],
  [/^highway_minor|^highway_path/, 'line-color', '#18233a'],
  [/^railway(?!.*dash)/, 'line-color', '#1f2b42'],
  [/^railway.*dash/, 'line-color', '#0b1322'],
  [/^boundary_country/, 'line-color', '#5b6b85'],
  [/^boundary_state/, 'line-color', '#334563'],
  [/^place_(city|city_large|town)$/, 'text-color', '#a8b3c7'],
  [/^place_(village|suburb|other)$/, 'text-color', '#7c8aa3'],
  [/^place_(state|country)/, 'text-color', '#8391a8'],
  [/^place_/, 'text-halo-color', 'rgba(2,6,23,0.9)'],
  [/^water_name/, 'text-color', '#3d5170'],
  [/^water_name/, 'text-halo-color', 'rgba(2,6,23,0.6)'],
  [/^highway_name/, 'text-color', '#5d6b82'],
  [/^highway_name/, 'text-halo-color', '#0b1322'],
];

function tintDark(map, layers) {
  for (const l of layers) {
    for (const [re, prop, value] of DARK_TECH) {
      if (!re.test(l.id)) continue;
      try { map.setPaintProperty(l.id, prop, value); } catch { /* 属性不适用于该图层，忽略 */ }
    }
  }
}

/** 地名标注改为「中文 + 英文」双行（无中文名时保持原样） */
function localizeLabels(map, layers) {
  const zh = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh']];
  const hasZh = ['any', ['has', 'name:zh-Hans'], ['has', 'name:zh']];
  const latin = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']];
  let count = 0;
  for (const l of layers) {
    if (l.type !== 'symbol') continue;
    if (!/(place|country|state|province|city|town|village|continent|capital|label)/i.test(l.id)) continue;
    if (/road|street|highway|transport|poi|housenumber|shield|water/i.test(l.id)) continue;
    let original = l.layout?.['text-field'];
    if (!original) continue;
    if (typeof original === 'string') {
      const m = original.match(/^\{([^}]+)\}$/);
      if (!m) continue;
      original = ['get', m[1]];
    }
    if (!JSON.stringify(original).includes('name')) continue;
    try {
      map.setLayoutProperty(l.id, 'text-field', [
        'case', hasZh,
        ['format', zh, {}, '\n', {}, latin, { 'font-scale': 0.78 }],
        original,
      ]);
      count++;
    } catch (err) {
      console.debug('[底图] 无法本地化图层', l.id, err?.message);
    }
  }
  console.debug(`[底图] 已切换 ${count} 个地名图层为中文`);
}

/** 用底图自带的 building 图层生成 3D 体块 */
function add3DBuildings(map, layers, theme = 'dark') {
  if (map.getLayer('wh-buildings-3d')) return;
  const buildingLayers = layers.filter((l) => l['source-layer'] === 'building');
  const source = buildingLayers[0]?.source
    || Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
  if (!source) return;
  const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
  const height = ['coalesce', ['get', 'render_height'], ['get', 'height'], 8];
  const base = ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0];
  try {
    map.addLayer({
      id: 'wh-buildings-3d',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': theme === 'light'
          ? ['interpolate', ['linear'], height, 0, '#e2e8f0', 25, '#cbd5e1', 80, '#b4c0d3']
          : ['interpolate', ['linear'], height, 0, '#1b2638', 25, '#26354d', 80, '#33476a'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.2, height],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.2, base],
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-vertical-gradient': true,
      },
    }, firstSymbol);
    for (const l of buildingLayers) {
      if (l.type === 'fill') map.setLayoutProperty(l.id, 'visibility', 'none');
    }
  } catch (err) {
    console.warn('[底图] 3D 建筑不可用：', err?.message);
  }
}

function setupGlobe(map, theme = 'dark') {
  if (!CONFIG.USE_GLOBE) return;
  try {
    map.setProjection({ type: 'globe' });
  } catch (err) {
    console.debug('[底图] 当前版本不支持 globe 投影', err?.message);
    return;
  }
  const light = theme === 'light';
  try {
    map.setSky({
      'sky-color': light ? '#cfe3f7' : '#0b1630',
      'horizon-color': light ? '#eef4fb' : '#12304f',
      'fog-color': light ? '#f1f5f9' : '#050a14',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.9,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    });
  } catch { /* 可选效果 */ }
}
