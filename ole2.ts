// Minimal reader for OLE2 / Compound File Binary containers (the wrapper around legacy .XLS files).

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffa; // ids at or above this are special markers (free, end of chain, FAT, DIFAT)

export function isOle2(buf: Uint8Array): boolean {
  return buf.length > 8 && MAGIC.every((b, i) => buf[i] === b);
}

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

export function readOle2Stream(buf: Uint8Array, names: string[]): Uint8Array | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  const sectorSize = 1 << u16(30);
  const miniSize = 1 << u16(32);
  const dirStart = u32(48);
  const miniCutoff = u32(56);
  const miniFatStart = u32(60);
  const difatStart = u32(68);
  const numDifat = u32(72);
  const secOff = (s: number) => (s + 1) * sectorSize;

  // File allocation table, located through the DIFAT.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const v = u32(76 + 4 * i);
    if (v < END) fatSectors.push(v);
  }
  let d = difatStart;
  for (let n = 0; n < numDifat && d < END; n++) {
    const off = secOff(d);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const v = u32(off + 4 * i);
      if (v < END) fatSectors.push(v);
    }
    d = u32(off + sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const off = secOff(s);
    if (off + sectorSize > buf.length) continue;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(off + 4 * i));
  }

  const chain = (start: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let s = start;
    while (s < END && !seen.has(s) && s < fat.length) {
      seen.add(s);
      out.push(s);
      s = fat[s];
    }
    return out;
  };

  const readChain = (start: number): Uint8Array => {
    const secs = chain(start);
    const out = new Uint8Array(secs.length * sectorSize);
    secs.forEach((s, i) => {
      const off = secOff(s);
      out.set(buf.subarray(off, Math.min(off + sectorSize, buf.length)), i * sectorSize);
    });
    return out;
  };

  // Directory.
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: DirEntry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 64, true);
    let name = '';
    for (let i = 0; i + 2 <= Math.max(0, nameLen - 2); i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
    entries.push({ name, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const wanted = names.map((n) => n.toLowerCase());
  const entry = entries.find((e) => e.type === 2 && wanted.includes(e.name.toLowerCase()));
  if (!entry) return null;

  if (entry.size >= miniCutoff) return readChain(entry.start).subarray(0, entry.size);

  // Small streams live in the mini stream (the root entry's data), addressed through the mini FAT.
  const root = entries[0];
  const miniStream = readChain(root.start);
  const miniFatBytes = readChain(miniFatStart);
  const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const out = new Uint8Array(entry.size);
  let s = entry.start;
  let pos = 0;
  const seen = new Set<number>();
  while (s < END && pos < entry.size && !seen.has(s)) {
    seen.add(s);
    const chunk = miniStream.subarray(s * miniSize, (s + 1) * miniSize);
    out.set(chunk.subarray(0, Math.min(chunk.length, entry.size - pos)), pos);
    pos += miniSize;
    s = s * 4 + 4 <= miniFatBytes.length ? mdv.getUint32(s * 4, true) : END;
  }
  return out;
}
