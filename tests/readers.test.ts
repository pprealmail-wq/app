import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readTable } from '../src/lib/csv/readTable';
import { detectKind, normalizePosTable } from '../src/lib/rules/pos';
import { planPosImport } from '../src/lib/rules/plan';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

for (const name of ['sample.xlsx', 'sample.xls']) {
  test(`reads ${name}: text codes, Thai text, dates, repeated headers`, async () => {
    const t = await readTable(fx(name));
    assert.equal(t.rows.length, 3);
    assert.ok(t.headers.includes('CF_ITEMID_2'), 'repeated header is renamed');
    assert.equal(t.rows[0].CF_ITEMID, '0001');
    assert.equal(t.rows[1].CF_ITEMID, '00123');
    assert.equal(t.rows[1].CF_ITEMNAME, 'แชมพูซันซิล*12 ชมพู');
    assert.equal(t.rows[0].TRANDATE, '2026-10-02T09:30:15');
    assert.equal(t.rows[1].CF_TDUNITPRICE, 1250.5);
    assert.equal(detectKind(t.headers).kind, 'pos');
    const p = normalizePosTable(t);
    const plan = planPosImport(p, new Set(), new Map(), { useOpeningFromPos: true });
    assert.equal(plan.receiptsNew.length, 2);
    assert.equal(plan.onHandAfter['0001'], 21);
    assert.equal(plan.onHandAfter['00123'], 8);
    assert.equal(plan.onHandAfter['8858587001789'], 40);
    assert.equal(plan.newProducts.find((n) => n.itemCode === '00123')?.category, 'ยาสระผม+โลชันทาผิว');
  });
}

for (const name of ['sample-utf8.csv', 'sample-874.csv']) {
  test(`reads ${name} (Thai text, leading zeros, Thai date fallback)`, async () => {
    const t = await readTable(fx(name));
    assert.equal(t.format, 'csv');
    assert.equal(t.rows.length, 3);
    assert.equal(t.rows[0].CF_ITEMID, '0001');
    assert.equal(t.rows[2].CF_ITEMNAME, 'สบู่อิงอร*24');
    const p = normalizePosTable(t);
    assert.equal(p.lines.length, 3);
    assert.equal(p.lines[0].occurredAt.slice(0, 10), '2026-10-02'); // from CF_TRANDATE (Buddhist year 2569)
  });
}

test('rejects unsupported and empty input with a clear error', async () => {
  await assert.rejects(() => readTable(new Uint8Array(0)), (e: { code?: string }) => e.code === 'empty');
  await assert.rejects(() => readTable(new TextEncoder().encode('<html><body>x</body></html>')), (e: { code?: string }) => e.code === 'unsupported');
  const k = detectKind(['foo', 'bar']);
  assert.equal(k.kind, 'unknown');
  assert.ok(k.missing.length > 0);
});

// Optional: run against the real customer export, which is NOT stored in this repository.
// STOCK_SAMPLE_XLS=/path/to/file.XLS STOCK_SAMPLE_CSV=/path/to/same-file.csv npm test
const real = process.env.STOCK_SAMPLE_XLS;
test('real customer file', { skip: !real || !existsSync(real) }, async () => {
  const t = await readTable(readFileSync(real as string));
  const p = normalizePosTable(t);
  const plan = planPosImport(p, new Set(), new Map(), { useOpeningFromPos: true });
  assert.equal(p.lines.length, 769);
  assert.equal(plan.receiptsNew.length, 83);
  assert.equal(plan.salesLines, 734);
  assert.equal(plan.receiveLines, 35);
  assert.equal(plan.newProducts.length, 472);
  assert.equal(new Set(plan.newProducts.map((n) => n.category)).size, 22);
  assert.equal(plan.held.length, 0);
  assert.equal(plan.mismatches.length, 0);
  assert.equal(Object.values(plan.onHandAfter).filter((v) => v < 0).length, 0);
  const again = planPosImport(p, new Set(plan.receiptsNew.map((r) => r.receiptNo)), new Map(), { useOpeningFromPos: true });
  assert.equal(again.receiptsNew.length, 0);
  assert.equal(again.movements.length, 0);
  const csv = process.env.STOCK_SAMPLE_CSV;
  if (csv && existsSync(csv)) {
    const p2 = normalizePosTable(await readTable(readFileSync(csv)));
    const plan2 = planPosImport(p2, new Set(), new Map(), { useOpeningFromPos: true });
    assert.deepEqual(plan2.onHandAfter, plan.onHandAfter); // CSV and XLS give identical stock
  }
});
