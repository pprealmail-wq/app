// Data layer that keeps everything on this device. Mirrors what the shared database will do later:
// stock changes only through the methods below, owner-only actions are checked here, every action is audited.
import { nowBangkok } from '../rules/dates';
import { planPosImport, type ImportPlan, type PlanOptions, type PlanProductInput } from '../rules/plan';
import type { PosParse } from '../rules/pos';
import { planProductList, type ProductListParse, type ProductListPlan } from '../rules/productList';
import {
  DEFAULT_SETTINGS,
  type AuditRec,
  type HeldRec,
  type ImportRec,
  type MismatchRec,
  type Movement,
  type Product,
  type Receipt,
  type Role,
  type Settings,
  type User,
} from '../rules/types';
import type { KV } from './kv';

interface DbState {
  v: 1;
  users: User[];
  products: Product[];
  movements: Movement[];
  receipts: Receipt[];
  imports: ImportRec[];
  held: HeldRec[];
  mismatches: MismatchRec[];
  audit: AuditRec[];
  settings: Settings;
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden');
  }
}

export interface Stats {
  products: number;
  receipts: number;
  imports: number;
  lastImportAt: string | null;
  latestDataDate: string | null;
  heldOpen: number;
  mismatchOpen: number;
}

export interface LoginUser {
  id: string;
  name: string;
  role: Role;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DEMO_USERS: { id: string; name: string; role: Role; pin: string }[] = [
  { id: 'owner', name: 'เจ้าของร้าน', role: 'owner', pin: '1111' },
  { id: 'staff', name: 'พนักงาน', role: 'staff', pin: '2222' },
];

export class LocalRepo {
  private s!: DbState;
  private session: User | null = null;
  private listeners = new Set<() => void>();
  private ver = 0;

  constructor(
    private kv: KV,
    private now: () => string = nowBangkok,
    private uuid: () => string = () => crypto.randomUUID(),
  ) {}

  // ---------- lifecycle ----------
  async init(): Promise<void> {
    const raw = await this.kv.get('db');
    if (raw) {
      try {
        this.s = JSON.parse(raw) as DbState;
        return;
      } catch {
        /* fall through to a fresh database */
      }
    }
    const users: User[] = [];
    for (const u of DEMO_USERS) users.push({ id: u.id, name: u.name, role: u.role, isActive: true, pinHash: await sha256(`${u.id}:${u.pin}`) });
    this.s = { v: 1, users, products: [], movements: [], receipts: [], imports: [], held: [], mismatches: [], audit: [], settings: { ...DEFAULT_SETTINGS } };
    await this.save();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  get version(): number {
    return this.ver;
  }
  private emit() {
    this.ver++;
    this.listeners.forEach((f) => f());
  }
  private async save() {
    await this.kv.set('db', JSON.stringify(this.s));
  }

  // ---------- auth ----------
  loginUsers(): LoginUser[] {
    return this.s.users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }
  get user(): User | null {
    return this.session;
  }
  async login(userId: string, pin: string): Promise<User> {
    const u = this.s.users.find((x) => x.id === userId && x.isActive);
    if (!u || u.pinHash !== (await sha256(`${userId}:${pin}`))) throw new Error('wrong_pin');
    this.session = u;
    this.emit();
    return u;
  }
  restore(userId: string | null): void {
    const u = userId ? this.s.users.find((x) => x.id === userId && x.isActive) : undefined;
    this.session = u ?? null;
    this.emit();
  }
  logout(): void {
    this.session = null;
    this.emit();
  }
  private assertLoggedIn(): User {
    if (!this.session) throw new ForbiddenError();
    return this.session;
  }
  private assertOwner(): User {
    const u = this.assertLoggedIn();
    if (u.role !== 'owner') throw new ForbiddenError();
    return u;
  }
  private audit(userId: string, action: string, detail: string) {
    this.s.audit.push({ id: this.uuid(), userId, action, detail, createdAt: this.now() });
  }

  // ---------- reads ----------
  settings(): Settings {
    return this.s.settings;
  }
  products(): readonly Product[] {
    return this.s.products;
  }
  receipts(): readonly Receipt[] {
    return this.s.receipts;
  }
  movementsAll(): readonly Movement[] {
    return this.s.movements;
  }
  getProduct(id: string): Product | undefined {
    return this.s.products.find((p) => p.id === id);
  }
  searchProducts(query: string, limit = 100): { items: Product[]; total: number } {
    this.assertLoggedIn();
    const q = query.trim().toLowerCase();
    const active = this.s.products.filter((p) => p.isActive);
    if (q === '') return { items: active.slice(0, limit), total: active.length };
    const hits = active.filter((p) => p.nameTh.toLowerCase().includes(q) || p.itemCode.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q));
    hits.sort((a, b) => Number(b.itemCode.toLowerCase().startsWith(q)) - Number(a.itemCode.toLowerCase().startsWith(q)));
    return { items: hits.slice(0, limit), total: hits.length };
  }
  movementsOf(productId: string, limit = 50): Movement[] {
    this.assertLoggedIn();
    return this.s.movements
      .filter((m) => m.productId === productId)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
      .slice(0, limit);
  }
  imports(): readonly ImportRec[] {
    this.assertOwner();
    return [...this.s.imports].reverse();
  }
  heldOpen(): HeldRec[] {
    this.assertOwner();
    return this.s.held.filter((h) => !h.resolved);
  }
  mismatchesOpen(): MismatchRec[] {
    this.assertOwner();
    return this.s.mismatches.filter((m) => !m.resolved);
  }
  stats(): Stats {
    let latest: string | null = null;
    for (const r of this.s.receipts) if (latest === null || r.receiptDate > latest) latest = r.receiptDate;
    const last = this.s.imports[this.s.imports.length - 1];
    return {
      products: this.s.products.length,
      receipts: this.s.receipts.length,
      imports: this.s.imports.length,
      lastImportAt: last?.createdAt ?? null,
      latestDataDate: latest,
      heldOpen: this.s.held.filter((h) => !h.resolved).length,
      mismatchOpen: this.s.mismatches.filter((m) => !m.resolved).length,
    };
  }

