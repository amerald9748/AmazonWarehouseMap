# 亚马逊加拿大仓点地图 · Amazon Canada Warehouse Map

Interactive, fully static logistics dashboard for Amazon Canada FBA warehouses and our own (自营) warehouses. 
Access at: https://amerald9748.github.io/AmazonWarehouseMap/

The data comes straight from two Excel workbooks, [`data/warehouses.xlsx`](data/warehouses.xlsx) (Amazon) and [`data/internal-warehouses.xlsx`](data/internal-warehouses.xlsx) (internal), parsed in the browser with SheetJS.

- **Map**: MapLibre GL JS 6 (globe intro → fly-in), pulse-animated HTML markers, clustering with hot-ratio rings, 3D building extrusions, bilingual (中文 + English) place labels. Internal warehouses are emerald diamonds and never clustered. They're hidden at first and appear once someone opens the 自营仓 tab, opens an internal warehouse (e.g. from a nearby list or a `#TOR-1140` link), or turns on the legend switch.
- **Light / dark mode**: sun/moon button in the panel header. The basemap switches too, and the choice is remembered per browser. **Light is the default**; change `DEFAULT_THEME` in the inline script in `index.html` head.
- **Panel**: glassmorphic sidebar with an **亚马逊仓点 | 自营仓** switch, search (code / name / city / province / address / postal, Chinese or English), KPI quick filters (热门 / 大件 / 偏远, or 运营中 / 状态提醒), province chips, grouped list, keyboard navigation
- **Details**: 概览 (Excel fields + the workbook's own definitions + coordinate source), 运营指标 (Amazon only: capacity / area / headcount / inbound / outbound, as placeholders until those columns exist), 周边仓点 (Amazon warehouses list the nearest 3 internal warehouses first, then the nearest Amazon sites; internal warehouses list the nearest Amazon sites first)
- **Popups**: code, city and every Excel field (labelled with the original header text), plus a 查看详情 button
- **Import**: drag an `.xlsx` onto the page (or use 导入 Excel) to preview a new file locally. Nothing is uploaded.
- **Deep links**: `…/#YYZ4` opens a warehouse directly

No build step, no backend: plain HTML + ES modules + CDN libraries.

## Run locally

```bash
python scripts/dev-server.py
```

Open http://localhost:5173. The dev server is a no-cache wrapper around `http.server`, so edits show on refresh.
Double-clicking `index.html` will **not** work, because browsers block ES modules and `fetch()` on `file://`.

## Updating the data

Coordinates are resolved in this order: the row's own **纬度/经度** in the Excel, then the known-coordinates registry [`data/coordinates.json`](data/coordinates.json) by warehouse code. Rows with neither still appear in the list (tagged 无坐标) but not on the map.

Typical monthly update:

1. Overwrite `data/warehouses.xlsx` with the new upstream file (rename it). Coordinate columns are optional.
2. Run `python scripts/dev-server.py` and check the list. Known codes are mapped automatically; only brand-new codes show 无坐标.
3. For each new code, add 纬度/经度 in the Excel, then run:
   ```bash
   python scripts/sync-coordinates.py
   ```
   This copies new or changed coordinates into `coordinates.json`, so they survive the next overwrite. `--dry-run` only reports.
4. Commit and push. GitHub Pages redeploys automatically.

The same applies to `data/internal-warehouses.xlsx` (internal directory: Warehouse Code, Chinese / Alternate Name, Address, Operating Hours, Status, Dock, Notes).
**Never commit the original `warehouse_directory.xlsx`:** its Contacts sheet holds staff names and phone numbers. The committed copy has that sheet removed. The app only ever reads the warehouse sheet, even if a file containing Contacts is dragged onto the page.
A Status other than `Active` (e.g. 十一月底正式弃用) shows as an amber warning badge.

Dragging any `.xlsx` onto the page previews it locally. The type (Amazon vs internal) is detected from the headers.

The parser finds the header row automatically (title/notes rows above it are fine) and matches columns by name, in Chinese or English:

| Field | Accepted column names (examples) |
|---|---|
| Code (required) | 仓点编码, Warehouse_Code, Code, FC |
| City | 城市/地区, City |
| Province/State | 省份缩写, 省份, State, Province (`AB-阿尔伯塔省`, `AB` and `Alberta` all work) |
| Latitude / Longitude | 纬度 / 经度, Latitude / Longitude, Lat / Lng (`51.19`, `"51,19"`, `51.19°N`, `113.98 W`) |
| Postal code | 邮编, Postal Code, Zip (letter-O typos like `L1S OA1` are auto-fixed) |
| Hot / regular | 热门/常规 |
| Function type | 仓库功能类型, Type (标准仓 / 大件仓 / 卫星仓 / Fulfillment / Sort) |
| Remote | 是否偏远仓, Remote |
| Notes | 备注, Notes (`与YVR2共仓` links co-located sites; `26年新开` shows a NEW tag) |
| Metrics (optional) | 实时库容 / Active_Capacity_Level, 仓库面积 / Square_Footage, 员工人数 / Employees, 入库状态 / Inbound, 出库状态 / Outbound |

Any other column is kept and shown verbatim in the popup and the detail view.
The numbered definitions in the workbook's notes row (①热门仓：… ⑤大件仓：…) become tooltips and detail-card descriptions.
Load status, skipped rows and auto-fixes are logged to the browser console under `[仓点数据]`.

If `data/warehouses.xlsx` can't be loaded, the app falls back to built-in sample data (`js/data/sample-data.js`: JFK8, ONT8, MDW2, YYZ4) and says so in the header.

## Configuration: [`js/config.js`](js/config.js)

| Key | Purpose |
|---|---|
| `MAPTILER_API_KEY` | Empty → keyless OpenFreeMap dark basemap (restyled to match the UI). Set a key to use MapTiler; if MapTiler fails (e.g. 403), the app falls back automatically. |
| `MAPTILER_STYLE` / `MAPTILER_STYLE_LIGHT` | MapTiler style per theme, e.g. `dataviz-dark` / `dataviz-light` |
| `FALLBACK_STYLE_URL` / `_LIGHT` | Keyless OpenFreeMap styles (`dark` / `positron`) |
| `DATA_URL`, `INTERNAL_DATA_URL`, `COORDS_URL` | Amazon workbook, internal workbook, coordinate registry |
| `FLY_TO` | Camera for a selected warehouse. Default `zoom 15.6 / pitch 55`, so the 3D building is visible (buildings start at z13). Use `zoom 11.5 / pitch 45` for a city-level view. |
| `CLUSTER` | Cluster radius and the zoom at which all clusters break apart |
| `USE_GLOBE`, `BUILDINGS_3D`, `MAP_LABEL_LANGUAGE` | Visual toggles |

> **MapTiler key on a public repo:** map keys are always visible to the browser. In the MapTiler dashboard, restrict the key with **Allowed HTTP origins** (e.g. `https://<user>.github.io` and `http://localhost:5173`).

## Deploy (GitHub Pages)

Repository → **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
The site is served from `https://<user>.github.io/<repo>/`. All paths are relative, so the sub-path works as-is. `.nojekyll` is included.
Vercel / Netlify also work with zero config (framework preset "Other", no build command, output = repository root).

## Project structure

```
index.html              Layout, CDN imports (import map pins MapLibre 6.16.0 + SheetJS 0.20.3)
css/app.css             Markers, animations, glass styling, MapLibre overrides
js/config.js            ← the only file you normally edit
js/main.js              State, filtering, selection, panel/map wiring
js/data/parser.js       Excel → records → GeoJSON (header detection, coordinate parsing, validation)
js/data/sample-data.js  Fallback sample rows (English headers)
js/map/map-view.js      MapLibre map, clustering, HTML markers, popup, camera
js/map/basemap.js       Style selection/fallback, label localization, 3D buildings, globe
js/ui/*.js              Sidebar list, detail tabs, badges, legend, toasts, helpers
css/theme-light.css     Light-mode overrides
data/warehouses.xlsx            Amazon warehouses
data/internal-warehouses.xlsx   Internal warehouses (Contacts sheet removed)
data/coordinates.json           Known coordinates by code (fallback)
scripts/dev-server.py           Local no-cache static server
scripts/sync-coordinates.py     Excel 纬度/经度 → coordinates.json
```

## Coordinates in the current data

- 21 of 25 Amazon warehouses use building-level coordinates matched from OpenStreetMap (address and postal code cross-checked).
- XCAB, XYY4, XYY3 and YDC5 are not mapped in OSM yet, so they use postal-code centroids (accurate to roughly a block). Refine them in the Excel when exact addresses are known.
- All 10 internal warehouses are geocoded from their street addresses at building level. CAL-5505 and BESTAR share an address, so their pins are spread slightly apart.
- The detail view's coordinate card shows each coordinate's source and precision.

Map data © OpenStreetMap contributors, basemap © OpenFreeMap / OpenMapTiles.
