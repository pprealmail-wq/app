# prd.md — Stock Manager for Rungruangpanich (รุ่งเรืองพานิช)

Version 0.2 · Last updated 2026-10-13 · Owner of this doc: team

> **[TBD]** = must be filled from the interview or the pilot. **[CONFIRM]** = an assumption read from the real POS file that the owner must confirm. Do not invent numbers.

## 1. What

A mobile-first PWA for a store that sells mostly by the case. The owner uploads **one POS export file per day**. That file both **subtracts sales and adds deliveries**, so stock stays current without typing. The app then warns about items that are running out and lists items that are not selling, and prepares a to-order list.

## 2. Why

- Stock is tracked in a spreadsheet updated by hand, and the store has hundreds of products (the one-day sample alone shows 472).
- Two costs the owner feels: running out of popular items, and money tied up in items that do not sell.
- The original idea included expired goods. **The POS data has no expiry dates**, so expiry tracking is removed. "Slow movers" replaces it (see rule 13).
- Past failures (from interview): **[TBD — last 3 times it went wrong, with baht amounts]**

## 3. The customer and the real data

Customer: รุ่งเรืองพานิช (Rungruangpanich), Chainat. One branch, one warehouse ("Main WareHouse").

Facts from the sample file (one day, 2 Oct 2026, saved as `.XLS` from the POS):

| Fact | Value |
|---|---|
| Lines / receipts | 769 lines in 83 receipts |
| Distinct products | 472 (22 categories) |
| Sales lines (receipt prefix `ORCM`, sign −1, customer "เงินสด") | 734 |
| Stock-in lines (receipt prefix `IRNM`, sign +1, customer = the store itself) | 35 (confirmed deliveries) |
| Units | 738 lines in ลัง (case), the rest ลูก, แพค, Pcs., มัด |
| Price on the line | on 375 of 769 lines (0 = missing); no cost price anywhere |
| Barcode / expiry / supplier | none in the file |
| POS opening balance (`CC_BEG`), on the item's first line | present |

Column mapping (all other columns are ignored):

| POS column | App field |
|---|---|
| `CF_ITEMID` | `item_code` (always read as text, keep leading zeros) |
| `CF_ITEMNAME` | `name_th` (trim spaces) |
| `CF_UNITNAME` | `unit_name` |
| `CF_ITEMGROUPL1_GROUPNAME` | `category` (remove the leading `สินค้ายกลัง*` when present) |
| `CF_TRANNO` | `receipt_no` (used to avoid counting a receipt twice) |
| `TRANDATE` | date of the movement (if missing, use `CF_TRANDATE` and subtract 543 from the Buddhist year) |
| `CF_TDBASEQUANTITY` × `CF_FSTOCKMAIN` | signed `quantity` |
| `CC_BEG` | `pos_opening` |
| `CF_TDUNITPRICE` | `sell_price` (0 means unknown) |

## 4. Who (roles)

| Role | Who | Device | What they need |
|---|---|---|---|
| `owner` | Store owner | Own phone, sometimes a computer | Upload the daily file, see alerts, get the to-order list, change settings |
| `staff` | Employee | Shared phone or tablet | Look up stock, do a quick shelf count, write off damaged or lost goods |

The owner is the main user. The `staff` role is there because the course needs two roles. **[TBD — confirm in interview who else touches stock]**

## 5. Core features (MVP)

1. **Daily POS upload** (`.XLS`, `.xlsx` or `.csv`). Preview first: new receipts, skipped duplicates, products to be created, held lines, mismatches. Then apply.
2. **Automatic product creation.** A product the app has never seen is created from the sales file itself (code, name, unit, category). A product list upload is therefore **optional**.
3. **Product list upload (optional, once).** Adds items that never appear in a sales file (slow items), opening stock, prices, and low-stock levels. Same column aliases as the POS file (see architecture.md).
4. **Search** by Thai name or item code, showing stock on hand and recent movements.
5. **Alerts list:** urgent (out or under one day left), low stock, "check count" (negative stock or POS mismatch), slow movers. Phone notification for urgent items where supported.
6. **To-order list** grouped by category, with a suggested quantity. Owner orders outside the app and marks it as ordered.
7. **Quick count** (type the counted number, the app records the difference) and **write-off** (damaged, lost, other).
8. **Weekly summary:** best sellers, items that ran out, slow movers, units sold vs received.
9. **Export to CSV** of products and movements.

## 6. Daily flow

1. Owner exports the day's file from the POS and uploads it.
2. App shows a preview. Owner taps **Apply**.
3. Sales are subtracted, deliveries are added, new products are created, and the POS balance is compared with the app's number.
4. Owner opens **Alerts** and, when it is time to order, **To order**.
5. Owner orders from suppliers by phone or LINE and marks the list as ordered.
6. Deliveries arrive and show up in the next day's file as stock-in lines. No separate entry is needed.

If a day is skipped, stock is stale until that day is uploaded. Files for several days can be uploaded in any order. Receipts already seen are skipped.

## 7. Permissions

| Action | staff | owner |
|---|---|---|
| Log in with own account | ✓ | ✓ |
| Search products, see stock and movements | ✓ | ✓ |
| See alerts and the slow-movers list | ✓ | ✓ |
| Quick count | ✓ | ✓ |
| Write-off | ✓ | ✓ |
| Upload POS file or product list | — | ✓ |
| Edit product, category, price, low-stock level | — | ✓ |
| View and mark the to-order list | — | ✓ |
| View weekly summary, import history, settings | — | ✓ |
| Correct a movement made by someone else | PIN | ✓ |
| Deactivate a product or user (soft delete) | — | ✓ |
| View audit log | — | ✓ |

