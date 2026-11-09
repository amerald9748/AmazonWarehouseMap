"""
把 Excel 里的 纬度/经度 同步到 data/coordinates.json（已知坐标登记表），零依赖。

为什么需要：网站在 Excel 某行缺少坐标时，会按编码沿用登记表里的坐标。
所以当你直接用上游发来的新表（不含坐标）覆盖 data/*.xlsx 时，已登记的仓库照样能上图。
新出现的仓库只需在 Excel 里补一次坐标，再运行本脚本登记，以后就一直有效。

用法（在任意目录运行均可）：
    python scripts/sync-coordinates.py            # 同步并写回 coordinates.json
    python scripts/sync-coordinates.py --dry-run  # 只报告，不写文件
"""
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "coordinates.json"
SOURCES = [  # (Excel 文件, 登记表分区, 显示名)
    (ROOT / "data" / "warehouses.xlsx", "warehouses", "亚马逊仓点"),
    (ROOT / "data" / "internal-warehouses.xlsx", "internal", "自营仓"),
]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
norm = lambda s: re.sub(r"[\s_\-/\\()（）\[\]【】:：]", "", str(s or "")).lower()
CODE = {norm(a) for a in ["仓点编码", "仓库编码", "仓库代码", "仓点代码", "仓库编号", "Warehouse_Code", "Warehouse Code", "Code", "FC"]}
LAT = {norm(a) for a in ["纬度", "Latitude", "Lat"]}
LNG = {norm(a) for a in ["经度", "Longitude", "Lng", "Lon", "Long"]}


def read_rows(path):
    """返回每个工作表的 {行号: {列号: 值}}（列号从 0 开始）。"""
    z = zipfile.ZipFile(path)
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            strings.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = []
    for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS):
        target = rels[s.get("{%s}id" % NS["r"])].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = {}
        for c in ET.fromstring(z.read(target)).iter("{%s}c" % NS["m"]):
            m = re.match(r"([A-Z]+)(\d+)", c.get("r"))
            col = 0
            for ch in m.group(1):
                col = col * 26 + ord(ch) - 64
            v, t = c.find("m:v", NS), c.get("t")
            if t == "s" and v is not None:
                val = strings[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                val = v.text if v is not None else None
            if val not in (None, ""):
                rows.setdefault(int(m.group(2)), {})[col - 1] = val
        sheets.append((s.get("name"), rows))
    return sheets


def to_float(v, limit):
    try:
        n = float(str(v).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None
    return n if n != 0 and abs(n) <= limit else None


def extract(path):
    """找到含编码列的工作表，返回 {编码: (纬度, 经度) 或 None}。"""
    for name, rows in read_rows(path):
        for r in sorted(rows)[:30]:
            cols = {norm(v): c for c, v in rows[r].items()}
            code_col = next((cols[k] for k in cols if k in CODE), None)
            if code_col is None:
                continue
            lat_col = next((cols[k] for k in cols if k in LAT), None)
            lng_col = next((cols[k] for k in cols if k in LNG), None)
            out = {}
            for rr in sorted(rows):
                if rr <= r:
                    continue
                code = str(rows[rr].get(code_col, "")).strip().upper().replace(" ", "")
                if not code:
                    continue
                lat = to_float(rows[rr].get(lat_col), 90) if lat_col is not None else None
                lng = to_float(rows[rr].get(lng_col), 180) if lng_col is not None else None
                out[code] = (lat, lng) if lat is not None and lng is not None else None
            return name, out
    raise SystemExit(f"在 {path.name} 中找不到编码列")


def dump(registry):
    """保持「一个仓库一行」的可读格式。"""
    lines = ["{"]
    keys = list(registry)
    for i, key in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        val = registry[key]
        if key in ("warehouses", "internal"):
            lines.append(f'  "{key}": {{')
            codes = sorted(val)
            for j, code in enumerate(codes):
                e = val[code]
                inner = ", ".join(f'"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in e.items())
                lines.append(f'    "{code}": {{ {inner} }}' + ("," if j < len(codes) - 1 else ""))
            lines.append("  }" + comma)
        else:
            text = json.dumps(val, ensure_ascii=False, indent=2).replace("\n", "\n  ")
            lines.append(f'  "{key}": {text}{comma}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    dry = "--dry-run" in sys.argv
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    changed = False
    for path, section, label in SOURCES:
        if not path.exists():
            print(f"· 跳过 {label}：找不到 {path.relative_to(ROOT)}")
            continue
        sheet, rows = extract(path)
        known = registry.setdefault(section, {})
        added, updated, missing, inherited = [], [], [], []
        for code, coords in rows.items():
            if coords is None:
                (inherited if code in known else missing).append(code)
                continue
            lat, lng = round(coords[0], 6), round(coords[1], 6)
            old = known.get(code)
            if old is None:
                known[code] = {"lat": lat, "lng": lng, "precision": "manual"}
                added.append(code)
            elif abs(old["lat"] - lat) > 1e-6 or abs(old["lng"] - lng) > 1e-6:
                known[code] = {"lat": lat, "lng": lng, "precision": "manual"}
                updated.append(code)
        absent = sorted(set(known) - set(rows))
        print(f"\n{label}（{path.name} · 工作表「{sheet}」，{len(rows)} 行）")
        print(f"  新登记：{', '.join(added) or '无'}")
        print(f"  坐标更新：{', '.join(updated) or '无'}")
        print(f"  本表无坐标、沿用登记表：{', '.join(inherited) or '无'}")
        print(f"  ⚠ 本表无坐标且未登记（不会上图，请在 Excel 补充 纬度/经度）：{', '.join(missing) or '无'}")
        if absent:
            print(f"  登记表中有、但本表没有（保留不删）：{', '.join(absent)}")
        changed |= bool(added or updated)
    if changed and not dry:
        registry["updated"] = date.today().isoformat()
        REGISTRY.write_text(dump(registry), encoding="utf-8")
        print(f"\n已写入 {REGISTRY.relative_to(ROOT)}")
    elif changed:
        print("\n（--dry-run：未写入文件）")
    else:
        print("\n登记表已是最新，无需改动。")


if __name__ == "__main__":
    main()
