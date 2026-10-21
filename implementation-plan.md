# implementation-plan.md — M0 to M7

> **Build status (14 Oct):** first build is local-first on GitHub Pages: React + esbuild, data in IndexedDB through `LocalRepo` (one place to swap for Supabase later). M0–M4 done and tested with the real file; push dropped; Supabase and multi-device realtime, M5 not built.

Version 0.2 · Last updated 2026-10-13

Small milestones. Each one runs, is tested with two accounts (owner and staff), is deployed, and is committed. Do not start the next milestone before the checks of the current one pass. The POS upload now comes early because it is the core of the app.

## Calendar (from the course)

| Date | Checkpoint |
|---|---|
| Wed 14 Oct | Weekly update 2 |
| Mon 19 Oct | Code freeze, feedback video, submission |
| Wed 21 Oct | Final presentation |

Only six days remain before code freeze. If time runs out, cut in this order: weekly summary, push notifications, realtime, CSV export. **Never cut RLS, the audit log, or the duplicate-receipt guard.**

## Milestones

### M0 — Scaffold, deploy, demo data
- Vite + React + TS app shell, Thai/English i18n skeleton, Supabase project connected.
- Deployed to a public HTTPS URL.
- Demo data prepared from the real sales files (see "Demo data" below).
- **Done when:** the URL opens on a phone and shows a Thai home screen.

### M1 — Auth and roles
- PIN login, `users` table with role, role-based menu (owner sees everything, staff sees Search, Alerts, Count, Write-off).
- Two test accounts: `owner`, `staff`.
- **Done when:** staff cannot open owner screens by typing the URL.

### M2 — Schema, rules, and checks
- Tables, RLS policies, views, and database functions from `schema.md`.
- Business rules as pure functions in `src/lib/rules/` with `runChecks()`.
- **No UI code in this milestone.**

`runChecks()` must log PASS or FAIL for at least:
1. A sale line with quantity 5 and sign −1 becomes a movement of −5. A stock-in line with quantity 182 and sign +1 becomes +182.
2. A receipt whose `receipt_no` is already known is skipped. Applying the same file twice changes nothing.
3. The item code `0001` stays `0001` after parsing (not `1`).
4. A line with a prefix other than `ORCM` or `IRNM` is held with reason `unknown_prefix` and is not applied.
5. A prefix and sign that disagree (for example `ORCM` with +1) is held with reason `sign_mismatch`.
6. A new product code is created with an `opening` movement equal to `CC_BEG`, then the line is applied: `CC_BEG 22`, sale 1 → `on_hand 21`.
7. The date `02/10/2569` converts to 2026-10-02 when `TRANDATE` is missing.
8. Average 6 per day, lead 2, safety 3 → reorder point 30. `on_hand 25` → in low stock.
9. Average 6, lead 2, cover 7, `on_hand 20` → suggested order `ceil(6 × 9) − 20 = 34`.
10. With only 5 days of history the product has no automatic reorder point and is not in low stock or slow movers.
11. App stock before the file is 10 while `CC_BEG` (POS opening) is 12 → listed as a mismatch of 2.
12. A product with `on_hand −3` appears under "check count" and is not clamped to 0.
13. A product with stock and no sale for 31 days (with 31+ days of history) is a slow mover.
14. A staff user calling `apply_pos_import` is rejected by RLS.
15. **Empty database + a sales file only:** products are created and `on_hand` is correct without any product list.

### M3 — Main screens per role
- Owner home: alerts summary, upload shortcut, to-order shortcut.
- Staff home: Search, Alerts, Count, Write-off.
- Product search (Thai name or item code) and product detail with stock and recent movements. Seed data included.
- **Done when:** both roles see their own home screen with seed data.

### M4 — POS upload (core)
- Read `.XLS`, `.xlsx` and `.csv`. Detect POS file vs product list from the headers.
- **Preview:** new receipts, skipped duplicates, products to create, held lines, mismatches. Apply only after the owner confirms.
- Chunked apply with a progress bar. Import history with counts.
- Held lines screen and mismatch screen (Accept POS balance / ignore).
- Optional product list import using the same aliases.
- **Done when:** uploading the real sample file changes stock on a second phone, and uploading it again changes nothing.

### M5 — Alerts, to-order, count, realtime
- Alerts: urgent, low stock, check count, slow movers.
- To-order list grouped by category with suggested quantity and mark-as-ordered.
- Quick count and write-off (staff and owner).
- Realtime: a change on one phone appears on another without refresh.
- **Done when:** two phones show the same stock after an upload, and the to-order list matches `v_suggested_order`.

### M6 — PWA install and push
- `manifest.json`, icons, `apple-touch-icon`, service worker (app shell only).
- Morning Edge Function and Web Push where supported.
- Installed on one iPhone and one Android phone.
- **Done when:** the app opens full screen from the home screen icon on both phones.

### M7 — Hardening (during testing)
- Weekly summary, CSV export, empty/error states, session lifetime on iOS, edge cases from real files.
- **Done when:** the pre-launch checklist below is fully ticked.

## Demo data

After the demo there is no original product list, so the demo must prove the app works without one.

- **Sales files:** the real exports the team has, used as daily uploads in date order.
- **Made-up product list** (`demo/products_demo.xlsx`), generated once from the real sales files:
  - every real product (code, name, unit, category);
  - extra invented slow-moving products in the same categories, so slow movers appear;
  - opening stock, using `CC_BEG` where it exists and plausible values elsewhere;
  - prices from the file where non-zero, plausible values elsewhere;
  - headers identical to the POS export, so the same importer reads it.
- **Two demo paths:** (a) upload the product list, then daily files; (b) empty database, daily files only. Both must end with correct stock.

## Pre-launch checklist (before the user installs)

- [ ] Installs on both iPhone and Android
- [ ] One account per real person, correct role, no shared logins
- [ ] Every cell of the permissions table in `prd.md` tested with the wrong role
- [ ] No secret keys in the client or the repo
- [ ] `runChecks()` all PASS on the live URL
- [ ] The real sample file imports, and importing it again changes nothing
- [ ] Empty, offline, wrong-PIN, and wrong-file states show clear Thai messages
- [ ] CSV export works
- [ ] One line in the app: who to contact and how to send a screenshot

## Risks

| Risk | Plan |
|---|---|
| ~~`IRNM` not deliveries~~ | Confirmed as deliveries. Other prefixes stay held. |
| ~~Quantity in pieces~~ | Confirmed cases. |
| Day-N openings may not equal day N-1 closing | Verify with more files; mismatches are listed, never auto-fixed. |
| A day is skipped | Stock is stale until uploaded. Alerts show "last upload: date". Multi-day files are supported. |
| Only one day of sample data | Averages need 7 days of history. Ask for more files, and use manual low-stock levels until then. |
| iOS push or session problems | The Alerts list carries everything. Test the session on iPhone early. |
| Very tight timeline | Cut order is listed at the top. |
