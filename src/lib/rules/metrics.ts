import { addDays, diffDays } from './dates';
import type { Settings } from './types';

/** Distinct dates (YYYY-MM-DD) in the window that have at least one POS receipt. */
export function coveredDays(receiptDates: Iterable<string>, asOf: string, windowDays: number): number {
  const seen = new Set<string>();
  for (const d of receiptDates) {
    const age = diffDays(d, asOf);
    if (age >= 0 && age < windowDays) seen.add(d);
  }
  return seen.size;
}

/** Units sold (positive number) in the window, from sale movements. */
export function unitsSold(sales: Iterable<{ quantity: number; occurredAt: string }>, asOf: string, windowDays: number): number {
  let total = 0;
  const from = addDays(asOf, -(windowDays - 1));
  for (const m of sales) {
    const d = m.occurredAt.slice(0, 10);
    if (d >= from && d <= asOf) total += -m.quantity;
  }
  return total;
}

export const avgDaily = (sold: number, covered: number): number => (covered > 0 ? sold / covered : 0);

export const hasHistory = (covered: number, s: Settings): boolean => covered >= s.minHistoryDays;

/** Manual level if the owner set one, otherwise sales-based. null means "not enough history". */
export function reorderPoint(a: { manual: number | null; avg: number; hasHistory: boolean }, s: Settings): number | null {
  if (a.manual !== null) return a.manual;
  if (!a.hasHistory) return null;
  return Math.ceil(a.avg * (s.leadTimeDays + s.safetyDays));
}

export const isLowStock = (onHand: number, rp: number | null): boolean => rp !== null && rp > 0 && onHand <= rp;

/** Less than one day of sales left (or none). */
export const isUrgent = (onHand: number, avg: number): boolean => avg > 0 && (onHand <= 0 || onHand < avg);

export const suggestedOrder = (avg: number, onHand: number, s: Settings): number =>
  Math.max(0, Math.ceil(avg * (s.leadTimeDays + s.orderCoverDays)) - onHand);

export const needsCountCheck = (onHand: number): boolean => onHand < 0;

/** Days from the earliest receipt date to asOf, counting both ends. */
export function historySpanDays(receiptDates: readonly string[], asOf: string): number {
  if (receiptDates.length === 0) return 0;
  const earliest = receiptDates.reduce((a, b) => (a < b ? a : b));
  return diffDays(earliest, asOf) + 1;
}

export function isSlowMover(
  a: { onHand: number; lastSaleDate: string | null; asOf: string; spanDays: number },
  s: Settings,
): boolean {
  if (a.onHand <= 0) return false;
  if (a.spanDays < s.slowMoverDays) return false; // not enough history to say
  if (a.lastSaleDate === null) return true;
  return diffDays(a.lastSaleDate, a.asOf) >= s.slowMoverDays;
}
