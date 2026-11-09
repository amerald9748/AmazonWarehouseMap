/**
 * Excel → 仓库记录 → GeoJSON
 * ------------------------------------------------------------------
 * 支持两类工作簿，自动识别：
 *   amazon   亚马逊仓点表（仓点编码 / 热门常规 / 仓库功能类型 …）
 *   internal 自营仓目录（Warehouse Code / Address / Operating Hours / Status / Dock …）
 *
 * - 自动定位表头行（中文 / 英文列名均可，见 *_FIELDS）
 * - 字符串坐标 → 数字（"51.19"、"51,19"、"51.19°N"、"113.98 W"）
 * - 坐标缺失时按编码沿用已知坐标（data/coordinates.json + 已加载的数据），Excel 中的坐标始终优先
 * - 过滤空行 / 无编码行 / 重复编码；仍无坐标的仓库保留在列表但不上图
 * - 未识别的列原样保留到 record.extra；联系人等其他工作表不会被读取
 */
import * as XLSX from 'xlsx';

const TAG = '%c[仓点数据]';
const TAG_STYLE = 'color:#38bdf8;font-weight:600';
const log = (...a) => console.log(TAG, TAG_STYLE, ...a);
const warn = (...a) => console.warn(TAG, TAG_STYLE, ...a);
const debug = (...a) => console.debug(TAG, TAG_STYLE, ...a);

const LAT = ['纬度', 'Latitude', 'Lat'];
const LNG = ['经度', 'Longitude', 'Lng', 'Lon', 'Long'];

/** 亚马逊仓点表列名别名（大小写、空格、下划线、括号、斜杠均忽略） */
export const AMAZON_FIELDS = {
  code: ['仓点编码', '仓库编码', '仓库代码', '仓点代码', 'Warehouse_Code', 'Warehouse Code', 'Code', 'FC', 'FC Code', 'Facility'],
  city: ['城市/地区', '城市', 'City'],
  postal: ['邮编', '邮政编码', 'Postal Code', 'Postal_Code', 'Postcode', 'Zip', 'Zip Code'],
  state: ['省份缩写', '省份', '省/州', '州', 'State', 'Province'],
  region: ['加拿大地区', '地区', '区域', 'Region'],
  heat: ['热门/常规', '热度', 'Heat', 'Demand'],
  type: ['仓库功能类型', '仓库类型', '功能类型', '类型', 'Type', 'Warehouse Type'],
  remote: ['是否偏远仓', '偏远仓', '偏远', 'Remote'],
  notes: ['备注', '说明', 'Notes', 'Note', 'Remarks', 'Remark'],
  lat: LAT,
  lng: LNG,
  sqft: ['仓库面积', '面积', '面积(平方英尺)', 'Square_Footage', 'Square Footage', 'Sq Ft', 'SqFt', 'Area'],
  capacity: ['实时库容', '库容等级', '库容', 'Active_Capacity_Level', 'Active Capacity Level', 'Capacity', 'Capacity Level'],
  employees: ['员工人数', '员工数', 'Employees', 'Employee_Count', 'Headcount'],
  inbound: ['入库状态', '入库运输状态', 'Inbound', 'Inbound_Status', 'Inbound Status'],
  outbound: ['出库状态', '出库运输状态', 'Outbound', 'Outbound_Status', 'Outbound Status'],
};
/** 兼容旧名称 */
export const FIELD_ALIASES = AMAZON_FIELDS;

/** 自营仓目录列名别名 */
export const INTERNAL_FIELDS = {
  code: ['Warehouse Code', 'Warehouse_Code', '仓库代码', '仓库编码', '仓库编号', 'Code'],
  city: ['City', '城市', '城市/地区'],
  name: ['Chinese / Alternate Name', 'Chinese Name', 'Alternate Name', '中文名', '中文名称', '仓库名称', '名称', 'Name'],
  address: ['Address', '地址', '仓库地址'],
  hours: ['Operating Hours', 'Business Hours', 'Hours', '营业时间', '工作时间', '营业时段'],
  status: ['Status', '状态', '运营状态'],
  dock: ['Dock', 'Docks', 'Dock Doors', '月台', '卸货口'],
  notes: ['Notes', 'Note', 'Remarks', '备注', '说明'],
  lat: LAT,
  lng: LNG,
};

