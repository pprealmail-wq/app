import { dateOnly } from './dates';
import { RECEIPT_KIND, receiptPrefix, type PosParse } from './pos';
import type { HeldLine, HeldReason, PosLine, ReceiptKind } from './types';

export interface PlanProductInput {
  itemCode: string;
  onHand: number;
  lastMovementAt: string | null;
  sellPrice: number | null;
}

export interface PlanOptions {
  /** Use CC_BEG (the POS opening balance) as the opening stock of products the app has never seen. */
  useOpeningFromPos: boolean;
}

export interface PlannedMovement {
  itemCode: string;
  type: 'sale' | 'receive' | 'opening';
  quantity: number; // signed
  receiptNo: string | null;
  lineNo: number | null;
  posOpening: number | null;
  unitPrice: number | null;
  occurredAt: string;
}

export interface NewProductPlan {
  itemCode: string;
  nameTh: string;
  unitName: string;
  category: string | null;
  sellPrice: number | null;
  opening: number;
}

export interface MismatchPlan {
  itemCode: string;
  nameTh: string;
  appBefore: number;
  posOpening: number;
}

export interface ImportPlan {
  receiptsNew: { receiptNo: string; kind: ReceiptKind; receiptDate: string; lineCount: number }[];
  receiptsSkipped: number;
  linesApplied: number;
  salesLines: number;
  receiveLines: number;
  newProducts: NewProductPlan[];
  movements: PlannedMovement[];
  held: HeldLine[];
  mismatches: MismatchPlan[];
  priceUpdates: { itemCode: string; sellPrice: number }[];
  lastSaleAt: Record<string, string>;
  onHandAfter: Record<string, number>;
  dateFrom: string | null;
  dateTo: string | null;
}

const heldFrom = (l: PosLine, reason: HeldReason): HeldLine => ({
  rowNo: l.rowNo,
  receiptNo: l.receiptNo,
  itemCode: l.itemCode,
  nameTh: l.nameTh,
  qty: String(l.qty),
  reason,
});

interface ProductState {
  existing: PlanProductInput | undefined;
  first: PosLine; // first applied line in time order (used for name, unit, category)
  net: number;
  lastSaleAt: string | null;
  price: number | null;
}

/**
 * Pure planning step for a POS movement file: decides what would change, without changing anything.
 * The same plan drives the preview screen and the real import.
 *
 * CC_BEG in the POS export is the item's opening balance for the whole report. It is printed once, on the
 * item's first line in the file, and is 0 on the item's other lines.
 */