  // ---------- POS movement file ----------
  private planInputs() {
    const products = new Map<string, PlanProductInput>();
    for (const p of this.s.products) products.set(p.itemCode, { itemCode: p.itemCode, onHand: p.onHand, lastMovementAt: p.lastMovementAt, sellPrice: p.sellPrice });
    const known = new Set<string>(this.s.receipts.map((r) => r.receiptNo));
    return { products, known };
  }

  previewPos(parse: Pick<PosParse, 'lines' | 'held'>, opts: PlanOptions): ImportPlan {
    this.assertOwner();
    const { products, known } = this.planInputs();
    return planPosImport(parse, known, products, opts);
  }

  async applyPos(parse: Pick<PosParse, 'lines' | 'held'>, opts: PlanOptions, filename: string): Promise<{ record: ImportRec; plan: ImportPlan }> {
    const user = this.assertOwner();
    const { products, known } = this.planInputs();
    const plan = planPosImport(parse, known, products, opts);
    const at = this.now();
    const importId = this.uuid();

    // Build everything first; nothing is changed until all of it is ready.
    const byCode = new Map(this.s.products.map((p) => [p.itemCode, p]));
    const created: Product[] = plan.newProducts.map((n) => ({
      id: this.uuid(),
      itemCode: n.itemCode,
      nameTh: n.nameTh,
      unitName: n.unitName,
      category: n.category,
      supplier: null,
      sellPrice: n.sellPrice,
      lowStockManual: null,
      onHand: 0,
      lastSaleAt: null,
      lastMovementAt: null,
      source: 'pos_import',
      isActive: true,
    }));
    for (const p of created) byCode.set(p.itemCode, p);

    const movements: Movement[] = plan.movements.map((m) => ({
      id: this.uuid(),
      productId: byCode.get(m.itemCode)!.id,
      type: m.type,
      quantity: m.quantity,
      source: 'pos_import',
      importId,
      receiptNo: m.receiptNo,
      lineNo: m.lineNo,
      posOpening: m.posOpening,
      unitPrice: m.unitPrice,
      reason: null,
      occurredAt: m.occurredAt,
      createdBy: user.id,
      createdAt: at,
    }));
    const lastMove: Record<string, string> = {};
    for (const m of plan.movements) if (m.type !== 'opening' && (lastMove[m.itemCode] === undefined || m.occurredAt > lastMove[m.itemCode])) lastMove[m.itemCode] = m.occurredAt;

    const record: ImportRec = {
      id: importId,
      filename,
      kind: 'pos',
      dateFrom: plan.dateFrom,
      dateTo: plan.dateTo,
      lineCount: parse.lines.length + parse.held.length,
      receiptsNew: plan.receiptsNew.length,
      receiptsSkipped: plan.receiptsSkipped,
      productsCreated: created.length,
      heldLines: plan.held.length,
      mismatchCount: plan.mismatches.length,
      uploadedBy: user.id,
      createdAt: at,
    };

    // ---- commit ----
    this.s.products.push(...created);
    for (const [code, onHand] of Object.entries(plan.onHandAfter)) {
      const p = byCode.get(code)!;
      p.onHand = onHand;
      if (lastMove[code] !== undefined && (p.lastMovementAt === null || lastMove[code] > p.lastMovementAt)) p.lastMovementAt = lastMove[code];
      const ls = plan.lastSaleAt[code];
      if (ls !== undefined && (p.lastSaleAt === null || ls > p.lastSaleAt)) p.lastSaleAt = ls;
    }
    for (const u of plan.priceUpdates) byCode.get(u.itemCode)!.sellPrice = u.sellPrice;
    this.s.movements.push(...movements);
    for (const r of plan.receiptsNew) this.s.receipts.push({ ...r, importId });
    for (const h of plan.held) this.s.held.push({ id: this.uuid(), importId, receiptNo: h.receiptNo, itemCode: h.itemCode, nameTh: h.nameTh, qty: h.qty, reason: h.reason, resolved: false });
    for (const m of plan.mismatches) {
      this.s.mismatches.push({ id: this.uuid(), importId, productId: byCode.get(m.itemCode)!.id, itemCode: m.itemCode, nameTh: m.nameTh, appBefore: m.appBefore, posOpening: m.posOpening, resolved: false });
    }
    this.s.imports.push(record);
    this.audit(user.id, 'pos_import', `${filename}: ${record.receiptsNew} new receipts, ${record.receiptsSkipped} skipped, ${record.productsCreated} products created, ${record.heldLines} held`);
    await this.save();
    this.emit();
    return { record, plan };
  }

