// Every header name the importers accept lives here, and only here.

export const FIELD_ALIASES = {
  itemCode: ['CF_ITEMID', 'item_code', 'รหัสสินค้า'],
  nameTh: ['CF_ITEMNAME', 'name_th', 'ชื่อสินค้า'],
  unitName: ['CF_UNITNAME', 'unit_name', 'หน่วย'],
  category: ['CF_ITEMGROUPL1_GROUPNAME', 'category', 'หมวดหมู่'],
  sellPrice: ['CF_TDUNITPRICE', 'sell_price', 'ราคาขาย'],
  onHand: ['on_hand', 'คงเหลือ'],
  lowStockManual: ['low_stock_level', 'จุดสั่งซื้อ'],
  supplier: ['supplier', 'ซัพพลายเออร์'],
  receiptNo: ['CF_TRANNO', 'receipt_no'],
  qty: ['CF_TDBASEQUANTITY'],
  sign: ['CF_FSTOCKMAIN'],
  posBalance: ['CC_BEG'],
  tranDate: ['TRANDATE'],
  tranDateThai: ['CF_TRANDATE'],
} as const;

export type FieldKey = keyof typeof FIELD_ALIASES;
export type HeaderMap = Partial<Record<FieldKey, string>>;

/** Map each app field to the actual header found in the file (first alias that matches). */
export function buildHeaderMap(headers: string[]): HeaderMap {
  const lower = new Map<string, string>();
  for (const h of headers) {
    const k = h.trim().toLowerCase();
    if (!lower.has(k)) lower.set(k, h);
  }
  const map: HeaderMap = {};
  for (const key of Object.keys(FIELD_ALIASES) as FieldKey[]) {
    for (const alias of FIELD_ALIASES[key]) {
      const hit = lower.get(alias.toLowerCase());
      if (hit !== undefined) {
        map[key] = hit;
        break;
      }
    }
  }
  return map;
}