/** 用来判断工作簿类型的「特征列」 */
const KIND_SIGNATURE = {
  amazon: ['heat', 'type', 'remote', 'state', 'postal'],
  internal: ['address', 'hours', 'dock', 'name', 'status'],
};
const KIND_FIELDS = { amazon: AMAZON_FIELDS, internal: INTERNAL_FIELDS };
export const KIND_LABEL = { amazon: '亚马逊仓点', internal: '自营仓' };

const PROVINCES = {
  AB: '阿尔伯塔省', BC: '不列颠哥伦比亚省', MB: '马尼托巴省', NB: '新不伦瑞克省', NL: '纽芬兰与拉布拉多省',
  NS: '新斯科舍省', ON: '安大略省', PE: '爱德华王子岛省', QC: '魁北克省', SK: '萨斯喀彻温省',
  NT: '西北地区', NU: '努纳武特地区', YT: '育空地区',
  NY: '纽约州', CA: '加利福尼亚州', IL: '伊利诺伊州', NJ: '新泽西州', TX: '得克萨斯州', WA: '华盛顿州',
};

/** 城市英文名：用于搜索（输入 Brampton 也能找到 布兰普顿）以及详情页副标题 */
export const CITY_EN = {
  卡尔加里: 'Calgary', 尼斯库: 'Nisku', 艾奇逊: 'Acheson', 埃德蒙顿: 'Edmonton', 温哥华: 'Vancouver',
  贝尔维尔: 'Belleville', 密西沙加: 'Mississauga', 布兰普顿: 'Brampton', 博尔顿: 'Bolton',
  斯卡伯勒: 'Scarborough', 纳文: 'Navan', 尼皮恩: 'Nepean', 渥太华: 'Ottawa', 阿贾克斯: 'Ajax',
  霍普山: 'Mount Hope', 圣托马斯: 'St. Thomas', 米尔顿: 'Milton', 温尼伯: 'Winnipeg', 多伦多: 'Toronto',
  蒙特利尔: 'Montréal', 卡利登: 'Caledon', 汉密尔顿: 'Hamilton',
};

// ------------------------------------------------------------------ public API

/**
 * @param {string} url
 * @param {{ known?: { amazon?: Map, internal?: Map }, expectKind?: 'amazon'|'internal' }} [opts]
 */
export async function loadWorkbookFromUrl(url, opts = {}) {
  log(`开始加载 ${url} …`);
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`无法请求 ${url}（${location.protocol === 'file:' ? '请通过本地服务器打开，而不是直接双击 HTML' : err.message}）`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  const dataset = parseWorkbook(await res.arrayBuffer(), { ...opts, sourceName: decodeURIComponent(url.split('/').pop()) });
  log(`加载完成：${dataset.records.length} 个${KIND_LABEL[dataset.kind]}，用时 ${Math.round(performance.now() - t0)} ms`, dataset.stats);
  return dataset;
}

export async function parseWorkbookFile(file, opts = {}) {
  log(`解析本地文件 ${file.name}（${(file.size / 1024).toFixed(1)} KB）…`);
  const dataset = parseWorkbook(await file.arrayBuffer(), { ...opts, sourceName: file.name });
  log(`解析完成：${dataset.records.length} 个${KIND_LABEL[dataset.kind]}`, dataset.stats);
  return dataset;
}

