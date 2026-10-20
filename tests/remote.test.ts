import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromWire, SupabaseRemote, toWire } from '../src/lib/repo/remote';
import { ForbiddenError } from '../src/lib/repo/errors';
import type { Product } from '../src/lib/rules/types';

const product: Product = {
  id: 'p1', itemCode: '0001', nameTh: 'ก', unitName: 'ลัง', category: 'x', supplier: null, sellPrice: 10, lowStockManual: 3,
  onHand: 99, lastSaleAt: '2026-10-02T10:00:00', lastMovementAt: '2026-10-02T10:00:00', source: 'pos_import', isActive: true,
};

test('writes use snake_case and never send stock fields', () => {
  const w = toWire({ products: [product], clearAll: true, settings: { leadTimeDays: 2, safetyDays: 3, orderCoverDays: 7, historyDays: 14, minHistoryDays: 7, slowMoverDays: 30 } });
  const p = (w.products as Record<string, unknown>[])[0];
  assert.equal(p.item_code, '0001');
  assert.equal(p.low_stock_manual, 3);
  assert.ok(!('on_hand' in p) && !('last_sale_at' in p) && !('last_movement_at' in p));
  assert.equal(w.clear_all, true);
  assert.equal((w.settings as Record<string, number>).min_history_days, 7);
  assert.ok(!('movements' in w)); // empty lists are not sent
});

test('rows from the database come back as the app\'s own shapes', () => {
  const r = fromWire({
    users: [{ id: 'u', name: 'n', role: 'owner', is_active: true }],
    products: [{ id: 'p1', item_code: '0001', name_th: 'ก', unit_name: 'ลัง', category: null, supplier: null, sell_price: 12.5, low_stock_manual: null, on_hand: 4, last_sale_at: null, last_movement_at: null, source: 'pos_import', is_active: true }],
    movements: [], receipts: [], imports: [], held: [], mismatches: [],
    settings: { id: 1, lead_time_days: 2, safety_days: 3, order_cover_days: 7, history_days: 14, min_history_days: 7, slow_mover_days: 30 },
    version: 12,
  });
  assert.equal(r.products[0].itemCode, '0001');
  assert.equal(r.products[0].onHand, 4);
  assert.equal(r.products[0].sellPrice, 12.5);
  assert.equal(r.users[0].isActive, true);
  assert.equal(r.settings.minHistoryDays, 7);
  assert.ok(!('id' in r.settings));
  assert.equal(r.version, 12);
});

test('sign-in, refresh and error mapping (mock server)', async () => {
  const calls: string[] = [];
  const fake = (async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${input}`);
    const json = (code: number, j: unknown) => new Response(JSON.stringify(j), { status: code });
    if (input.includes('grant_type=password')) {
      const b = JSON.parse(String(init!.body));
      return b.password === 'good-pass' ? json(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, user: { id: 'u1' } }) : json(400, { error_description: 'Invalid login credentials' });
    }
    if (input.includes('/rest/v1/users')) return json(200, [{ id: 'u1', name: 'เจ้าของ', role: 'owner', is_active: true }]);
    if (input.includes('/rpc/get_version')) return String((init!.headers as Record<string, string>).Authorization).includes('a1') ? json(200, 5) : json(403, { code: '42501', message: 'x' });
    return json(404, {});
  }) as unknown as typeof fetch;
  let saved: string | null = null;
  const store = { get: () => saved, set: (v: string | null) => { saved = v; } };
  const remote = new SupabaseRemote('https://x.supabase.co/', 'anon', store, fake);

  await assert.rejects(() => remote.login('owner', 'bad'), /wrong_pin/);
  assert.equal(saved, null);
  const u = await remote.login('owner', 'good-pass');
  assert.equal(u.role, 'owner');
  assert.ok(calls[0].startsWith('POST https://x.supabase.co/auth/v1/token')); // trailing slash handled
  assert.equal(await remote.version(), 5);

  const again = new SupabaseRemote('https://x.supabase.co', 'anon', store, fake); // a new page load
  assert.equal((await again.resume())?.name, 'เจ้าของ');
  remote.logout();
  assert.equal(saved, null);
  assert.equal(await new SupabaseRemote('https://x.supabase.co', 'anon', store, fake).resume(), null);
  void ForbiddenError;
});
