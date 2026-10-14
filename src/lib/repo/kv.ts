// Tiny key-value storage so the app can keep its data on the device (IndexedDB) and tests can use memory.

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  async get(key: string) {
    return this.m.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.m.set(key, value);
  }
  async remove(key: string) {
    this.m.delete(key);
  }
}

export class IdbKV implements KV {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private dbName = 'store-stock-manager', private store = 'kv') {}
  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(this.store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, mode);
      const req = fn(tx.objectStore(this.store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async get(key: string) {
    const v = await this.run('readonly', (s) => s.get(key));
    return typeof v === 'string' ? v : null;
  }
  async set(key: string, value: string) {
    await this.run('readwrite', (s) => s.put(value, key));
  }
  async remove(key: string) {
    await this.run('readwrite', (s) => s.delete(key));
  }
}