/** 解析整个工作簿：自动挑选「类型 + 工作表」组合中最匹配的一个 */
export function parseWorkbook(buf, { sourceName = 'workbook.xlsx', known = {}, expectKind = null } = {}) {
  let wb;
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true });
  } catch (err) {
    throw new Error(`无法读取 Excel：${err.message}`);
  }
  let best = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    for (const kind of expectKind ? [expectKind] : ['amazon', 'internal']) {
      const header = findHeaderRow(rows, kind);
      if (!header) continue;
      const rank = header.signature * 100 + header.score;
      if (!best || rank > best.rank) best = { name, rows, header, kind, rank, rowOffset: XLSX.utils.decode_range(ws['!ref']).s.r };
    }
  }
  if (!best) throw new Error('未找到可识别的表头（需要「仓点编码」或「Warehouse Code」列）');
  const skipped = wb.SheetNames.filter((n) => n !== best.name);
  log(`识别为「${KIND_LABEL[best.kind]}」：工作表「${best.name}」，表头位于第 ${best.header.index + best.rowOffset + 1} 行`
    + (skipped.length ? `（未读取其他工作表：${skipped.join('、')}）` : ''),
  Object.fromEntries(Object.entries(best.header.columns).map(([k, c]) => [k, best.rows[best.header.index][c]])));

  const dataset = parseRows(best.rows, {
    kind: best.kind,
    header: best.header,
    rowOffset: best.rowOffset,
    sourceName,
    sheetName: best.name,
    known: known[best.kind],
  });
  const modified = wb.Props?.ModifiedDate;
  dataset.meta.updatedAt = dateFromFileName(sourceName) || (modified instanceof Date && !isNaN(modified) ? modified : null);
  return dataset;
}

/**
 * 解析二维数组（第一维为行）。可单独用于 JSON / CSV 数据源。
 * @param {Array<Array<any>>} rows
 * @param {{ kind?: 'amazon'|'internal', known?: Map<string, {lat:number,lng:number,precision?:string,from?:string}> }} opts
 */
export function parseRows(rows, { kind = 'amazon', header = findHeaderRow(rows, kind), rowOffset = 0, sourceName = 'data', sheetName = '', known = null } = {}) {
  if (!header) throw new Error('未找到表头行（需要至少包含编码列）');
  const { columns, extras, index: headerIndex } = header;
  const stats = { rows: 0, parsed: 0, blank: 0, noCode: 0, duplicate: 0, noCoords: 0, inheritedCoords: 0, fixedPostal: 0 };
  const records = [];
  const seen = new Set();
  const build = kind === 'internal' ? buildInternal : buildAmazon;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const excelRow = i + rowOffset + 1;
    if (row.every(isBlank)) { stats.blank++; continue; }
    stats.rows++;

    const code = normCode(cell(row, columns.code));
    if (!code) {
      stats.noCode++;
      warn(`第 ${excelRow} 行没有编码，已跳过`, row);
      continue;
    }
    if (seen.has(code)) {
      stats.duplicate++;
      warn(`第 ${excelRow} 行编码 ${code} 重复，已跳过`);
      continue;
    }
    seen.add(code);

    const coords = resolveCoords(code, cell(row, columns.lat), cell(row, columns.lng), columns.lat != null, known);
    if (coords.coordSource === 'inherited') {
      stats.inheritedCoords++;
      debug(`${code}：本表无坐标，沿用已知坐标（${coords.coordFrom}）`);
    } else if (!coords.hasCoords) {
      stats.noCoords++;
      warn(`${code}（第 ${excelRow} 行）没有坐标，也不在已知坐标中 → 仅在列表中显示，不上图`, {
        lat: cell(row, columns.lat), lng: cell(row, columns.lng),
      });
    }

    const record = build(row, columns, code, stats);
    Object.assign(record, coords, {
      kind,
      extra: extras.map(({ col, label }) => ({ label, value: formatCell(row[col]) })).filter((e) => e.value !== ''),
      excelRow,
    });
    records.push(record);
    stats.parsed++;
  }

  linkColocated(records, kind);

  const preamble = rows.slice(0, headerIndex).flat().filter((v) => typeof v === 'string' && v.trim());
  const notesText = preamble.find((t) => /[①②③④⑤]|标准[:：]/.test(t)) || '';
  const meta = {
    kind,
    title: preamble.find((t) => t !== notesText && t.length > 4) || '',
    notesText,
    definitions: parseDefinitions(notesText),
    sourceName,
    sheetName,
    columns: Object.fromEntries(Object.entries(columns).map(([k, c]) => [k, String(rows[headerIndex][c] ?? '')])),
    updatedAt: null,
  };

  if (stats.inheritedCoords) log(`${stats.inheritedCoords} 个${KIND_LABEL[kind]}沿用了已知坐标`);
  if (!records.length) warn('没有解析到任何记录，请检查 Excel 内容');
  return { kind, records, meta, stats };
}