export function planPosImport(
  parse: Pick<PosParse, 'lines' | 'held'>,
  knownReceipts: ReadonlySet<string>,
  products: ReadonlyMap<string, PlanProductInput>,
  opts: PlanOptions,
): ImportPlan {
  const held: HeldLine[] = [...parse.held];

  // Opening balance per item = CC_BEG on its first line in file order; also whether the file is entirely new for it.
  const firstInFile = new Map<string, PosLine>();
  const earliestAt = new Map<string, string>();
  const allNew = new Map<string, boolean>();
  for (const l of parse.lines) {
    const f = firstInFile.get(l.itemCode);
    if (!f || l.seq < f.seq) firstInFile.set(l.itemCode, l);
    const e = earliestAt.get(l.itemCode);
    if (e === undefined || l.occurredAt < e) earliestAt.set(l.itemCode, l.occurredAt);
    if (knownReceipts.has(l.receiptNo)) allNew.set(l.itemCode, false);
    else if (!allNew.has(l.itemCode)) allNew.set(l.itemCode, true);
  }

  const byReceipt = new Map<string, PosLine[]>();
  for (const l of parse.lines) {
    const arr = byReceipt.get(l.receiptNo);
    if (arr) arr.push(l);
    else byReceipt.set(l.receiptNo, [l]);
  }

  const applied: { line: PosLine; kind: ReceiptKind; lineNo: number }[] = [];
  const receiptsNew: ImportPlan['receiptsNew'] = [];
  let receiptsSkipped = 0;

  for (const [no, lines] of byReceipt) {
    if (knownReceipts.has(no)) {
      receiptsSkipped++;
      continue;
    }
    const kind = RECEIPT_KIND[receiptPrefix(no)];
    if (!kind) {
      for (const l of lines) held.push(heldFrom(l, 'unknown_prefix'));
      continue;
    }
    const expected = kind === 'sale' ? -1 : 1;
    let n = 0;
    let firstDate = '';
    for (const l of lines) {
      if (l.sign !== expected) {
        held.push(heldFrom(l, 'sign_mismatch'));
        continue;
      }
      n++;
      if (n === 1) firstDate = dateOnly(l.occurredAt);
      applied.push({ line: l, kind, lineNo: n });
    }
    if (n > 0) receiptsNew.push({ receiptNo: no, kind, receiptDate: firstDate, lineCount: n });
  }

  applied.sort((a, b) =>
    a.line.occurredAt < b.line.occurredAt ? -1 : a.line.occurredAt > b.line.occurredAt ? 1 : a.line.seq - b.line.seq,
  );

  const movements: PlannedMovement[] = [];
  const state = new Map<string, ProductState>();
  let salesLines = 0;
  let receiveLines = 0;
  for (const { line, kind, lineNo } of applied) {
    const signed = line.sign * line.qty;
    if (kind === 'sale') salesLines++;
    else receiveLines++;
    const isFirstInFile = firstInFile.get(line.itemCode)?.seq === line.seq;
    movements.push({
      itemCode: line.itemCode,
      type: kind,
      quantity: signed,
      receiptNo: line.receiptNo,
      lineNo,
      posOpening: isFirstInFile ? line.posOpening : null,
      unitPrice: line.unitPrice,
      occurredAt: line.occurredAt,
    });
    let st = state.get(line.itemCode);
    if (!st) {
      st = { existing: products.get(line.itemCode), first: line, net: 0, lastSaleAt: null, price: null };
      state.set(line.itemCode, st);
    }
    st.net += signed;
    if (kind === 'sale') st.lastSaleAt = line.occurredAt;
    if (line.unitPrice !== null) st.price = line.unitPrice;
  }

  const newProducts: NewProductPlan[] = [];
  const priceUpdates: ImportPlan['priceUpdates'] = [];
  const mismatches: MismatchPlan[] = [];
  const lastSaleAt: Record<string, string> = {};
  const onHandAfter: Record<string, number> = {};

  for (const [code, st] of state) {
    const isNew = st.existing === undefined;
    const posOpening = firstInFile.get(code)?.posOpening ?? null;
    const opening = isNew && opts.useOpeningFromPos ? posOpening ?? 0 : 0;
    if (isNew) {
      newProducts.push({
        itemCode: code,
        nameTh: st.first.nameTh,
        unitName: st.first.unitName,
        category: st.first.category,
        sellPrice: st.price,
        opening,
      });
      if (opening !== 0) {
        movements.push({
          itemCode: code,
          type: 'opening',
          quantity: opening,
          receiptNo: null,
          lineNo: null,
          posOpening,
          unitPrice: null,
          occurredAt: earliestAt.get(code) ?? st.first.occurredAt,
        });
      }
    } else if (st.price !== null && st.price !== st.existing!.sellPrice) {
      priceUpdates.push({ itemCode: code, sellPrice: st.price });
    }
    if (st.lastSaleAt) lastSaleAt[code] = st.lastSaleAt;
    onHandAfter[code] = (st.existing?.onHand ?? 0) + opening + st.net;

    // Reconcile an existing product: the app's stock before this file should equal the POS opening balance.
    // Only meaningful when the whole file is new for the item and the app has nothing later than the file starts.
    if (!isNew && posOpening !== null && allNew.get(code) === true) {
      const since = earliestAt.get(code) ?? '';
      const later = st.existing!.lastMovementAt !== null && st.existing!.lastMovementAt > since;
      if (!later && st.existing!.onHand !== posOpening) {
        mismatches.push({ itemCode: code, nameTh: st.first.nameTh, appBefore: st.existing!.onHand, posOpening });
      }
    }
  }

  const dates = receiptsNew.map((r) => r.receiptDate).sort();
  return {
    receiptsNew,
    receiptsSkipped,
    linesApplied: applied.length,
    salesLines,
    receiveLines,
    newProducts,
    movements,
    held,
    mismatches,
    priceUpdates,
    lastSaleAt,
    onHandAfter,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
  };
}
