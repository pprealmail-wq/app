import { buildHeaderMap, type HeaderMap } from '../csv/aliases';
import type { Cell, Table } from '../csv/readTable';
import { cleanCategory, parseNumber, text } from './pos';

export interface ProductListRow {
  rowNo: number;
  itemCode: string;
  nameTh: string;
  unitName: string;
  category: string | null;
  supplier: string | null;
  sellPrice: number | null;
  onHand: number | null;
  lowStockManual: number | null;
}

export interface ProductListParse {
  rows: ProductListRow[];
  invalid: { rowNo: number; reason: 'missing_code' | 'missing_name' }[];
  duplicates: number;
}

export function parseProductListTable(table: Table): ProductListParse {
  const map: HeaderMap = buildHeaderMap(table.headers);
  const get = (row: Record<string, Cell>, k: keyof HeaderMap): Cell | undefined => (map[k] ? row[map[k] as string] : undefined);
  const byCode = new Map<string, ProductListRow>();
  const invalid: ProductListParse['invalid'] = [];
  let duplicates = 0;
  table.rows.forEach((row, i) => {
    const rowNo = i + 2;
    const itemCode = text(get(row, 'itemCode'));
    const nameTh = text(get(row, 'nameTh'));
    if (itemCode === '') return void invalid.push({ rowNo, reason: 'missing_code' });
    if (nameTh === '') return void invalid.push({ rowNo, reason: 'missing_name' });
    const price = parseNumber(get(row, 'sellPrice'));
    const onHand = parseNumber(get(row, 'onHand'));
    const low = parseNumber(get(row, 'lowStockManual'));
    if (byCode.has(itemCode)) duplicates++;
    byCode.set(itemCode, {
      rowNo,
      itemCode,
      nameTh,
      unitName: text(get(row, 'unitName')),
      category: cleanCategory(text(get(row, 'category'))),
      supplier: text(get(row, 'supplier')) || null,
      sellPrice: price !== null && price > 0 ? price : null,
      onHand: onHand !== null && Number.isInteger(onHand) ? onHand : null,
      lowStockManual: low !== null && Number.isInteger(low) && low >= 0 ? low : null,
    });
  });
  return { rows: [...byCode.values()], invalid, duplicates };
}

export interface ExistingProductFields {
  itemCode: string;
  nameTh: string;
  unitName: string;
  category: string | null;
  supplier: string | null;
  sellPrice: number | null;
  lowStockManual: number | null;
}

export type ProductChanges = Partial<Omit<ExistingProductFields, 'itemCode'>>;

export interface ProductListPlan {
  toCreate: ProductListRow[];
  toUpdate: { itemCode: string; nameTh: string; changes: ProductChanges }[];
  unchanged: number;
  invalid: ProductListParse['invalid'];
  duplicates: number;
}

/** New codes are created (with opening stock). Existing codes only get the fields the file actually fills in. */
export function planProductList(parse: ProductListParse, existing: ReadonlyMap<string, ExistingProductFields>): ProductListPlan {
  const toCreate: ProductListRow[] = [];
  const toUpdate: ProductListPlan['toUpdate'] = [];
  let unchanged = 0;
  for (const r of parse.rows) {
    const cur = existing.get(r.itemCode);
    if (!cur) {
      toCreate.push(r);
      continue;
    }
    const changes: ProductChanges = {};
    if (r.nameTh !== cur.nameTh) changes.nameTh = r.nameTh;
    if (r.unitName !== '' && r.unitName !== cur.unitName) changes.unitName = r.unitName;
    if (r.category !== null && r.category !== cur.category) changes.category = r.category;
    if (r.supplier !== null && r.supplier !== cur.supplier) changes.supplier = r.supplier;
    if (r.sellPrice !== null && r.sellPrice !== cur.sellPrice) changes.sellPrice = r.sellPrice;
    if (r.lowStockManual !== null && r.lowStockManual !== cur.lowStockManual) changes.lowStockManual = r.lowStockManual;
    if (Object.keys(changes).length > 0) toUpdate.push({ itemCode: r.itemCode, nameTh: r.nameTh, changes });
    else unchanged++;
  }
  return { toCreate, toUpdate, unchanged, invalid: parse.invalid, duplicates: parse.duplicates };
}