// ------------------------------------------------------------------ record builders

function buildAmazon(row, columns, code, stats) {
  const postal = normPostal(cell(row, columns.postal));
  if (postal.fixed) {
    stats.fixedPostal++;
    warn(`${code}：邮编 "${postal.raw}" 已规范为 "${postal.value}"`);
  }
  const city = str(cell(row, columns.city));
  const heat = normHeat(cell(row, columns.heat));
  const type = normType(cell(row, columns.type));
  const remote = normRemote(cell(row, columns.remote));
  const notes = str(cell(row, columns.notes));
  const colocated = notes ? [...notes.matchAll(/与\s*([A-Z0-9]{3,5})\s*共仓/gi)].map((m) => m[1].toUpperCase()) : [];
  return {
    code,
    city,
    cityEn: city ? CITY_EN[city] || '' : '',
    postal: postal.value,
    state: normState(cell(row, columns.state)),
    region: str(cell(row, columns.region)),
    heat: heat.key,
    heatLabel: heat.label,
    type: type.key,
    typeLabel: type.label,
    remote: remote.value,
    remoteLabel: remote.label,
    notes,
    isNew: !!notes && /新开|新仓|new/i.test(notes),
    colocatedWith: colocated,
    metrics: {
      sqft: parseNumber(cell(row, columns.sqft)),
      capacity: normCapacity(cell(row, columns.capacity)),
      employees: parseNumber(cell(row, columns.employees)),
      inbound: str(cell(row, columns.inbound)),
      outbound: str(cell(row, columns.outbound)),
    },
    metricColumns: {
      sqft: columns.sqft != null, capacity: columns.capacity != null, employees: columns.employees != null,
      inbound: columns.inbound != null, outbound: columns.outbound != null,
    },
  };
}

