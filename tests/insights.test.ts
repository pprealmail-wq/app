import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInsights } from '../src/lib/rules/insights';
import { DEFAULT_SETTINGS, type Movement, type Product, type Receipt } from '../src/lib/rules/types';
import { LocalRepo } from '../src/lib/repo/localRepo';
import { MemoryKV } from '../src/lib/repo/kv';

const prod = (id: string, onHand: number, extra: Partial<Product> = {}): Product => ({
  id, itemCode: id, nameTh: id, unitName: 'ลัง', category: 'x', supplier: null, sellPrice: null, lowStockManual: null,
  onHand, lastSaleAt: null, lastMovementAt: null, source: 'pos_import', isActive: true, ...extra,
});
const sale = (productId: string, qty: number, day: string): Movement => ({
  id: `${productId}${day}`, productId, type: 'sale', quantity: -qty, source: 'pos_import', importId: null, receiptNo: null, lineNo: null,
  posOpening: null, unitPrice: null, reason: null, occurredAt: `${day}T10:00:00`, createdBy: 'o', createdAt: '',
});
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const rcpts = (n: number): Receipt[] => days(n).map((d, i) => ({ receiptNo: `R${i}`, kind: 'sale', receiptDate: d, lineCount: 1, importId: 'i' }));

test('7 days of history: reorder point, low stock, urgent and suggested order', () => {
  // 6 cases per day for 7 days
  const mv = days(7).map((d) => sale('A', 6, d));
  const r = computeInsights([prod('A', 25), prod('B', 3, { lowStockManual: null })], mv, rcpts(7), DEFAULT_SETTINGS);
  const a = r.items.find((i) => i.product.id === 'A')!;
  assert.equal(r.enoughHistory, true);
  assert.equal(a.avg, 6);
  assert.equal(a.reorderPoint, 30);
  assert.equal(a.low, true);
  assert.equal(a.urgent, false);
  assert.equal(a.suggested, Math.ceil(6 * 9) - 25);
});

test('5 days of history: no automatic level and no suggestion, but a manual level still works', () => {
  const mv = days(5).map((d) => sale('A', 6, d));
  const r = computeInsights([prod('A', 2), prod('M', 2, { lowStockManual: 10 })], mv, rcpts(5), DEFAULT_SETTINGS);
  const a = r.items.find((i) => i.product.id === 'A')!;
  const m = r.items.find((i) => i.product.id === 'M')!;
  assert.equal(r.enoughHistory, false);
  assert.equal(a.reorderPoint, null);
  assert.equal(a.suggested, 0);
  assert.equal(a.urgent, true); // 2 on hand < 6 per day
  assert.equal(m.low, true);
});

test('negative stock is flagged for a recount', () => {
  const r = computeInsights([prod('A', -3)], [], rcpts(2), DEFAULT_SETTINGS);
  assert.equal(r.items[0].check, true);
});

test('count and write-off change stock, are audited, and staff may do them', async () => {
  const repo = new LocalRepo(new MemoryKV(), () => '2026-10-14T09:00:00');
  await repo.init();
  await repo.login('owner', '1111');
  const parse = { lines: [{ seq: 0, rowNo: 2, receiptNo: 'ORCM1', itemCode: '1', nameTh: 'a', unitName: 'ลัง', category: null, qty: 2, sign: -1 as const, posOpening: 10, unitPrice: null, occurredAt: '2026-10-02T10:00:00' }], held: [] };
  await repo.applyPos(parse, { useOpeningFromPos: true }, 'f');
  const id = repo.products()[0].id;
  assert.equal(repo.products()[0].onHand, 8);
  repo.logout();
  await repo.login('staff', '2222');
  assert.equal(await repo.recordCount(id, 5), -3);
  assert.equal(repo.products()[0].onHand, 5);
  await repo.recordWriteOff(id, 1, 'damaged');
  assert.equal(repo.products()[0].onHand, 4);
  await assert.rejects(() => repo.recordCount(id, -1));
  await assert.rejects(() => repo.recordWriteOff(id, 0, 'lost'));
  await assert.rejects(() => repo.updateSettings({ historyDays: 7 })); // owner only
});

test('owner can change settings; bad values are rejected', async () => {
  const repo = new LocalRepo(new MemoryKV());
  await repo.init();
  await repo.login('owner', '1111');
  await repo.updateSettings({ minHistoryDays: 5 });
  assert.equal(repo.settings().minHistoryDays, 5);
  await assert.rejects(() => repo.updateSettings({ historyDays: 0 }));
  await assert.rejects(() => repo.updateSettings({ leadTimeDays: 1.5 }));
});
