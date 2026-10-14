export type Role = 'owner' | 'staff';
export type MovementType = 'sale' | 'receive' | 'opening' | 'count_adjust' | 'write_off' | 'correction';
export type MovementSource = 'pos_import' | 'product_list' | 'manual';
export type ReceiptKind = 'sale' | 'receive';

export type HeldReason =
  | 'unknown_prefix'
  | 'sign_mismatch'
  | 'missing_code'
  | 'missing_receipt'
  | 'missing_date'
  | 'bad_quantity';

export interface User {
  id: string;
  name: string;
  role: Role;
  pinHash: string;
  isActive: boolean;
}

export interface Product {
  id: string;
  itemCode: string;
  nameTh: string;
  unitName: string;
  category: string | null;
  supplier: string | null;
  sellPrice: number | null;
  lowStockManual: number | null;
  onHand: number;
  lastSaleAt: string | null;
  lastMovementAt: string | null;
  source: MovementSource;
  isActive: boolean;
}

export interface Movement {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number; // signed
  source: MovementSource;
  importId: string | null;
  receiptNo: string | null;
  lineNo: number | null;
  posOpening: number | null; // CC_BEG, kept only on the item's first line in the file
  unitPrice: number | null;
  reason: string | null;
  occurredAt: string;
  createdBy: string;
  createdAt: string;
}

export interface Receipt {
  receiptNo: string;
  kind: ReceiptKind;
  receiptDate: string;
  lineCount: number;
  importId: string;
}

export interface ImportRec {
  id: string;
  filename: string;
  kind: 'pos' | 'productList';
  dateFrom: string | null;
  dateTo: string | null;
  lineCount: number;
  receiptsNew: number;
  receiptsSkipped: number;
  productsCreated: number;
  heldLines: number;
  mismatchCount: number;
  uploadedBy: string;
  createdAt: string;
}

export interface HeldRec {
  id: string;
  importId: string;
  receiptNo: string;
  itemCode: string;
  nameTh: string;
  qty: string;
  reason: HeldReason;
  resolved: boolean;
}

export interface MismatchRec {
  id: string;
  importId: string;
  productId: string;
  itemCode: string;
  nameTh: string;
  appBefore: number; // app stock before the file
  posOpening: number; // POS opening balance for the file's period
  resolved: boolean;
}

export interface AuditRec {
  id: string;
  userId: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface Settings {
  leadTimeDays: number;
  safetyDays: number;
  orderCoverDays: number;
  historyDays: number;
  minHistoryDays: number;
  slowMoverDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  leadTimeDays: 2,
  safetyDays: 3,
  orderCoverDays: 7,
  historyDays: 14,
  minHistoryDays: 7,
  slowMoverDays: 30,
};

/** One usable line of a POS movement file, after cleaning. */
export interface PosLine {
  seq: number; // position in the file
  rowNo: number; // spreadsheet row number, for messages
  receiptNo: string;
  itemCode: string;
  nameTh: string;
  unitName: string;
  category: string | null;
  qty: number; // always positive
  sign: 1 | -1;
  posOpening: number | null; // CC_BEG: the POS opening balance for the file's period, printed on the item's first line
  unitPrice: number | null;
  occurredAt: string; // store wall-clock time
}

export interface HeldLine {
  rowNo: number;
  receiptNo: string;
  itemCode: string;
  nameTh: string;
  qty: string;
  reason: HeldReason;
}