function buildInternal(row, columns, code) {
  const address = str(cell(row, columns.address));
  // "1140 Tristar Dr, Mississauga, ON L5T 1H9" → 省份 ON、邮编 L5T 1H9、城市 Mississauga
  const m = address.match(/,\s*([^,]+?),\s*([A-Z]{2})\s+([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\s*$/i);
  const statusRaw = str(cell(row, columns.status));
  const isActive = !statusRaw || /^(active|open|运营中|正常|启用)$/i.test(statusRaw);
  return {
    code,
    city: str(cell(row, columns.city)),
    cityEn: '',
    name: str(cell(row, columns.name)),
    address,
    addrCity: m ? m[1].trim() : '',
    postal: m ? `${m[3]} ${m[4]}`.toUpperCase() : '',
    state: m ? { abbr: m[2].toUpperCase(), name: PROVINCES[m[2].toUpperCase()] || m[2].toUpperCase(), raw: m[2] } : { abbr: '', name: '', raw: '' },
    hours: str(cell(row, columns.hours)),
    status: statusRaw,
    statusLabel: isActive ? '运营中' : statusRaw,
    isActive,
    dock: str(cell(row, columns.dock)),
    notes: str(cell(row, columns.notes)),
    colocatedWith: [],
  };
}

/** 共址：亚马逊按备注「与XXX共仓」，自营仓按相同地址（忽略单元号） */
function linkColocated(records, kind) {
  const byCode = new Map(records.map((r) => [r.code, r]));
  if (kind === 'internal') {
    const key = (a) => a.toLowerCase().replace(/^(unit|suite|#)\s*[\w-]+,\s*/i, '').replace(/[\s.,]/g, '');
    const groups = new Map();
    for (const r of records) {
      if (!r.address) continue;
      const k = key(r.address);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const g of groups.values()) {
      if (g.length > 1) for (const r of g) r.colocatedWith = g.filter((o) => o !== r).map((o) => o.code);
    }
    return;
  }
  for (const r of records) {
    for (const other of r.colocatedWith) {
      const o = byCode.get(other);
      if (o && !o.colocatedWith.includes(r.code)) o.colocatedWith.push(r.code);
    }
  }
}

/** Excel 坐标 → 校验 → 缺失时按编码沿用已知坐标 */
function resolveCoords(code, rawLat, rawLng, hasLatColumn, known) {
  let lat = parseCoordinate(rawLat, 'lat');
  let lng = parseCoordinate(rawLng, 'lng');
  if ((lat === null || lng === null) && hasLatColumn) {
    // 经纬度写反时自动纠正（例如 纬度=-113.98, 经度=51.19）
    const swapLat = parseCoordinate(rawLng, 'lat');
    const swapLng = parseCoordinate(rawLat, 'lng');
    if (lat === null && swapLat !== null && swapLng !== null) {
      lat = swapLat; lng = swapLng;
      warn(`${code}：经纬度疑似写反，已自动交换`);
    }
  }
  const k = known?.get(code);
  if (lat !== null && lng !== null) {
    const same = k && Math.abs(k.lat - lat) < 2e-5 && Math.abs(k.lng - lng) < 2e-5;
    return { lat, lng, hasCoords: true, coordSource: 'excel', coordPrecision: same ? k.precision || null : null, coordFrom: '' };
  }
  if (k) {
    return { lat: k.lat, lng: k.lng, hasCoords: true, coordSource: 'inherited', coordPrecision: k.precision || null, coordFrom: k.from || '已知坐标' };
  }
  return { lat: null, lng: null, hasCoords: false, coordSource: null, coordPrecision: null, coordFrom: '' };
}

/** 读取 data/coordinates.json 的某个分区 → Map */
export function registryToMap(section, from = 'coordinates.json') {
  const map = new Map();
  for (const [code, v] of Object.entries(section || {})) {
    const lat = parseCoordinate(v?.lat, 'lat');
    const lng = parseCoordinate(v?.lng, 'lng');
    if (lat !== null && lng !== null) map.set(normCode(code), { lat, lng, precision: v.precision || null, from });
  }
  return map;
}

/** 为同一坐标的多个仓库计算错开的显示位置（写入 record.displayLngLat） */
export function assignDisplayPositions(records, radius = 100) {
  const groups = new Map();
  for (const r of records) {
    if (!r.hasCoords) continue;
    const key = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.code.localeCompare(b.code));
    group.forEach((r, i) => {
      let [lng, lat] = [r.lng, r.lat];
      if (group.length > 1) {
        // 圆周错开（两个时为一西一东，避免弹窗遮住相邻标记）
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / group.length;
        lat += (radius * Math.cos(angle)) / 111320;
        lng += (radius * Math.sin(angle)) / (111320 * Math.cos((r.lat * Math.PI) / 180));
      }
      r.displayLngLat = [lng, lat];
    });
  }
}

/** 亚马逊记录 → GeoJSON FeatureCollection（用于聚合） */
export function toGeoJSON(records) {
  assignDisplayPositions(records);
  const features = records.filter((r) => r.hasCoords).map((r, id) => ({
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: r.displayLngLat },
    properties: {
      code: r.code,
      heat: r.heat || 'unknown',
      type: r.type || 'unknown',
      hot: r.heat === 'hot' ? 1 : 0,
      oversize: r.type === 'oversize' ? 1 : 0,
      remote: r.remote ? 1 : 0,
      isNew: r.isNew ? 1 : 0,
    },
  }));
  return { type: 'FeatureCollection', features };
}

// ------------------------------------------------------------------ header detection

const normHeader = (v) => String(v ?? '').toLowerCase().replace(/[\s_\-/\\()（）[\]【】:：]/g, '');
const ALIAS_INDEX = Object.fromEntries(Object.entries(KIND_FIELDS).map(([kind, fields]) =>
  [kind, Object.entries(fields).map(([field, aliases]) => [field, aliases.map(normHeader)])]));

function matchHeader(label, kind) {
  const h = normHeader(label);
  if (!h) return null;
  const index = ALIAS_INDEX[kind];
  for (const [field, aliases] of index) if (aliases.includes(h)) return field;
  // 模糊匹配：取匹配到的最长别名（避免 "capacity" 被 "city" 抢走）
  let best = null;
  for (const [field, aliases] of index) {
    for (const a of aliases) {
      const hit = a.length >= 2 && (h.startsWith(a) || (a.length >= 3 && h.includes(a)));
      if (hit && (!best || a.length > best.len)) best = { field, len: a.length };
    }
  }
  return best ? best.field : null;
}

export function findHeaderRow(rows, kind = 'amazon') {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const columns = {};
    const extras = [];
    row.forEach((v, col) => {
      if (isBlank(v)) return;
      const field = matchHeader(v, kind);
      if (field && columns[field] == null) columns[field] = col;
      else extras.push({ col, label: String(v).trim() });
    });
    const score = Object.keys(columns).length;
    const signature = KIND_SIGNATURE[kind].filter((f) => columns[f] != null).length;
    if (columns.code != null && score >= 2) return { index: i, columns, extras, score, signature };
  }
  return null;
}

// ------------------------------------------------------------------ value normalizers

function cell(row, col) { return col == null ? null : row[col]; }
function isBlank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
function str(v) {
  if (isBlank(v)) return '';
  if (v instanceof Date) return formatDate(v);
  return String(v).trim();
}
function formatCell(v) {
  if (isBlank(v)) return '';
  if (v instanceof Date) return formatDate(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v).trim();
}
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normCode(v) { return str(v).toUpperCase().replace(/\s+/g, ''); }

/** 坐标：数字或字符串 → 数值；越界/无法解析返回 null */
export function parseCoordinate(v, axis) {
  if (isBlank(v)) return null;
  let n;
  if (typeof v === 'number') n = v;
  else {
    let s = String(v).trim().toUpperCase().replace(/[°º˚]/g, ' ').replace(/，/g, ',');
    let sign = 1;
    if (/[SW]/.test(s)) sign = -1;
    s = s.replace(/[NSEW]/g, '').trim();
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.'); // 51,19 → 51.19
    s = s.replace(/\s+/g, '');
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s) * sign;
  }
  if (!Number.isFinite(n)) return null;
  const max = axis === 'lat' ? 90 : 180;
  if (Math.abs(n) > max || n === 0) return null;
  return n;
}

