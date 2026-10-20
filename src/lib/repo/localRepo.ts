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
import type { Change, Remote } from './change';
import { ForbiddenError } from './errors';
import type { KV } from './kv';

export { ForbiddenError };

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
    private remote: Remote | null = null,
  ) {}

  // ---------- lifecycle ----------
  private emptyState(): DbState {
    return { v: 1, users: [], products: [], movements: [], receipts: [], imports: [], held: [], mismatches: [], audit: [], settings: { ...DEFAULT_SETTINGS } };
  }

  /** True when data lives in the shared database instead of this device. */
  get isRemote(): boolean {
    return this.remote !== null;
  }

  async init(): Promise<void> {
    if (this.remote) {
      this.s = this.emptyState();
      return;
    }
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
    if (this.remote) return [...this.remote.logins];
    return this.s.users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }
  get user(): User | null {
    return this.session;
  }
  async login(userId: string, pin: string): Promise<User> {
    if (this.remote) {
      const u = await this.remote.login(userId, pin);
      this.session = u;
      try {
        await this.reload();
      } catch (e) {
        this.logout();
        throw e;
      }
      this.startSync();
      this.emit();
      return u;
    }
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
  /** Shared mode: pick up a saved sign-in. Returns true when the person is signed in again. */
  async resume(): Promise<boolean> {
    if (!this.remote) return false;
    const u = await this.remote.resume();
    if (!u) return false;
    this.session = u;
    await this.reload();
    this.startSync();
    this.emit();
    return true;
  }

  logout(): void {
    this.session = null;
    if (this.remote) {
      this.remote.logout();
      this.stopSync();
      this.s = this.emptyState();
    }
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
  private audit(userId: string, action: string, detail: string): AuditRec {
    const rec: AuditRec = { id: this.uuid(), userId, action, detail, createdAt: this.now() };
    this.s.audit.push(rec);
    return rec;
  }

  // ---------- shared database ----------
  private syncVersion = -1;
  private timer: ReturnType<typeof setInterval> | null = null;

  private async reload(): Promise<void> {
    const r = await this.remote!.loadAll();
    this.s = { v: 1, users: r.users, products: r.products, movements: r.movements, receipts: r.receipts, imports: r.imports, held: r.held, mismatches: r.mismatches, audit: [], settings: r.settings };
    this.syncVersion = r.version;
  }

  /** Stores one change: on this device, or in the shared database (all or nothing). If the database refuses, the screen goes back to what it holds. */
  private async persist(change: Change): Promise<void> {
    if (!this.remote) {
      await this.save();
      return;
    }
    try {
      this.syncVersion = await this.remote.write(change);
    } catch (e) {
      try {
        await this.reload();
      } catch {
        /* offline: keep what is on screen */
      }
      this.emit();
      throw e;
    }
  }

  private startSync() {
    if (!this.remote || this.timer) return;
    const tick = async () => {
      if (!this.session || !this.remote) return;
      try {
        const v = await this.remote.version();
        if (v !== this.syncVersion) {
          await this.reload();
          this.emit();
        }
      } catch {
        /* offline or signed out: try again next time */
      }
    };
    this.timer = setInterval(tick, 10_000);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => void (document.visibilityState === 'visible' && tick()));
  }
  private stopSync() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** Check for other people's changes now (used by tests and by the refresh button). */
  async refresh(): Promise<void> {
    if (!this.remote || !this.session) return;
    await this.reload();
    this.emit();
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
    const receipts: Receipt[] = plan.receiptsNew.map((r) => ({ ...r, importId }));
    this.s.receipts.push(...receipts);
    const heldRecs: HeldRec[] = plan.held.map((h) => ({ id: this.uuid(), importId, receiptNo: h.receiptNo, itemCode: h.itemCode, nameTh: h.nameTh, qty: h.qty, reason: h.reason, resolved: false }));
    this.s.held.push(...heldRecs);
    const mismatchRecs: MismatchRec[] = plan.mismatches.map((m) => ({ id: this.uuid(), importId, productId: byCode.get(m.itemCode)!.id, itemCode: m.itemCode, nameTh: m.nameTh, appBefore: m.appBefore, posOpening: m.posOpening, resolved: false }));
    this.s.mismatches.push(...mismatchRecs);
    this.s.imports.push(record);
    const auditRec = this.audit(user.id, 'pos_import', `${filename}: ${record.receiptsNew} new receipts, ${record.receiptsSkipped} skipped, ${record.productsCreated} products created, ${record.heldLines} held`);
    const touched = new Map<string, Product>(created.map((p) => [p.id, p]));
    for (const u of plan.priceUpdates) {
      const p = byCode.get(u.itemCode)!;
      touched.set(p.id, p);
    }
    await this.persist({ imports: [record], products: [...touched.values()], receipts, movements, held: heldRecs, mismatches: mismatchRecs, audit: [auditRec] });
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
    const createdList: Product[] = [];
    const openings: Movement[] = [];
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
      createdList.push(p);
      if (p.onHand !== 0) {
        const mv: Movement = {
          id: this.uuid(), productId: p.id, type: 'opening', quantity: p.onHand, source: 'product_list', importId, receiptNo: null, lineNo: null,
          posOpening: null, unitPrice: null, reason: null, occurredAt: '1970-01-01T00:00:00', createdBy: user.id, createdAt: at,
        };
        this.s.movements.push(mv);
        openings.push(mv);
      }
    }
    const byCode = new Map(this.s.products.map((p) => [p.itemCode, p]));
    const edited = plan.toUpdate.map((u) => Object.assign(byCode.get(u.itemCode)!, u.changes));
    const record: ImportRec = {
      id: importId, filename, kind: 'productList', dateFrom: null, dateTo: null, lineCount: parse.rows.length + parse.invalid.length,
      receiptsNew: 0, receiptsSkipped: 0, productsCreated: plan.toCreate.length, heldLines: plan.invalid.length, mismatchCount: 0, uploadedBy: user.id, createdAt: at,
    };
    this.s.imports.push(record);
    const auditRec = this.audit(user.id, 'product_list_import', `${filename}: ${plan.toCreate.length} created, ${plan.toUpdate.length} updated`);
    await this.persist({ imports: [record], products: [...createdList, ...edited], movements: openings, audit: [auditRec] });
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
    const moves: Movement[] = [];
    if (diff !== 0) {
      p.onHand += diff;
      const mv: Movement = {
        id: this.uuid(), productId: p.id, type: 'count_adjust', quantity: diff, source: 'manual', importId: m.importId, receiptNo: null, lineNo: null,
        posOpening: m.posOpening, unitPrice: null, reason: 'accept_pos_opening', occurredAt: this.now(), createdBy: user.id, createdAt: this.now(),
      };
      this.s.movements.push(mv);
      moves.push(mv);
    }
    m.resolved = true;
    const auditRec = this.audit(user.id, 'accept_pos_opening', `${p.itemCode}: ${diff >= 0 ? '+' : ''}${diff}`);
    await this.persist({ movements: moves, mismatches: [m], audit: [auditRec] });
    this.emit();
  }

  /** Use the POS opening balance for every open mismatch in one step. Returns how many products changed. */
  async acceptAllMismatches(): Promise<number> {
    const user = this.assertOwner();
    const at = this.now();
    let changed = 0;
    const moves: Movement[] = [];
    const resolvedRecs: MismatchRec[] = [];
    for (const m of this.s.mismatches) {
      if (m.resolved) continue;
      const p = this.s.products.find((x) => x.id === m.productId);
      m.resolved = true;
      resolvedRecs.push(m);
      if (!p) continue;
      const diff = m.posOpening - m.appBefore;
      if (diff === 0) continue;
      p.onHand += diff;
      const mv: Movement = {
        id: this.uuid(), productId: p.id, type: 'count_adjust', quantity: diff, source: 'manual', importId: m.importId, receiptNo: null, lineNo: null,
        posOpening: m.posOpening, unitPrice: null, reason: 'accept_pos_opening', occurredAt: at, createdBy: user.id, createdAt: at,
      };
      this.s.movements.push(mv);
      moves.push(mv);
      changed++;
    }
    const auditRec = this.audit(user.id, 'accept_all_pos_opening', `${changed} products adjusted`);
    await this.persist({ movements: moves, mismatches: resolvedRecs, audit: [auditRec] });
    this.emit();
    return changed;
  }

  async ignoreMismatch(id: string): Promise<void> {
    const user = this.assertOwner();
    const m = this.s.mismatches.find((x) => x.id === id);
    if (!m) return;
    m.resolved = true;
    const auditRec = this.audit(user.id, 'ignore_mismatch', m.itemCode);
    await this.persist({ mismatches: [m], audit: [auditRec] });
    this.emit();
  }

  async dismissHeld(id: string): Promise<void> {
    const user = this.assertOwner();
    const h = this.s.held.find((x) => x.id === id);
    if (!h) return;
    h.resolved = true;
    const auditRec = this.audit(user.id, 'dismiss_held', `${h.receiptNo} ${h.itemCode}`);
    await this.persist({ held: [h], audit: [auditRec] });
    this.emit();
  }

  // ---------- hand corrections (owner and staff) ----------
  private requireProduct(id: string): Product {
    const p = this.s.products.find((x) => x.id === id);
    if (!p) throw new Error('not_found');
    return p;
  }
  private manualMove(p: Product, type: 'count_adjust' | 'write_off', quantity: number, reason: string, userId: string): Movement {
    const at = this.now();
    const mv: Movement = {
      id: this.uuid(), productId: p.id, type, quantity, source: 'manual', importId: null, receiptNo: null, lineNo: null,
      posOpening: null, unitPrice: null, reason, occurredAt: at, createdBy: userId, createdAt: at,
    };
    this.s.movements.push(mv);
    p.onHand += quantity;
    p.lastMovementAt = at;
    return mv;
  }

  /** Set stock to the number physically counted. Writes the difference as one movement. */
  async recordCount(productId: string, counted: number): Promise<number> {
    const user = this.assertLoggedIn();
    if (!Number.isInteger(counted) || counted < 0) throw new Error('bad_quantity');
    const p = this.requireProduct(productId);
    const diff = counted - p.onHand;
    const mv = diff !== 0 ? this.manualMove(p, 'count_adjust', diff, 'count', user.id) : null;
    const auditRec = this.audit(user.id, 'count', `${p.itemCode}: ${p.onHand - diff} -> ${counted}`);
    await this.persist({ movements: mv ? [mv] : [], audit: [auditRec] });
    this.emit();
    return diff;
  }

  /** Remove damaged or lost goods from stock. */
  async recordWriteOff(productId: string, qty: number, reason: 'damaged' | 'lost' | 'other'): Promise<void> {
    const user = this.assertLoggedIn();
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('bad_quantity');
    const p = this.requireProduct(productId);
    const mv = this.manualMove(p, 'write_off', -qty, reason, user.id);
    const auditRec = this.audit(user.id, 'write_off', `${p.itemCode}: -${qty} ${reason}`);
    await this.persist({ movements: [mv], audit: [auditRec] });
    this.emit();
  }

  /** Owner sets (or clears) the level at which a product is warned about. */
  async setLowStockManual(productId: string, level: number | null): Promise<void> {
    const user = this.assertOwner();
    if (level !== null && (!Number.isInteger(level) || level < 0)) throw new Error('bad_quantity');
    const p = this.requireProduct(productId);
    p.lowStockManual = level;
    const auditRec = this.audit(user.id, 'set_threshold', `${p.itemCode}: ${level ?? 'auto'}`);
    await this.persist({ products: [p], audit: [auditRec] });
    this.emit();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const user = this.assertOwner();
    const next = { ...this.s.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = patch[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < (k === 'leadTimeDays' || k === 'safetyDays' ? 0 : 1) || v > 365) throw new Error('bad_setting');
      next[k] = v;
    }
    this.s.settings = next;
    const auditRec = this.audit(user.id, 'settings', JSON.stringify(patch));
    await this.persist({ settings: next, audit: [auditRec] });
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
    const auditRec = this.audit(user.id, 'clear_data', 'all products, movements and imports removed');
    await this.persist({ clearAll: true, audit: [auditRec] });
    this.emit();
  }
}
