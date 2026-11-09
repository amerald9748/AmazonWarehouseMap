/**
 * 示例数据（仅当 data/warehouses.xlsx 无法加载时启用）
 * 刻意使用规格中的英文列名 + 字符串坐标 + 空行，演示解析器的列映射与容错能力。
 * 数值为演示用途，非真实运营数据。
 */
import { parseRows } from './parser.js';

const SAMPLE_ROWS = [
  ['Amazon Warehouses — SAMPLE DATA'],
  ['Warehouse_Code', 'City', 'State', 'Latitude', 'Longitude', 'Type', 'Square_Footage', 'Active_Capacity_Level', 'Region'],
  ['JFK8', 'Staten Island', 'NY', '40.6197', '-74.1773', 'Fulfillment Center', '855,000', 'High', 'US-East'],
  ['ONT8', 'Moreno Valley', 'CA', ' 33.8797 ', '-117.2526', 'Fulfillment Center', '1,000,000', 'Medium', 'US-West'],
  [null, null, null, null, null, null, null, null, null], // 空行：会被过滤
  ['MDW2', 'Joliet', 'IL', '41.4669°N', '88.0476°W', 'Sort Center', '750000', 'Low', 'US-Central'],
  ['YYZ4', 'Brampton', 'ON', 43.61827, -79.79094, 'Fulfillment Center', null, 'High', 'CA-East'],
];

export function getSampleDataset() {
  const dataset = parseRows(SAMPLE_ROWS, { sourceName: 'sample-data.js', sheetName: 'SAMPLE' });
  dataset.meta.title = '示例数据（Excel 未加载）';
  dataset.meta.isSample = true;
  return dataset;
}