`PIN` = the user re-enters their personal PIN. The change is written to `audit_logs` with their user ID.

## 8. Business rules (written down so the AI does not guess)

1. `products.on_hand` = sum of signed `stock_movements.quantity` for the product. It is updated only by database functions, in the same transaction as the movement.
2. **POS line to movement:** `quantity = CF_TDBASEQUANTITY × CF_FSTOCKMAIN`. Type by receipt prefix: `ORCM` = `sale`, `IRNM` = `receive`. The prefix and the sign must agree (true on all 769 sample lines). Any other prefix, or a mismatch, is **held** in `pos_held_lines` and not applied.
3. **No double counting:** if `receipt_no` is already in `pos_receipts`, the whole receipt is skipped.
4. **Match by `item_code`** (exact, trimmed, as text). No fuzzy matching on names. If the code is unknown, create the product. For a new product only, add an `opening` movement equal to `CC_BEG` of its first line in the file, then apply the line. The owner sees these in the preview and can untick them.
5. **Date:** use `TRANDATE`. If it is missing, use `CF_TRANDATE` (Thai format `dd/mm/yyyy`) and subtract 543 from the year when it is above 2400.
6. **Negative stock is not hidden.** Do not clamp to 0. A product with `on_hand < 0` appears in Alerts as "check count".
7. **POS opening check:** `CC_BEG` is the item's POS **opening balance** for the report. It is printed once, on the item's first line in the file (0 on its other lines); it is not a running balance. Compare the app's stock before the file with `CC_BEG`. Valid only if all the item's lines in the file are new and the app has no later movement. If different, list it as a mismatch. The owner can **Accept POS balance** (writes a `count_adjust` movement) or ignore it.
8. **Average daily sales** = units sold in the last `history_days` (default 14) ÷ the number of days in that window that have at least one POS receipt. If fewer than `min_history_days` (default 7) such days exist, the product has "not enough history" and no automatic level.
9. **Reorder point** = `low_stock_manual` if the owner set one, otherwise `ceil(avg_daily_sales × (lead_time_days + safety_days))` (defaults 2 and 3).
10. **Low stock:** `on_hand <= reorder_point` and `reorder_point > 0`.
11. **Urgent** (triggers a phone notification): `avg_daily_sales > 0` and (`on_hand <= 0` or `on_hand < avg_daily_sales`), meaning less than one day of sales left.
12. **Suggested order** = `max(0, ceil(avg_daily_sales × (lead_time_days + order_cover_days)) − on_hand)`, default `order_cover_days = 7`. Example: avg 6, lead 2, cover 7, on hand 20 → 6 × 9 − 20 = 34.
13. **Slow mover:** `on_hand > 0` and no sale in the last `slow_mover_days` (default 30), but only once the imported history spans at least that many days. Show the stock value at `sell_price` when it is known.
14. **To-order grouping** is by `category`. `supplier` is an optional free-text note on the product.
15. **Prices** are informational. `sell_price` = the latest non-zero `CF_TDUNITPRICE` for the item. No cost or profit is calculated.
16. **Count / write-off:** a count writes `count_adjust = counted − on_hand`. A write-off writes a negative `write_off` with a reason.
17. Nothing is hard-deleted. Products and users use `is_active = false`.

## 9. Out of scope (for the course)

- Expiry dates and batches (the data has none). Can be added later if the POS ever provides them.
- Barcode scanning (the data has no barcodes). The `barcode` field exists but is optional and unused in the MVP.
- Cost price, profit, and waste value.
- Live automatic POS integration. Daily file upload only.
- Automatic ordering or sending orders to suppliers, and supplier management.
- Multiple branches or warehouses.
- Undoing a whole import (corrections are made with new movements).

## 10. Demo data

After the demo there will be no original product list, so the real flow must work **without one**. For the demo:

- Several real sales files are used as daily uploads.
- A made-up **product list** is generated from the real sales files: all the real products, plus invented slow items in the same categories, opening stock, prices, and low-stock levels. It uses the same column aliases as the POS export, so one importer reads both.
- A test starts from an **empty database** and uploads only a sales file, to prove products are created automatically.

## 11. Success criteria

Baseline measured before install: **[TBD]**

| Measure | Before | Target |
|---|---|---|
| Time to see what needs ordering | [TBD min] | under 2 minutes |
| Daily stock update (export + upload + check) | [TBD min] | under 5 minutes |
| Stockout incidents on top sellers per 2 weeks | [TBD] | fewer than before |
| Slow movers found and units tied up | [TBD] | listed and reviewed weekly |
| Days with an upload, out of 14 | — | at least 10 |

## 12. Tech constraints

- PWA installable on iOS and Android from a public HTTPS URL.
- Free-tier backend (Supabase).
- Thai primary language, English labels as fallback.
- Personal PIN per user. No shared accounts.
- Small phone screen first. Reads `.XLS`, `.xlsx` and `.csv` in the browser.

## 13. Open questions (confirm with the owner)

1. ~~Are `IRNM` receipts deliveries?~~ **Confirmed.** Other receipt prefixes are still held, never applied.
2. ~~Cases or pieces?~~ **Confirmed: cases.**
3. ~~What does `CC_BEG` mean?~~ Answered by analysis of the real file: opening balance, first line of the item (see rule 7). Verify that day N's openings equal day N-1's closing stock when more files arrive.
4. Which POS report produces this file, and can it export several days or a date range at once?
5. Why is the price 0 on about half the lines? Which column is the real selling price?
6. Is the pack size inside the name (for example `*12`) important to the owner, or is the case the only unit?
7. How many staff touch stock, and on what device?
8. Do they order by category/brand, or by supplier? Does the owner use LINE?
