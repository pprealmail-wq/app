# architecture.md — One client, one shared backend

> **Status 20 Oct:** the shared database is built and tested (`supabase/`). It turns on when the build has `SUPABASE_URL` and `SUPABASE_ANON_KEY`; without them the app keeps data on each device. Realtime is done by checking a version number every 10 seconds, not by Supabase Realtime. Edge Functions and push are not built. See `supabase/SETUP.md`.

Version 0.2 · Last updated 2026-10-13

## 1. Stack and why

| Layer | Choice | Why |
|---|---|---|
| Client | React 19 + TypeScript, bundled with esbuild (`build.mjs`), as a PWA | Installable, one codebase for iOS and Android, fast to build |
| Backend | **Supabase** (PostgreSQL + Auth + Row Level Security + Realtime + Edge Functions) | SQL fits the movement-based stock model, RLS enforces roles in the database, free tier is enough |
| Hosting (client) | Vercel or Netlify free tier | Public HTTPS URL on day one |
| File parsing | **Built-in readers** in `src/lib/csv/` (OLE2/BIFF8 for `.XLS`, zip+XML for `.xlsx`, CSV with Thai encoding fallback) | Reads the POS file as `.XLS`, `.xlsx` or `.csv` with one library. The npm copy is old, so install it from the SheetJS CDN tarball (check their install page) |
| Charts | Lightweight chart library, weekly summary only | Keep the app small |

Changes from v0.1: PapaParse and the barcode libraries are removed. The real POS file is `.XLS`, and it has no barcodes.

Alternative considered: Firebase. Rejected because stock is a sum of movements, which is easier with SQL and transactions.

## 2. Data flow

```
 Phone or PC (PWA)
   │  login (PIN → Supabase Auth)         HTTPS only, anon key only
   ▼
 Browser: parse file with the built-in readers → normalize rows (rules in src/lib/rules)
   │  send chunks of whole receipts
   ▼
 Supabase
   ├─ Auth         → users, role
   ├─ PostgreSQL   → products, stock_movements, pos_receipts, pos_imports, orders, audit_logs
   │     └─ RLS    → owner / staff rules checked here
   ├─ Realtime     → alert and stock changes appear on other devices
   └─ Edge Function→ morning check for urgent items → push notification
```

- **POS upload:** the browser reads the file and builds a **preview** (new receipts, duplicates, products to create, held lines). After the owner taps Apply, the normalized rows go to the database function `apply_pos_import`, one chunk of whole receipts at a time. The function skips known receipts, creates products, writes movements, updates `on_hand`, records held lines and mismatches, and writes `audit_logs`, all in one transaction per chunk.
- **Count and write-off** call database functions too. The client never writes stock tables directly.
- **Alerts and to-order** come from database views, so the app and the push job use the same logic.

## 3. File reading rules (where most bugs will be)

- Read all cells as text. Item codes keep their leading zeros.
- Repeated header names are renamed on read (for example `SYSITEMID`, `SYSITEMID_2`).
- Column names go through `src/lib/csv/aliases.ts`:

| App field | Accepted headers |
|---|---|
| `item_code` | `CF_ITEMID`, `item_code`, `รหัสสินค้า` |
| `name_th` | `CF_ITEMNAME`, `name_th`, `ชื่อสินค้า` |
| `unit_name` | `CF_UNITNAME`, `unit_name`, `หน่วย` |
| `category` | `CF_ITEMGROUPL1_GROUPNAME`, `category`, `หมวดหมู่` |
| `sell_price` | `CF_TDUNITPRICE`, `sell_price`, `ราคาขาย` |
| `on_hand` (product list only) | `on_hand`, `คงเหลือ` |
| `low_stock_manual` (optional) | `low_stock_level`, `จุดสั่งซื้อ` |
| `supplier` (optional) | `supplier`, `ซัพพลายเออร์` |

- Which parser runs is decided by the headers: if `CF_TRANNO` and `CF_FSTOCKMAIN` exist, it is a **POS movement file**. Otherwise it is a **product list**. If neither fits, show a Thai message listing the missing headers. A manual column-mapping screen is a fallback, not the main path.
- The same importer serves the real POS file and the made-up demo product list.

## 4. Auth flow

1. Each person has one account. The login screen asks for a name (or phone) and a PIN.
2. Supabase Auth issues a session. `users.role` is read from the `users` table and enforced by RLS.
3. Session lasts at least 30 days on a device and must survive a phone restart (known iOS PWA risk, test it).
4. A sensitive correction asks for the PIN again.
5. The owner can deactivate a user. A deactivated user is rejected by RLS immediately.

## 5. Folder structure

```
/
├─ public/
│  ├─ manifest.json
│  ├─ sw.js
│  └─ icons/ (192, 512, apple-touch-icon)
├─ src/
│  ├─ lib/
│  │  ├─ rules/          pure business rules + runChecks()
│  │  ├─ supabase.ts     client (anon key only)
│  │  └─ csv/            file reading, aliases.ts, POS and product-list parsers
│  ├─ features/
│  │  ├─ auth/
│  │  ├─ pos-import/     upload, preview, apply, history, held lines, mismatches
│  │  ├─ products/       search, detail, product list import
│  │  ├─ stock/          quick count, write-off
│  │  ├─ alerts/         urgent, low stock, check count, slow movers
│  │  ├─ to-order/
│  │  └─ summary/
│  ├─ i18n/ (th.ts, en.ts)
│  └─ components/
├─ supabase/
│  ├─ migrations/        tables, RLS policies, views, functions
│  └─ functions/         morning-check (Edge Function)
├─ demo/                 demo product list and sample POS files
├─ prd.md  AGENTS.md  architecture.md  schema.md  implementation-plan.md  progress.md
```

## 6. PWA mechanics

`public/manifest.json` (minimal):

```json
{
  "name": "Store Stock Manager",
  "short_name": "Stock",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0f766e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- Register `/sw.js` on load. The service worker caches the app shell only. **Stock data is never served from cache as if it were fresh.**
- Android Chrome: install banner or ⋮ menu → Install app.
- iOS Safari only: Share → Add to Home Screen. Add an `apple-touch-icon`.
- Check: opens full screen, with the icon, no address bar.

## 7. Notifications

- **The in-app Alerts list is the main channel** and works on every device.
- **Push** uses Web Push. Android Chrome supports it. iOS supports it only on iOS 16.4+ and only after the app is added to the Home Screen and permission is granted. Treat push as a bonus.
- A scheduled Edge Function runs each morning, finds urgent items (prd.md rule 11), and sends one grouped notification per owner.

## 8. Security

- Only the public `anon` key is in the client. `service_role` lives only in Edge Function secrets.
- RLS on every table. Uploads, imports, orders, settings changes and the audit log are owner-only.
- All stock changes go through database functions that also write `audit_logs`.
- Uploaded files are parsed in the browser. Only normalized rows are sent, and the raw file is not stored.
- HTTPS only. No data in `localStorage` except the session and UI preferences.

## 9. Offline behavior

Search may use a cached product list. **Writes require a connection** and show a clear Thai message if offline. No silent queueing, to avoid double counting.

## 10. Performance targets

- Search results within 300 ms for at least 5,000 products (index on `name_th` and `item_code`).
- A one-day file (about 800 lines) previews in under 3 seconds and applies in under 10 seconds.
- A multi-day file (about 20,000 lines) applies in chunks in under 2 minutes, with a progress bar.

## 11. Backups and export

Supabase daily backups where the plan allows, plus the in-app CSV export so the owner is never locked in.
