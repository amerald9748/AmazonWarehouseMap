/**
 * 全局配置 · Global configuration
 * ------------------------------------------------------------------
 * 部署前唯一需要修改的文件。 This is the only file you need to edit before deploying.
 */
export const CONFIG = {
  /**
   * MapTiler API Key —— 免费申请: https://cloud.maptiler.com/account/keys/
   * 留空时自动使用免 Key 的 OpenFreeMap 深色底图，应用依然可以完整运行。
   *
   * ⚠️ 本仓库是公开的：Key 会出现在前端代码中（地图类 Key 本就是公开的）。
   *    请在 MapTiler 后台为该 Key 设置 “Allowed HTTP origins”，例如:
   *      https://<your-github-user>.github.io
   *      http://localhost:5173
   */
  MAPTILER_API_KEY: '',

  /** MapTiler 底图样式 ID：深色 / 浅色主题各一个（dataviz-dark、streets-v2-dark、dataviz-light、streets-v2 …） */
  MAPTILER_STYLE: 'dataviz-dark',
  MAPTILER_STYLE_LIGHT: 'dataviz-light',

  /** 无 Key 或 MapTiler 加载失败时使用的免 Key 底图（深色 / 浅色） */
  FALLBACK_STYLE_URL: 'https://tiles.openfreemap.org/styles/dark',
  FALLBACK_STYLE_URL_LIGHT: 'https://tiles.openfreemap.org/styles/positron',

  /** 亚马逊仓点数据：与 index.html 同目录层级的 Excel 文件（相对路径，兼容 GitHub Pages 子路径） */
  DATA_URL: 'data/warehouses.xlsx',

  /** 自营仓目录（已去除联系人工作表的公开版本） */
  INTERNAL_DATA_URL: 'data/internal-warehouses.xlsx',

  /** 已知坐标登记表：Excel 缺少 纬度/经度 时按编码沿用 */
  COORDS_URL: 'data/coordinates.json',

  /** 地图标注语言：'zh' 显示中文地名（附英文），'' 保持底图默认 */
  MAP_LABEL_LANGUAGE: 'zh',

  /** 打开页面时的地球视角，加载完成后自动飞入全部仓点 */
  INITIAL_VIEW: { center: [-96, 52], zoom: 1.6 },
  USE_GLOBE: true,

  /** 点聚合：半径(px) 与最大聚合缩放级别（超过该级别全部展开） */
  CLUSTER: { radius: 46, maxZoom: 12 },

  /**
   * 选中仓点时的相机动画。
   * zoom 15.6 + pitch 55 才能看到 3D 建筑体块（建筑数据从 z13 开始出现）；
   * 若更想要城市级视角，可改为 zoom: 11.5, pitch: 45。
   */
  FLY_TO: { zoom: 15.6, pitch: 55, bearing: -18, speed: 0.9, curve: 1.42 },

  /** 3D 建筑挤出 */
  BUILDINGS_3D: true,
};