/** 加拿大邮编 A1A 1A1：数字位上的 O/I/L 纠正为 0/1；美国 ZIP 原样保留 */
function normPostal(v) {
  const raw = str(v);
  if (!raw) return { value: '', raw, fixed: false };
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  if (compact.length === 6 && /^[A-Z]/.test(compact)) {
    const chars = compact.split('');
    for (const i of [1, 3, 5]) chars[i] = { O: '0', I: '1', L: '1' }[chars[i]] ?? chars[i];
    for (const i of [0, 2, 4]) chars[i] = { 0: 'O', 1: 'I' }[chars[i]] ?? chars[i];
    const value = `${chars.slice(0, 3).join('')} ${chars.slice(3).join('')}`;
    if (/^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(value)) {
      const before = `${compact.slice(0, 3)} ${compact.slice(3)}`;
      return { value, raw, fixed: value !== before };
    }
  }
  return { value: raw.toUpperCase(), raw, fixed: false };
}

function normState(v) {
  const raw = str(v);
  if (!raw) return { abbr: '', name: '', raw };
  const m = raw.match(/^([A-Za-z]{2})\s*[-–—_·\s]\s*(.+)$/);
  if (m) return { abbr: m[1].toUpperCase(), name: m[2].trim(), raw };
  if (/^[A-Za-z]{2}$/.test(raw)) return { abbr: raw.toUpperCase(), name: PROVINCES[raw.toUpperCase()] || raw.toUpperCase(), raw };
  const hit = Object.entries(PROVINCES).find(([, zh]) => zh === raw || zh.replace(/[省州]$/, '') === raw);
  return hit ? { abbr: hit[0], name: hit[1], raw } : { abbr: raw.slice(0, 3).toUpperCase(), name: raw, raw };
}

