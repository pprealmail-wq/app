// Alerts and to-order numbers, worked out from stock movements. Pure: same input, same output, on every device.
import { dateOnly } from './dates';
import { avgDaily, coveredDays, hasHistory, historySpanDays, isLowStock, isSlowMover, isUrgent, needsCountCheck, reorderPoint, suggestedOrder, unitsSold } from './metrics';
import type { Movement, Product, Receipt, Settings } from './types';

export interface Insight {
  product: Product;
  avg: number; // units sold per day that had receipts
  reorderPoint: number | null;
  daysLeft: number | null; // on hand / avg
  urgent: boolean;
  low: boolean;
  check: boolean;
  slow: boolean;
  suggested: number; // 0 unless there is enough history (or a manual level)
}

export interface InsightSet {
  asOf: string | null; // date of the latest receipt
  coveredDays: number; // days with receipts in the history window
  enoughHistory: boolean;
  spanDays: number;
  items: Insight[];
}

export function computeInsights(products: readonly Product[], movements: readonly Movement[], receipts: readonly Receipt[], s: Settings): InsightSet {
  let asOf: string | null = null;
  for (const r of receipts) if (asOf === null || r.receiptDate > asOf) asOf = r.receiptDate;
  if (asOf === null) return { asOf: null, coveredDays: 0, enoughHistory: false, spanDays: 0, items: [] };

  const dates = receipts.map((r) => dateOnly(r.receiptDate));
  const covered = coveredDays(dates, asOf, s.historyDays);
  const enough = hasHistory(covered, s);
  const span = historySpanDays(dates, asOf);

  const sales = new Map<string, Movement[]>();
  for (const m of movements) {
    if (m.type !== 'sale') continue;
    const list = sales.get(m.productId);
    if (list) list.push(m);
    else sales.set(m.productId, [m]);
  }

  const items: Insight[] = [];
  for (const p of products) {
    if (!p.isActive) continue;
    const mine = sales.get(p.id) ?? [];
    const avg = avgDaily(unitsSold(mine, asOf, s.historyDays), covered);
    const rp = reorderPoint({ manual: p.lowStockManual, avg, hasHistory: enough }, s);
    const canSuggest = enough || p.lowStockManual !== null;
    items.push({
      product: p,
      avg,
      reorderPoint: rp,
      daysLeft: avg > 0 ? Math.max(0, p.onHand) / avg : null,
      urgent: isUrgent(p.onHand, avg),
      low: isLowStock(p.onHand, rp),
      check: needsCountCheck(p.onHand),
      slow: isSlowMover({ onHand: p.onHand, lastSaleDate: p.lastSaleAt ? dateOnly(p.lastSaleAt) : null, asOf, spanDays: span }, s),
      suggested: canSuggest ? suggestedOrder(avg, p.onHand, s) : 0,
    });
  }
  return { asOf, coveredDays: covered, enoughHistory: enough, spanDays: span, items };
}
