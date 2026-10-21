// What a write looks like. LocalRepo builds one Change per action; the backend stores it in one step.
import type { AuditRec, HeldRec, ImportRec, MismatchRec, Movement, Product, Receipt, Role, Settings, User } from '../rules/types';

export interface Change {
  imports?: ImportRec[];
  products?: Product[]; // new or edited products. Stock fields are never sent: stock is the sum of movements.
  receipts?: Receipt[];
  movements?: Movement[];
  held?: HeldRec[];
  mismatches?: MismatchRec[];
  audit?: AuditRec[];
  settings?: Settings;
  clearAll?: boolean;
}

export interface RemoteState {
  users: User[];
  products: Product[];
  movements: Movement[];
  receipts: Receipt[];
  imports: ImportRec[];
  held: HeldRec[];
  mismatches: MismatchRec[];
  settings: Settings;
  version: number;
}

/** A shared database the app signs in to. The Supabase version is in remote.ts. */
export interface Remote {
  readonly logins: { id: string; name: string; role: Role }[];
  login(userId: string, password: string): Promise<User>;
  resume(): Promise<User | null>;
  logout(): void;
  loadAll(): Promise<RemoteState>;
  write(change: Change): Promise<number>; // returns the new data version
  version(): Promise<number>;
}
