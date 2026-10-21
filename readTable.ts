// Reads .XLS, .xlsx and .csv into a simple table: headers + one object per row.
import { readBiffFirstSheet, type Cell } from './biff';
import { decodeText, parseCsv } from './csvText';
import { isOle2, readOle2Stream } from './ole2';
import { isZip, readXlsxFirstSheet } from './xlsx';

export type { Cell };

export interface Table {
  headers: string[];
  rows: Record<string, Cell>[];
  sheetName: string;
  format: 'xls' | 'xlsx' | 'csv';
}

export type FileReadErrorCode = 'unsupported' | 'empty' | 'corrupt';

export class FileReadError extends Error {
  constructor(public code: FileReadErrorCode, message: string) {
    super(message);
  }
}

const isBlank = (c: Cell): boolean => c === null || c === '' || (typeof c === 'string' && c.trim() === '');

function toTable(grid: Cell[][], sheetName: string, format: Table['format']): Table {
  const headerIdx = grid.findIndex((r) => r.filter((c) => !isBlank(c)).length >= 2);
  if (headerIdx < 0) throw new FileReadError('empty', 'no header row');
  const used = new Map<string, number>();
  const headers = grid[headerIdx].map((c, i) => {
    const base = isBlank(c) ? `col_${i + 1}` : String(c).trim();
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`; // repeated header names become NAME, NAME_2, ...
  });
  const rows: Record<string, Cell>[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.every(isBlank)) continue;
    const o: Record<string, Cell> = {};
    headers.forEach((h, k) => {
      const v = r[k] ?? null;
      o[h] = typeof v === 'string' ? v : v;
    });
    rows.push(o);
  }
  return { headers, rows, sheetName, format };
}

export async function readTable(input: ArrayBuffer | Uint8Array): Promise<Table> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length === 0) throw new FileReadError('empty', 'empty file');
  try {
    if (isOle2(buf)) {
      const stream = readOle2Stream(buf, ['Workbook', 'Book']);
      if (!stream) throw new FileReadError('unsupported', 'no workbook stream');
      const s = readBiffFirstSheet(stream);
      return toTable(s.rows, s.name, 'xls');
    }
    if (isZip(buf)) {
      const s = await readXlsxFirstSheet(buf);
      return toTable(s.rows, s.name, 'xlsx');
    }
    const head = new TextDecoder().decode(buf.subarray(0, 64)).trimStart().toLowerCase();
    if (head.startsWith('<')) throw new FileReadError('unsupported', 'html or xml file');
    return toTable(parseCsv(decodeText(buf)), 'csv', 'csv');
  } catch (e) {
    if (e instanceof FileReadError) throw e;
    throw new FileReadError('corrupt', e instanceof Error ? e.message : 'cannot read file');
  }
}