  // ---------- optional product list ----------
  private existingFields() {
    return new Map(this.s.products.map((p) => [p.itemCode, { itemCode: p.itemCode, nameTh: p.nameTh, unitName: p.unitName, category: p.category, supplier: p.supplier, sellPrice: p.sellPrice, lowStockManual: p.lowStockManual }]));
  }

  previewProductList(parse: ProductListParse): ProductListPlan {
    this.assertOwner();
    return planProductList(parse, this.existingFields());
  }

  async applyProductList(parse: ProductListParse, filename: string): Promise<{ record: ImportRec; plan: ProductListPlan }> {
    const user = this.assertOwner();
    const plan = planProductList(parse, this.existingFields());
    const at = this.now();
    const importId = this.uuid();
    for (const r of plan.toCreate) {
      const p: Product = {
        id: this.uuid(),
        itemCode: r.itemCode,
        nameTh: r.nameTh,
        unitName: r.unitName,
        category: r.category,
        supplier: r.supplier,
        sellPrice: r.sellPrice,
        lowStockManual: r.lowStockManual,
        onHand: r.onHand ?? 0,
        lastSaleAt: null,
        lastMovementAt: null,
        source: 'product_list',
        isActive: true,
      };
      this.s.products.push(p);
      if (p.onHand !== 0) {
        this.s.movements.push({
          id: this.uuid(), productId: p.id, type: 'opening', quantity: p.onHand, source: 'product_list', importId, receiptNo: null, lineNo: null,
          posOpening: null, unitPrice: null, reason: null, occurredAt: '1970-01-01T00:00:00', createdBy: user.id, createdAt: at,
        });
      }
    }
    const byCode = new Map(this.s.products.map((p) => [p.itemCode, p]));
    for (const u of plan.toUpdate) Object.assign(byCode.get(u.itemCode)!, u.changes);
    const record: ImportRec = {
      id: importId, filename, kind: 'productList', dateFrom: null, dateTo: null, lineCount: parse.rows.length + parse.invalid.length,
      receiptsNew: 0, receiptsSkipped: 0, productsCreated: plan.toCreate.length, heldLines: plan.invalid.length, mismatchCount: 0, uploadedBy: user.id, createdAt: at,
    };
    this.s.imports.push(record);
    this.audit(user.id, 'product_list_import', `${filename}: ${plan.toCreate.length} created, ${plan.toUpdate.length} updated`);
    await this.save();
    this.emit();
    return { record, plan };
  }

  // ---------- fixing differences ----------
  async acceptMismatch(id: string): Promise<void> {
    const user = this.assertOwner();
    const m = this.s.mismatches.find((x) => x.id === id && !x.resolved);
    const p = m ? this.s.products.find((x) => x.id === m.productId) : undefined;
    if (!m || !p) return;
    const diff = m.posOpening - m.appBefore;
    if (diff !== 0) {
      p.onHand += diff;
      this.s.movements.push({
        id: this.uuid(), productId: p.id, type: 'count_adjust', quantity: diff, source: 'manual', importId: m.importId, receiptNo: null, lineNo: null,
        posOpening: m.posOpening, unitPrice: null, reason: 'accept_pos_opening', occurredAt: this.now(), createdBy: user.id, createdAt: this.now(),
      });
    }
    m.resolved = true;
    this.audit(user.id, 'accept_pos_opening', `${p.itemCode}: ${diff >= 0 ? '+' : ''}${diff}`);
    await this.save();
    this.emit();
  }

  async ignoreMismatch(id: string): Promise<void> {
    const user = this.assertOwner();
    const m = this.s.mismatches.find((x) => x.id === id);
    if (!m) return;
    m.resolved = true;
    this.audit(user.id, 'ignore_mismatch', m.itemCode);
    await this.save();
    this.emit();
  }

  async dismissHeld(id: string): Promise<void> {
    const user = this.assertOwner();
    const h = this.s.held.find((x) => x.id === id);
    if (!h) return;
    h.resolved = true;
    this.audit(user.id, 'dismiss_held', `${h.receiptNo} ${h.itemCode}`);
    await this.save();
    this.emit();
  }

  /** Remove all products, movements and imports (demo reset). Users and settings stay. */
  async clearData(): Promise<void> {
    const user = this.assertOwner();
    this.s.products = [];
    this.s.movements = [];
    this.s.receipts = [];
    this.s.imports = [];
    this.s.held = [];
    this.s.mismatches = [];
    this.audit(user.id, 'clear_data', 'all products, movements and imports removed');
    await this.save();
    this.emit();
  }
}
