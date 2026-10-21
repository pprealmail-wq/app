import { buildHeaderMap, FIELD_ALIASES, type HeaderMap } from '../csv/aliases';
import type { Cell, Table } from '../csv/readTable';
import { ISO_DATETIME, parseThaiDate } from './dates';
import type { HeldLine, HeldReason, PosLine, ReceiptKind } from './types';

export type FileKind = 'pos' | 'productList' | 'unknown';

/** Receipt number prefix -> what the receipt means. Anything else is held, never applied. */
export const RECEIPT_KIND: Record<string, ReceiptKind> = { ORCM: 'sale', IRNM: 'receive' };

export const receiptPrefix = (no: string): string => /^[A-Za-z]+/.exec(no)?.[0].toUpperCase() ?? '';

export function detectKind(headers: string[]): { kind: FileKind; missing: string[] } {
  const m = buildHeaderMap(headers);
  if (m.receiptNo && m.sign && m.itemCode && m.qty) return { kind: 'pos', missing: [] };
  if (m.itemCode && m.nameTh) return { kind: 'productList', missing: [] };
  const need: (keyof typeof FIELD_ALIASES)[] = ['itemCode', 'receiptNo', 'qty', 'sign'];
  return { kind: 'unknown', missing: need.filter((k) => !m[k]).map((k) => FIELD_ALIASES[k][0]) };
}

export const text = (v: Cell | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v).trim();
};

export function parseNumber(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s]/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Remove the shop's group prefix so categories read naturally, e.g. 'สินค้ายกลัง*สบู่' -> 'สบู่'. */
export const cleanCategory = (s: string): string | null => {
  const t = s.replace(/^สินค้ายกลัง\*/, '').trim();
  return t === '' ? null : t;
};

function readDate(v: Cell | undefined, thai: Cell | undefined): string | null {
  const a = text(v);
  if (ISO_DATETIME.test(a)) return a; // a real date/time cell, already wall-clock
  const fromThai = parseThaiDate(text(thai));
  if (fromThai) {
    const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(a);
    return t ? `${fromThai.slice(0, 11)}${t[1].padStart(2, '0')}:${t[2]}:${(t[3] ?? '00').padStart(2, '0')}` : fromThai;
  }
  return parseThaiDate(a);
}

export interface PosParse {
  lines: PosLine[];
  held: HeldLine[];
  totalRows: number;
  headerMap: HeaderMap;
}

export function normalizePosTable(table: Table): PosParse {
  const map = buildHeaderMap(table.headers);
  const get = (row: Record<string, Cell>, k: keyof HeaderMap): Cell | undefined => (map[k] ? row[map[k] as string] : undefined);
  const lines: PosLine[] = [];
  const held: HeldLine[] = [];

  table.rows.forEach((row, i) => {
    const rowNo = i + 2; // header is row 1
    const receiptNo = text(get(row, 'receiptNo'));
    const itemCode = text(get(row, 'itemCode'));
    const nameTh = text(get(row, 'nameTh'));
    const rawQty = text(get(row, 'qty'));
    const hold = (reason: HeldReason) => held.push({ rowNo, receiptNo, itemCode, nameTh, qty: rawQty, reason });

    if (receiptNo === '') return hold('missing_receipt');
    if (itemCode === '') return hold('missing_code');
    const qty = parseNumber(get(row, 'qty'));
    if (qty === null || qty <= 0 || !Number.isInteger(qty)) return hold('bad_quantity');
    const signN = parseNumber(get(row, 'sign'));
    if (signN !== 1 && signN !== -1) return hold('sign_mismatch');
    const occurredAt = readDate(get(row, 'tranDate'), get(row, 'tranDateThai'));
    if (!occurredAt) return hold('missing_date');

    const price = parseNumber(get(row, 'sellPrice'));
    lines.push({
      seq: i,
      rowNo,
      receiptNo,
      itemCode,
      nameTh: nameTh || itemCode,
      unitName: text(get(row, 'unitName')),
      category: cleanCategory(text(get(row, 'category'))),
      qty,
      sign: signN,
      posOpening: parseNumber(get(row, 'posBalance')),
      unitPrice: price !== null && price > 0 ? price : null,
      occurredAt,
    });
  });
  return { lines, held, totalRows: table.rows.length, headerMap: map };
}
