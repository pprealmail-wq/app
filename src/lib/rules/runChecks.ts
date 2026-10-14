// The checks listed in implementation-plan.md (M2). The app runs them on its "System check" screen,
// so they can be confirmed on the live URL, not only on a developer machine.
import { readTable, type Cell, type Table } from '../csv/readTable';
import { ForbiddenError, LocalRepo } from '../repo/localRepo';
import { MemoryKV } from '../repo/kv';
import { addDays } from './dates';
import {
  avgDaily, hasHistory, historySpanDays, isLowStock, isSlowMover, needsCountCheck, reorderPoint, suggestedOrder,
  coveredDays, unitsSold,
} from './metrics';
import { planPosImport } from './plan';
import { normalizePosTable } from './pos';
import { DEFAULT_SETTINGS } from './types';

export interface CheckResult {
  id: number;
  name: string;
  pass: boolean;
  detail: string;
}

const HEADERS = [
  'CF_ITEMNAME', 'CF_ITEMID', 'CF_UNITNAME', 'CF_ITEMGROUPL1_GROUPNAME', 'CF_TRANNO', 'CF_TRANDATE', 'TRANDATE', 'CC_BEG',
  'CF_TDBASEQUANTITY', 'CF_FSTOCKMAIN', 'CF_TDUNITPRICE',
];

interface RowIn {
  receipt: string;
  code: string;
  qty: number | string;
  sign?: number;
  at?: string | null; // ISO wall-clock, or null for "no TRANDATE"
  thai?: string;
  opening?: number;
  name?: string;
  price?: number;
}

function row(r: RowIn): Record<string, Cell> {
  const sign = r.sign ?? (r.receipt.startsWith('IRNM') ? 1 : -1);
  return {
    CF_ITEMNAME: r.name ?? `สินค้า ${r.code}`,
    CF_ITEMID: r.code,
    CF_UNITNAME: 'ลัง',
    CF_ITEMGROUPL1_GROUPNAME: 'สินค้ายกลัง*ทดสอบ',
    CF_TRANNO: r.receipt,
    CF_TRANDATE: r.thai ?? '02/10/2569',
    TRANDATE: r.at === undefined ? '2026-10-02T10:00:00' : r.at,
    CC_BEG: r.opening ?? 0,
    CF_TDBASEQUANTITY: r.qty,
    CF_FSTOCKMAIN: sign,
    CF_TDUNITPRICE: r.price ?? 0,
  };
}
const table = (rows: RowIn[]): Table => ({ headers: HEADERS, rows: rows.map(row), sheetName: 'test', format: 'xls' });
const parse = (rows: RowIn[]) => normalizePosTable(table(rows));
const OPTS = { useOpeningFromPos: true };

async function freshRepo(role: 'owner' | 'staff' = 'owner'): Promise<LocalRepo> {
  const repo = new LocalRepo(new MemoryKV());
  await repo.init();
  await repo.login(role, role === 'owner' ? '1111' : '2222');
  return repo;
}

const S = DEFAULT_SETTINGS;

