// Reader for the BIFF8 worksheet stream inside a legacy .XLS file.
// Supports text (shared strings), numbers, RK numbers, formulas with cached results, and dates.
import { isDateFormat, serialToIso } from './numfmt';

export type Cell = string | number | boolean | null;

interface Rec {
  id: number;
  pos: number; // offset of the record header in the stream
  chunks: Uint8Array[]; // the record's data followed by any CONTINUE records
}

const REC = {
  BOF: 0x0809, EOF: 0x000a, CONTINUE: 0x003c, BOUNDSHEET: 0x0085, SST: 0x00fc, LABELSST: 0x00fd,
  LABEL: 0x0204, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, FORMULA: 0x0006, STRING: 0x0207,
  BOOLERR: 0x0205, XF: 0x00e0, FORMAT: 0x041e, DATEMODE: 0x0022,
};

function parseRecords(s: Uint8Array): Rec[] {
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const out: Rec[] = [];
  let p = 0;
  while (p + 4 <= s.length) {
    const id = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    const data = s.subarray(p + 4, Math.min(p + 4 + len, s.length));
    if (id === REC.CONTINUE && out.length > 0) out[out.length - 1].chunks.push(data);
    else out.push({ id, pos: p, chunks: [data] });
    p += 4 + len;
  }
  return out;
}

const joined = (r: Rec): Uint8Array => {
  if (r.chunks.length === 1) return r.chunks[0];
  const total = r.chunks.reduce((n, c) => n + c.length, 0);
  const o = new Uint8Array(total);
  let off = 0;
  for (const c of r.chunks) {
    o.set(c, off);
    off += c.length;
  }
  return o;
};

// Reads values across record chunks (needed for the shared string table, which Excel splits freely).
class ChunkReader {
  private ci = 0;
  private off = 0;
  constructor(private chunks: Uint8Array[]) {}
  private cur(): Uint8Array {
    return this.chunks[this.ci] ?? new Uint8Array(0);
  }
  private advance(): boolean {
    if (this.ci + 1 >= this.chunks.length) return false;
    this.ci++;
    this.off = 0;
    return true;
  }
  eof(): boolean {
    while (this.off >= this.cur().length) if (!this.advance()) return true;
    return false;
  }
  u8(): number {
    if (this.eof()) return 0;
    return this.cur()[this.off++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number): void {
    while (n > 0) {
      if (this.eof()) return;
      const take = Math.min(n, this.cur().length - this.off);
      this.off += take;
      n -= take;
    }
  }
  string(): string {
    const cch = this.u16();
    const flags = this.u8();
    let wide = (flags & 1) === 1;
    const cRun = flags & 8 ? this.u16() : 0;
    const cbExt = flags & 4 ? this.u32() : 0;
    let remaining = cch;
    const parts: string[] = [];
    while (remaining > 0) {
      if (this.off >= this.cur().length) {
        if (!this.advance()) break;
        wide = (this.cur()[0] & 1) === 1; // a continued string restarts with its own flags byte
        this.off = 1;
      }
      const cur = this.cur();
      const per = wide ? 2 : 1;
      const take = Math.min(remaining, Math.floor((cur.length - this.off) / per));
      if (take <= 0) {
        if (!this.advance()) break;
        wide = (this.cur()[0] & 1) === 1;
        this.off = 1;
        continue;
      }
      const codes: number[] = new Array(take);
      for (let i = 0; i < take; i++) {
        codes[i] = wide ? cur[this.off + 2 * i] | (cur[this.off + 2 * i + 1] << 8) : cur[this.off + i];
      }
      parts.push(String.fromCharCode(...codes));
      this.off += take * per;
      remaining -= take;
    }
    this.skip(cRun * 4);
    this.skip(cbExt);
    return parts.join('');
  }
}

function decodeRk(rk: number): number {
  let v: number;
  if (rk & 2) {
    v = rk >> 2; // signed 30-bit integer
  } else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    v = b.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

export interface SheetData {
  name: string;
  rows: Cell[][];
}

export function readBiffFirstSheet(stream: Uint8Array): SheetData {
  const recs = parseRecords(stream);

  // ---- workbook globals ----
  let date1904 = false;
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  const sheets: { pos: number; type: number; hidden: number; name: string }[] = [];
  let sst: string[] = [];
  let depth = 0;
  let firstSheetStart = recs.length;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.id === REC.BOF) {
      depth++;
      if (depth > 1) {
        firstSheetStart = i;
        break;
      }
      continue;
    }
    if (r.id === REC.EOF) {
      depth--;
      if (depth <= 0) {
        firstSheetStart = i + 1;
        break;
      }
      continue;
    }
    const d = joined(r);
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (r.id === REC.DATEMODE) date1904 = dv.getUint16(0, true) === 1;
    else if (r.id === REC.XF) xfFormat.push(dv.getUint16(2, true));
    else if (r.id === REC.FORMAT) formats.set(dv.getUint16(0, true), new ChunkReader([d.subarray(2)]).string());
    else if (r.id === REC.BOUNDSHEET) {
      const rd = new ChunkReader([d.subarray(6)]);
      const cch = rd.u8();
      const flags = rd.u8();
      let name = '';
      for (let k = 0; k < cch; k++) name += String.fromCharCode(flags & 1 ? rd.u16() : rd.u8());
      sheets.push({ pos: dv.getUint32(0, true), hidden: d[4], type: d[5], name });
    } else if (r.id === REC.SST) {
      const rd = new ChunkReader(r.chunks);
      rd.u32();
      const unique = rd.u32();
      sst = new Array(unique);
      for (let k = 0; k < unique; k++) sst[k] = rd.string();
    }
  }
  void firstSheetStart;