function normHeat(v) {
  const label = str(v);
  if (!label) return { key: null, label: '' };
  if (/热门|爆|hot|high/i.test(label)) return { key: 'hot', label };
  if (/常规|普通|regular|normal/i.test(label)) return { key: 'regular', label };
  return { key: 'other', label };
}

function normType(v) {
  const label = str(v);
  if (!label) return { key: null, label: '' };
  if (/大件|超大|oversize|non.?sort|large|bulky/i.test(label)) return { key: 'oversize', label };
  if (/卫星|satellite/i.test(label)) return { key: 'satellite', label };
  if (/分拣|sort/i.test(label)) return { key: 'sort', label: /sort/i.test(label) ? '分拣中心' : label };
  if (/履约|配送中心|fulfil/i.test(label)) return { key: 'fulfillment', label: /fulfil/i.test(label) ? '履约中心' : label };
  if (/标准|standard|sortable/i.test(label)) return { key: 'standard', label };
  return { key: 'other', label };
}

function normRemote(v) {
  const label = str(v);
  if (!label) return { value: false, label: '' };
  if (/^(否|不是|非|no|n|false|0)$/i.test(label)) return { value: false, label };
  return { value: /偏远|是|yes|^y$|true|^1$|remote/i.test(label), label };
}

function normCapacity(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') {
    const pct = v <= 1 ? v * 100 : v;
    return { level: pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low', pct: Math.round(pct), label: `${Math.round(pct)}%` };
  }
  const label = String(v).trim();
  const pctMatch = label.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pctMatch) return normCapacity(Number(pctMatch[1]));
  if (/high|高|紧张|爆/i.test(label)) return { level: 'high', pct: null, label };
  if (/med|中|一般/i.test(label)) return { level: 'medium', pct: null, label };
  if (/low|低|宽松|空/i.test(label)) return { level: 'low', pct: null, label };
  return { level: null, pct: null, label };
}

function parseNumber(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[,，\s]/g, '');
  let mult = 1;
  if (/万$/.test(s)) { mult = 10000; s = s.slice(0, -1); }
  s = s.replace(/[^\d.+-]/g, '');
  const n = Number(s) * mult;
  return s && Number.isFinite(n) ? n : null;
}

function parseDefinitions(text) {
  const defs = {};
  if (!text) return defs;
  for (const m of text.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩]\s*([^：:\n]+)[：:]\s*([^\n]+)/g)) {
    defs[m[1].trim()] = m[2].trim().replace(/[；;。]+$/, '');
  }
  return defs;
}

function dateFromFileName(name) {
  const m = String(name).match(/(20\d{2})[.\-_年](\d{1,2})[.\-_月](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}
