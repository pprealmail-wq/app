# progress.md — Done, broken, changed

Last updated 2026-10-14

## Evidence checklist (submission requirements)

- [ ] Real, independent payer, payment slip (> $15 ≈ ฿500) with date and what they bought
- [ ] Interview video, with consent on camera
- [ ] 6 .md files in the GitHub repo (v0.2 drafts exist, see below)
- [ ] Public HTTPS URL that installs as a PWA
- [ ] Demo account per role (`owner`, `staff`)
- [ ] 1–2 weeks of real use, `audit_logs` showing daily activity
- [ ] Feedback video from the user
- [ ] Slides for 21 Oct
- [x] Real POS sample file received from the customer (one day, 2 Oct 2026)

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| M0 Scaffold + deploy + demo data | Done (build); deploy workflow ready | GitHub Pages workflow written, not yet run. Demo product list waits for more sales files |
| M1 Auth + roles | Done (local) | PIN login, owner/staff guards in `LocalRepo` |
| M2 Schema + rules + checks | Done | 16 checks pass |
| M3 Main role screens | Partly | Home, search, detail. Alerts screens in M5 |
| M4 POS upload (core) | Done | Real file: 83 receipts, 472 products, 0 held, 0 mismatches; re-upload adds nothing |
| M5 Alerts, to-order, count, realtime | Not started | |
| M6 PWA install + push | PWA done, push dropped | Manifest, service worker, icons. Not yet tested on real phones |
| M7 Hardening | Not started | |

## Baseline (measure before the user installs)

| Measure | Before |
|---|---|
| Time to see what needs ordering | [TBD] |
| Daily stock update time | [TBD] |
| Stockout incidents on top sellers in the last 2 weeks | [TBD] |
| Slow movers and units tied up | [TBD] |

## Weekly entries

## Week 1 — 7 Oct

### Done
- Product idea defined: stock manager for a convenience store, owner as the main user.
- Daily workflow and flowchart worked out.
- First six docs drafted (v0.1).
- Presentation deck drafted.

### Measured
- Nothing measured yet. No real use so far.

### Broken / blocked
- Interview video, payment slip, and baseline numbers not done.
- Did not know whether the store had a POS that exports sales.

## Week 2 — 13 Oct

### Done
- Received a real POS export from the customer (รุ่งเรืองพานิช, one day, 769 lines, 83 receipts, 472 products).
- Read it and rewrote the plan around what it really contains (docs v0.2).
- Found that one daily file can both subtract sales and add deliveries.

### Measured
- Facts from the sample file only (not app results): 734 sales lines, 35 stock-in lines, 22 categories, price present on 375 of 769 lines, no barcode, expiry, cost or supplier.

### Broken / blocked
- Still unconfirmed with the owner: that `IRNM` means deliveries, whether quantity is in cases, and what `CC_BEG` means (open questions in prd.md).
- Only one day of sales data, so average-based alerts cannot be tested yet.
- Interview video, payment slip and baseline numbers still missing.

### Next week
- Ask the owner the open questions and collect more daily files.
- Generate the made-up demo product list from the real sales files.
- Build M0–M4 first, then M5.
- Update the deck: customer facts and the new solution (no expiry, no barcode, daily file upload).

## Change log (decisions that changed the docs)

| Date | Change | Why |
|---|---|---|
| 2026-10-14 | `CC_BEG` = opening balance on the item's first line, not a running balance | Probes on the real file; the running-balance reading gave 181 false mismatches |
| 2026-10-14 | IRNM = deliveries, quantity in cases (confirmed by the team) | Owner answers |
| 2026-10-14 | Push notifications dropped | Optional; not worth the iOS risk |
| 2026-10-14 | Built-in file readers and esbuild instead of SheetJS and Vite | npm registry unreachable in the build environment |
| 2026-10-14 | First build is local-first (IndexedDB), hosted on GitHub Pages | Only a GitHub account available; Supabase later |
| 2026-10-07 | Added `staff` role next to `owner` | Course needs at least two roles. To be confirmed in the interview. |
| 2026-10-07 | POS handled by daily file upload, not live sync | Simpler and works with most POS exports. |
| 2026-10-07 | In-app alerts are primary, push is a bonus | iOS push only works for installed PWAs on iOS 16.4+. |
| 2026-10-13 | Removed expiry tracking and batches | The POS data has no expiry dates. |
| 2026-10-13 | Removed barcode scanning | The POS data has no barcodes. Products are found by name or code. |
| 2026-10-13 | Removed cost, profit and waste value | The data has no cost price. Prices are informational only. |
| 2026-10-13 | Added "slow movers" | Replaces expired goods as the way to find money tied up in stock. |
| 2026-10-13 | One daily file updates sales and deliveries | `ORCM` lines subtract, `IRNM` lines add. Manual Receive removed. |
| 2026-10-13 | Products created automatically from the sales file | After the demo there is no product list, so it must be optional. |
| 2026-10-13 | Low-stock levels calculated from sales history | Setting them by hand for hundreds of products is not realistic. |
| 2026-10-13 | To-order list grouped by category, not supplier | The file has no supplier. Supplier is an optional note. |
| 2026-10-13 | Duplicate guard by receipt number, not by file name | Safer when the same day is exported twice. |
| 2026-10-13 | SheetJS replaces PapaParse | The real file is `.XLS`. |

## User-reported issues

| Date | Reported by | Issue | Status |
|---|---|---|---|
| — | — | — | — |