  const target = sheets.find((s) => s.type === 0 && s.hidden === 0) ?? sheets.find((s) => s.type === 0);
  if (!target) throw new Error('no worksheet found');
  const startIdx = recs.findIndex((r) => r.pos === target.pos);
  if (startIdx < 0) throw new Error('worksheet not found in stream');

  const isDateXf = (xf: number): boolean => {
    const f = xfFormat[xf];
    return f !== undefined && isDateFormat(f, formats.get(f));
  };

  // ---- worksheet cells ----
  const cells = new Map<number, Map<number, Cell>>();
  let maxCol = -1;
  const put = (row: number, col: number, v: Cell) => {
    let r = cells.get(row);
    if (!r) cells.set(row, (r = new Map()));
    r.set(col, v);
    if (col > maxCol) maxCol = col;
  };
  const num = (row: number, col: number, xf: number, v: number) => put(row, col, isDateXf(xf) ? serialToIso(v, date1904) : v);

  let pendingFormula: { row: number; col: number } | null = null;
  depth = 0;
  for (let i = startIdx; i < recs.length; i++) {
    const r = recs[i];
    if (r.id === REC.BOF) {
      depth++;
      continue;
    }
    if (r.id === REC.EOF) {
      depth--;
      if (depth <= 0) break;
      continue;
    }
    if (depth > 1) continue; // ignore embedded substreams
    const d = joined(r);
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    switch (r.id) {
      case REC.LABELSST: {
        const idx = dv.getUint32(6, true);
        put(dv.getUint16(0, true), dv.getUint16(2, true), sst[idx] ?? '');
        break;
      }
      case REC.LABEL:
        put(dv.getUint16(0, true), dv.getUint16(2, true), new ChunkReader([d.subarray(6)]).string());
        break;
      case REC.NUMBER:
        num(dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint16(4, true), dv.getFloat64(6, true));
        break;
      case REC.RK:
        num(dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint16(4, true), decodeRk(dv.getUint32(6, true)));
        break;
      case REC.MULRK: {
        const row = dv.getUint16(0, true);
        const first = dv.getUint16(2, true);
        const last = dv.getUint16(d.length - 2, true);
        for (let c = first, o = 4; c <= last && o + 6 <= d.length - 2; c++, o += 6) {
          num(row, c, dv.getUint16(o, true), decodeRk(dv.getUint32(o + 2, true)));
        }
        break;
      }
      case REC.BOOLERR:
        put(dv.getUint16(0, true), dv.getUint16(2, true), d[7] === 1 ? null : d[6] === 1);
        break;
      case REC.FORMULA: {
        const row = dv.getUint16(0, true);
        const col = dv.getUint16(2, true);
        if (dv.getUint16(12, true) === 0xffff) {
          const t = d[6];
          if (t === 0) pendingFormula = { row, col };
          else if (t === 1) put(row, col, d[8] === 1);
          else put(row, col, null);
        } else {
          num(row, col, dv.getUint16(4, true), dv.getFloat64(6, true));
        }
        break;
      }
      case REC.STRING:
        if (pendingFormula) {
          put(pendingFormula.row, pendingFormula.col, new ChunkReader(r.chunks).string());
          pendingFormula = null;
        }
        break;
      default:
        break;
    }
  }

  const rowIds = [...cells.keys()].sort((a, b) => a - b);
  const rows: Cell[][] = [];
  for (const rid of rowIds) {
    const m = cells.get(rid)!;
    const arr: Cell[] = new Array(maxCol + 1).fill(null);
    for (const [c, v] of m) arr[c] = v;
    rows.push(arr);
  }
  return { name: target.name, rows };
}
