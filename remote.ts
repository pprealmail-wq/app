// Supabase backend using plain fetch (no library): Auth for sign-in, PostgREST for the database functions in
// supabase/migrations/001_init.sql. The key below is the public "anon" key; what a person may do is decided by
// row-level security in the database, not by this code.
import type { HeldRec, ImportRec, MismatchRec, Movement, Product, Receipt, Role, Settings, User } from '../rules/types';
import type { Change, Remote, RemoteState } from './change';
import { ForbiddenError } from './errors';

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const mapKeys = (o: Record<string, unknown>, f: (k: string) => string): Record<string, unknown> => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
const rows = <T>(list: unknown): T[] => ((list as Record<string, unknown>[] | null) ?? []).map((r) => mapKeys(r, camel) as T);

/** Fields the database keeps itself. The app must not write them. */
const DERIVED = new Set(['onHand', 'lastSaleAt', 'lastMovementAt']);

export function toWire(c: Change): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const list = (name: keyof Change, drop?: Set<string>) => {
    const v = c[name] as unknown[] | undefined;
    if (v && v.length > 0) out[snake(name)] = v.map((r) => mapKeys(Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([k]) => !drop?.has(k))), snake));
  };
  list('imports');
  list('products', DERIVED);
  list('receipts');
  list('movements');
  list('held');
  list('mismatches');
  list('audit');
  if (c.settings) out.settings = mapKeys(c.settings as unknown as Record<string, unknown>, snake);
  if (c.clearAll) out.clear_all = true;
  return out;
}

export function fromWire(w: Record<string, unknown>): RemoteState {
  const settings = mapKeys((w.settings as Record<string, unknown>) ?? {}, camel);
  delete settings.id;
  return {
    users: rows<{ id: string; name: string; role: Role; isActive: boolean }>(w.users).map((u) => ({ ...u, pinHash: '' }) as User),
    products: rows<Product>(w.products),
    movements: rows<Movement>(w.movements),
    receipts: rows<Receipt>(w.receipts),
    imports: rows<ImportRec>(w.imports),
    held: rows<HeldRec>(w.held),
    mismatches: rows<MismatchRec>(w.mismatches),
    settings: settings as unknown as Settings,
    version: Number(w.version ?? 0),
  };
}

interface Session {
  access: string;
  refresh: string;
  expiresAt: number; // ms
  userId: string;
}

export interface SessionStore {
  get(): string | null;
  set(v: string | null): void;
}

export const browserSessionStore = (key = 'stock.supabase'): SessionStore => ({
  get: () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    } catch {
      /* storage may be unavailable; the person just signs in again next time */
    }
  },
});

const LOGINS: Remote['logins'] = [
  { id: 'owner', name: 'เจ้าของร้าน', role: 'owner' },
  { id: 'staff', name: 'พนักงาน', role: 'staff' },
];
export const loginEmail = (userId: string) => `${userId}@store.local`;

export class SupabaseRemote implements Remote {
  readonly logins = LOGINS;
  private session: Session | null = null;

  constructor(
    private url: string,
    private anonKey: string,
    private store: SessionStore = browserSessionStore(),
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.url = url.replace(/\/+$/, '');
  }

  // ---------- auth ----------
  private async token(body: Record<string, string>, grant: 'password' | 'refresh_token'): Promise<Session> {
    const res = await this.fetchFn(`${this.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id: string }; error_description?: string; msg?: string };
    if (!res.ok || !j.access_token || !j.refresh_token || !j.user) {
      if (res.status === 400 || res.status === 401 || res.status === 422) throw new Error('wrong_pin');
      throw new Error(j.error_description ?? j.msg ?? 'network');
    }
    return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000, userId: j.user.id };
  }

  private save(s: Session | null) {
    this.session = s;
    this.store.set(s ? JSON.stringify(s) : null);
  }

  private async profile(): Promise<User> {
    const s = this.session!;
    const res = await this.fetchFn(`${this.url}/rest/v1/users?id=eq.${encodeURIComponent(s.userId)}&select=id,name,role,is_active`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${s.access}` },
    });
    if (!res.ok) throw new Error('network');
    const list = (await res.json()) as { id: string; name: string; role: Role; is_active: boolean }[];
    const u = list[0];
    if (!u || !u.is_active) throw new Error('no_profile');
    return { id: u.id, name: u.name, role: u.role, isActive: true, pinHash: '' };
  }

  async login(userId: string, password: string): Promise<User> {
    this.save(await this.token({ email: loginEmail(userId), password }, 'password'));
    try {
      return await this.profile();
    } catch (e) {
      this.save(null);
      throw e;
    }
  }

  async resume(): Promise<User | null> {
    const raw = this.store.get();
    if (!raw) return null;
    try {
      this.session = JSON.parse(raw) as Session;
      return await this.profile();
    } catch (e) {
      if (e instanceof Error && e.message === 'network') throw e;
      this.save(null);
      return null;
    }
  }

  logout(): void {
    this.save(null);
  }

  private async fresh(): Promise<string> {
    const s = this.session;
    if (!s) throw new Error('not_signed_in');
    if (Date.now() < s.expiresAt - 60_000) return s.access;
    try {
      const next = await this.token({ refresh_token: s.refresh }, 'refresh_token');
      this.save(next);
      return next.access;
    } catch (e) {
      if (e instanceof Error && e.message === 'wrong_pin') this.save(null);
      throw new Error('session_expired');
    }
  }

  // ---------- database functions ----------
  private async rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const access = await this.fresh();
    const res = await this.fetchFn(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (res.status === 403 || res.status === 401 || j.code === '42501') throw new ForbiddenError();
      throw new Error(j.message ?? `http_${res.status}`);
    }
    return (await res.json()) as T;
  }

  async loadAll(): Promise<RemoteState> {
    return fromWire(await this.rpc<Record<string, unknown>>('load_all', {}));
  }
  async write(change: Change): Promise<number> {
    return Number(await this.rpc<number>('apply_change', { change: toWire(change) }));
  }
  async version(): Promise<number> {
    return Number(await this.rpc<number>('get_version', {}));
  }
}
