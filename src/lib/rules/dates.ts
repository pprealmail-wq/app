// Store wall-clock time (Asia/Bangkok). Times are kept as 'YYYY-MM-DDTHH:mm:ss' strings,
// never converted between time zones, so results are identical on every device.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isoDateTime(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mi)}:${pad(ss)}`;
}

export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** '02/10/2569' (dd/mm/yyyy, Buddhist year when above 2400) -> '2026-10-02T00:00:00'. */
export function parseThaiDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return isoDateTime(y, mo, d, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}

export const dateOnly = (iso: string): string => iso.slice(0, 10);

const toUtcMs = (d: string): number => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};

export function addDays(d: string, n: number): string {
  const dt = new Date(toUtcMs(d) + n * 86400000);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);
}

/** Current store wall-clock time as 'YYYY-MM-DDTHH:mm:ss' (Asia/Bangkok). */
export function nowBangkok(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return isoDateTime(g('year'), g('month'), g('day'), g('hour'), g('minute'), g('second'));
}
