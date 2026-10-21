import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics } from '../src/lib/rules/analytics';
import type { Movement, Product } from '../src/lib/rules/types';

const prod = (id: string, onHand: number, category: string | null = 'x'): Product => ({
  id, itemCode: id, nameTh: id, unitName: 'ลัง', category, supplier: null, sellPrice: null, lowStockManual: null,
  onHand, lastSaleAt: null, lastMovementAt: null, source: 'pos_import', isActive: true,
});
const mv = (productId: string, type: Movement['type'], qty: number, day: string, receiptNo: string): Movement => ({
  id: `${productId}${day}${receiptNo}`, productId, type, quantity: type === 'sale' ? -qty : qty, source: 'pos_import', importId: null,
  receiptNo, lineNo: 1, posOpening: null, unitPrice: null, reason: null, occurredAt: `${day}T10:00:00`, createdBy: 'o', createdAt: '',
});

test('analytics: best sellers, categories, daily, dead stock', () => {
  const products = [prod('A', 5, 'c1'), prod('B', 9, 'c2'), prod('C', 40, 'c2')];
  const m = [
    mv('A', 'sale', 10, '2026-10-01', 'R1'),
    mv('A', 'sale', 2, '2026-10-02', 'R2'),
    mv('B', 'sale', 6, '2026-10-01', 'R1'),
    mv('B', 'receive', 20, '2026-10-02', 'D1'),
    mv('A', 'count_adjust', 3, '2026-10-02', 'X'),
  ];
  const a = computeAnalytics(products, m);
  assert.equal(a.totalSold, 18);
  assert.equal(a.totalReceived, 20);
  assert.equal(a.days, 2);
  assert.deepEqual(a.products.map((p) => [p.product.id, p.cases, p.receipts]), [['A', 12, 2], ['B', 6, 1]]);
  assert.deepEqual(a.categories.map((c) => [c.category, c.cases]), [['c1', 12], ['c2', 6]]);
  assert.deepEqual(a.daily, [{ date: '2026-10-01', sold: 16, received: 0 }, { date: '2026-10-02', sold: 2, received: 20 }]);
  assert.deepEqual(a.dead.map((d) => d.product.id), ['C']);
});

test('analytics: empty data', () => {
  const a = computeAnalytics([], []);
  assert.equal(a.days, 0);
  assert.equal(a.from, null);
});