export async function runChecks(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const add = async (id: number, name: string, fn: () => Promise<[boolean, string]> | [boolean, string]) => {
    try {
      const [pass, detail] = await fn();
      out.push({ id, name, pass, detail });
    } catch (e) {
      out.push({ id, name, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  await add(1, 'A sale line subtracts, a stock-in line adds (sign x quantity)', () => {
    const plan = planPosImport(parse([{ receipt: 'ORCM001', code: 'A', qty: 5 }, { receipt: 'IRNM001', code: 'B', qty: 182 }]), new Set(), new Map(), { useOpeningFromPos: false });
    const q = plan.movements.map((m) => m.quantity);
    return [q[0] === -5 && q[1] === 182 && plan.movements[0].type === 'sale' && plan.movements[1].type === 'receive', `movements ${q.join(', ')}`];
  });

  await add(2, 'Applying the same file twice changes nothing', async () => {
    const repo = await freshRepo();
    const p = parse([{ receipt: 'ORCM001', code: 'A', qty: 3, opening: 10 }]);
    await repo.applyPos(p, OPTS, 'f1');
    const before = repo.products()[0].onHand;
    const second = await repo.applyPos(p, OPTS, 'f1');
    return [before === 7 && repo.products()[0].onHand === 7 && second.plan.receiptsNew.length === 0 && second.plan.receiptsSkipped === 1, `on hand ${before} -> ${repo.products()[0].onHand}, new receipts on 2nd upload ${second.plan.receiptsNew.length}`];
  });

  await add(3, 'Item codes keep leading zeros (CSV file)', async () => {
    const csv = new TextEncoder().encode('CF_ITEMID,CF_ITEMNAME\n0001,ถุงร้อน\n00123,ถุงหิ้ว\n');
    const t = await readTable(csv);
    const p = parse([{ receipt: 'ORCM001', code: String(t.rows[0].CF_ITEMID), qty: 1 }]);
    return [t.rows[0].CF_ITEMID === '0001' && t.rows[1].CF_ITEMID === '00123' && p.lines[0].itemCode === '0001', `read '${t.rows[0].CF_ITEMID}' and '${t.rows[1].CF_ITEMID}'`];
  });

  await add(4, 'A receipt with an unknown prefix is held, not applied', () => {
    const plan = planPosImport(parse([{ receipt: 'XXYZ001', code: 'A', qty: 2, sign: -1 }]), new Set(), new Map(), OPTS);
    return [plan.held.length === 1 && plan.held[0].reason === 'unknown_prefix' && plan.movements.length === 0 && plan.receiptsNew.length === 0, `held ${plan.held.length}, applied ${plan.linesApplied}`];
  });

  await add(5, 'A prefix and sign that disagree are held', () => {
    const plan = planPosImport(parse([{ receipt: 'ORCM001', code: 'A', qty: 2, sign: 1 }]), new Set(), new Map(), OPTS);
    return [plan.held.length === 1 && plan.held[0].reason === 'sign_mismatch' && plan.linesApplied === 0, `held ${plan.held.map((h) => h.reason).join()}`];
  });

  await add(6, 'New product: opening balance from the POS, then the sale', async () => {
    const repo = await freshRepo();
    await repo.applyPos(parse([{ receipt: 'ORCM001', code: 'A', qty: 1, opening: 22 }]), OPTS, 'f');
    const p = repo.products()[0];
    return [p.onHand === 21, `CC_BEG 22, sale 1 -> on hand ${p.onHand}`];
  });

  await add(7, 'A Thai Buddhist date converts when TRANDATE is missing', () => {
    const p = parse([{ receipt: 'ORCM001', code: 'A', qty: 1, at: '', thai: '02/10/2569' }]);
    return [p.lines[0]?.occurredAt.slice(0, 10) === '2026-10-02', `date ${p.lines[0]?.occurredAt ?? 'none'}`];
  });

  await add(8, 'Reorder point from sales history; low stock flag', () => {
    const rp = reorderPoint({ manual: null, avg: 6, hasHistory: true }, S);
    return [rp === 30 && isLowStock(25, rp) && !isLowStock(31, rp), `average 6/day, lead ${S.leadTimeDays}, safety ${S.safetyDays} -> ${rp}`];
  });

  await add(9, 'Suggested order quantity', () => {
    const q = suggestedOrder(6, 20, S);
    return [q === 34, `ceil(6 x (${S.leadTimeDays} + ${S.orderCoverDays})) - 20 = ${q}`];
  });

  await add(10, 'Less than 7 days of history: no automatic level, no slow-mover claim', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
    const covered = coveredDays(dates, '2026-10-05', S.historyDays);
    const hh = hasHistory(covered, S);
    const rp = reorderPoint({ manual: null, avg: 4, hasHistory: hh }, S);
    const slow = isSlowMover({ onHand: 50, lastSaleDate: null, asOf: '2026-10-05', spanDays: historySpanDays(dates, '2026-10-05') }, S);
    return [!hh && rp === null && !isLowStock(0, rp) && !slow, `covered ${covered} days, reorder point ${rp}`];
  });

  await add(11, 'App stock differs from the POS opening balance: listed as a mismatch', () => {
    const products = new Map([['A', { itemCode: 'A', onHand: 10, lastMovementAt: null, sellPrice: null }]]);
    const plan = planPosImport(parse([{ receipt: 'ORCM001', code: 'A', qty: 1, opening: 12 }]), new Set(), products, OPTS);
    const m = plan.mismatches[0];
    return [plan.mismatches.length === 1 && m.appBefore === 10 && m.posOpening === 12, m ? `app ${m.appBefore}, POS ${m.posOpening}, difference ${m.posOpening - m.appBefore}` : 'no mismatch'];
  });

  await add(12, 'Negative stock is kept and flagged, not clamped to 0', () => {
    const products = new Map([['A', { itemCode: 'A', onHand: 0, lastMovementAt: null, sellPrice: null }]]);
    const plan = planPosImport(parse([{ receipt: 'ORCM001', code: 'A', qty: 3 }]), new Set(), products, OPTS);
    return [plan.onHandAfter.A === -3 && needsCountCheck(plan.onHandAfter.A), `on hand after ${plan.onHandAfter.A}`];
  });

  await add(13, 'Slow mover: stock, no sale for 30+ days, with enough history', () => {
    const asOf = '2026-11-15';
    const dates = [addDays(asOf, -40), asOf];
    const span = historySpanDays(dates, asOf);
    const yes = isSlowMover({ onHand: 5, lastSaleDate: addDays(asOf, -31), asOf, spanDays: span }, S);
    const no = isSlowMover({ onHand: 5, lastSaleDate: addDays(asOf, -29), asOf, spanDays: span }, S);
    const empty = isSlowMover({ onHand: 0, lastSaleDate: null, asOf, spanDays: span }, S);
    return [yes && !no && !empty, `31 days ago: ${yes}, 29 days ago: ${no}, no stock: ${empty}`];
  });

  await add(14, 'Staff cannot upload or preview imports', async () => {
    const repo = await freshRepo('staff');
    const p = parse([{ receipt: 'ORCM001', code: 'A', qty: 1 }]);
    let previewBlocked = false;
    let applyBlocked = false;
    try { repo.previewPos(p, OPTS); } catch (e) { previewBlocked = e instanceof ForbiddenError; }
    try { await repo.applyPos(p, OPTS, 'f'); } catch (e) { applyBlocked = e instanceof ForbiddenError; }
    return [previewBlocked && applyBlocked && repo.products().length === 0, `preview blocked ${previewBlocked}, apply blocked ${applyBlocked}`];
  });

  await add(15, 'Empty database + a sales file only: products and stock are correct', async () => {
    const repo = await freshRepo();
    const p = parse([
      { receipt: 'ORCM001', code: '0001', qty: 1, opening: 22, name: 'ถุงร้อน', at: '2026-10-02T09:00:00' },
      { receipt: 'ORCM002', code: '0001', qty: 2, opening: 0, name: 'ถุงร้อน', at: '2026-10-02T11:00:00' },
      { receipt: 'IRNM001', code: '0002', qty: 40, opening: 5, name: 'น้ำยา', at: '2026-10-02T12:00:00' },
    ]);
    await repo.applyPos(p, OPTS, 'f');
    const a = repo.products().find((x) => x.itemCode === '0001');
    const b = repo.products().find((x) => x.itemCode === '0002');
    return [repo.products().length === 2 && a?.onHand === 19 && b?.onHand === 45, `0001 -> ${a?.onHand}, 0002 -> ${b?.onHand}`];
  });

  await add(16, 'Average daily sales uses only days that have receipts', () => {
    const sales = [{ quantity: -30, occurredAt: '2026-10-02T10:00:00' }, { quantity: -30, occurredAt: '2026-10-04T10:00:00' }];
    const covered = coveredDays(['2026-10-02', '2026-10-04', '2026-10-05'], '2026-10-05', 14);
    const sold = unitsSold(sales, '2026-10-05', 14);
    return [covered === 3 && sold === 60 && avgDaily(sold, covered) === 20, `sold ${sold} over ${covered} open days = ${avgDaily(sold, covered)}/day`];
  });

  return out;
}
