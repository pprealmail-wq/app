// Reader for .xlsx files: a zip archive of XML parts. Uses the browser's (and Node's) built-in inflate.
import type { Cell } from './biff';
import { isDateFormat, serialToIso } from './numfmt';

interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  localOffset: number;
}

export function isZip(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function listZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    out.push({
      name: td.decode(buf.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true),
      csize: dv.getUint32(p + 20, true),
      localOffset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function extract(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new Error('unsupported zip compression');
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, g: string) => {
    if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[g];
  });

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]) : undefined;
};

const textOf = (xml: string): string => {
  let out = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decodeEntities(m[1] ?? '');
  return out;
};

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function readXlsxFirstSheet(buf: Uint8Array): Promise<{ name: string; rows: Cell[][] }> {
  const entries = listZip(buf);
  const get = async (n: string): Promise<string | null> => {
    const e = entries.find((x) => x.name === n);
    return e ? extract(buf, e) : null;
  };

  const workbook = (await get('xl/workbook.xml')) ?? '';
  const rels = (await get('xl/_rels/workbook.xml.rels')) ?? '';
  const sheetTag = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '';
  const sheetName = attr(sheetTag, 'name') ?? 'Sheet1';
  const rid = attr(sheetTag, 'r:id');
  let target = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attr(m[0], 'Id') === rid) target = attr(m[0], 'Target') ?? target;
  }
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const date1904 = /date1904="(1|true)"/.test(workbook);

  const sstXml = await get('xl/sharedStrings.xml');
  const sst: string[] = [];
  if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));

  const styles = (await get('xl/styles.xml')) ?? '';
  const customFmt = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = attr(m[0], 'numFmtId');
    const code = attr(m[0], 'formatCode');
    if (id !== undefined && code !== undefined) customFmt.set(Number(id), code);
  }
  const xfIsDate: boolean[] = [];
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  for (const m of cellXfs.matchAll(/<xf\b[^>]*?\/?>/g)) {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    xfIsDate.push(isDateFormat(id, customFmt.get(id)));
  }

  const sheetXml = await get(sheetPath);
  if (sheetXml === null) throw new Error('worksheet not found');
  const cells = new Map<number, Map<number, Cell>>();
  let maxCol = -1;
  for (const m of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const tag = m[1];
    const body = m[2] ?? '';
    const ref = attr(tag, 'r');
    if (!ref) continue;
    const row = Number(ref.replace(/[A-Za-z]/g, '')) - 1;
    const col = colIndex(ref);
    const t = attr(tag, 't');
    const s = attr(tag, 's');
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let val: Cell = null;
    if (t === 'inlineStr') val = textOf(body);
    else if (v !== undefined) {
      const raw = decodeEntities(v);
      if (t === 's') val = sst[Number(raw)] ?? '';
      else if (t === 'str') val = raw;
      else if (t === 'b') val = raw === '1';
      else if (t === 'e') val = null;
      else {
        const n = Number(raw);
        val = s !== undefined && xfIsDate[Number(s)] ? serialToIso(n, date1904) : n;
      }
    }
    if (val === null) continue;
    let r = cells.get(row);
    if (!r) cells.set(row, (r = new Map()));
    r.set(col, val);
    if (col > maxCol) maxCol = col;
  }
  const rows: Cell[][] = [];
  for (const rid of [...cells.keys()].sort((a, b) => a - b)) {
    const arr: Cell[] = new Array(maxCol + 1).fill(null);
    for (const [c, v] of cells.get(rid)!) arr[c] = v;
    rows.push(arr);
  }
  return { name: sheetName, rows };
}
