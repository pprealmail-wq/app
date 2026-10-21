// Sales analysis worked out from movements. Pure: same input, same output, on every device.
import { dateOnly } from './dates';
import type { Movement, Product } from './types';

export interface ProductSales {
  product: Product;
  cases: number; // units sold in total
  receipts: number; // distinct sale receipts that contain the product
}
export interface DayRow {
  date: string;
  sold: number;
  received: number;
}
export interface CategoryRow {
  category: string | null;
  cases: number;
}
export interface Analytics {
  days: number; // days that have any sale or delivery
  from: string | null;
  to: string | null;
  totalSold: number;
  totalReceived: number;
  products: ProductSales[]; // sold at least once, best first (by cases)
  categories: CategoryRow[]; // best first
  daily: DayRow[]; // oldest first
}

export function computeAnalytics(products: readonly Product[], movements: readonly Movement[]): Analytics {
  const byId = new Map(products.map((p) => [p.id, p]));
  const sold = new Map<string, { cases: number; receipts: Set<string> }>();
  const day = new Map<string, DayRow>();
  let totalSold = 0;
  let totalReceived = 0;

  for (const m of movements) {
    if (m.type !== 'sale' && m.type !== 'receive') continue;
    const d = dateOnly(m.occurredAt);
    const row = day.get(d) ?? { date: d, sold: 0, received: 0 };
    day.set(d, row);
    if (m.type === 'sale') {
      const q = -m.quantity;
      row.sold += q;
      totalSold += q;
      const s = sold.get(m.productId) ?? { cases: 0, receipts: new Set<string>() };
      s.cases += q;
      if (m.receiptNo) s.receipts.add(m.receiptNo);
      sold.set(m.productId, s);
    } else {
      row.received += m.quantity;
      totalReceived += m.quantity;
    }
  }

  const list: ProductSales[] = [];
  const cat = new Map<string | null, number>();
  for (const [id, s] of sold) {
    const p = byId.get(id);
    if (!p) continue;
    list.push({ product: p, cases: s.cases, receipts: s.receipts.size });
    cat.set(p.category, (cat.get(p.category) ?? 0) + s.cases);
  }
  list.sort((a, b) => b.cases - a.cases || a.product.nameTh.localeCompare(b.product.nameTh, 'th'));

  const daily = [...day.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    days: daily.length,
    from: daily.length ? daily[0].date : null,
    to: daily.length ? daily[daily.length - 1].date : null,
    totalSold,
    totalReceived,
    products: list,
    categories: [...cat].map(([category, cases]) => ({ category, cases })).sort((a, b) => b.cases - a.cases),
    daily,
  };
}
