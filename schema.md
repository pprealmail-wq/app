# schema.md — Data model (as built, v0.3)

Last updated 2026-10-19. This file describes **what the app actually stores today**. Names here match `src/lib/rules/types.ts` and the `DbState` in `src/lib/repo/localRepo.ts`.

## Where the data lives

Two storage modes, one model. `LocalRepo` (`src/lib/repo/localRepo.ts`) is the only code that touches data, and every action becomes one `Change`.

1. **Shared database (Supabase / PostgreSQL)** when the build has `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Tables below, created by `supabase/migrations/001_init.sql`. All writes go through one function, `apply_change(change jsonb)`, in one transaction with row-level security checked for the signed-in user. Stock (`products.on_hand`, `last_sale_at`, `last_movement_at`) is kept only by a database trigger on `movements`; the app never writes it. Other phones reload when `data_version` changes (checked every 10 seconds and when the app comes to the front).
2. **This device only** (IndexedDB, key `db`) when those values are absent. Same entities as one JSON document. Used for the first release and for offline demos.

Database columns are the snake_case form of the field names below (`itemCode` is `item_code`). Text timestamps are stored as `timestamp` (store wall-clock time, no time zone). Ids are `uuid`. Sign-in uses Supabase Auth with the accounts `owner@store.local` and `staff@store.local`; `users.id` is the Auth user id and holds the role.

```
users, products, movements, receipts, imports, held, mismatches, audit, settings, data_version
```

## users
| Field | Type | Notes |
|---|---|---|
| id | string | `owner` or `staff` in the demo |
| name | string | display name |
| role | `owner` / `staff` | |
| pinHash | string | device-only mode: SHA-256 of `userId:pin`. Not used in the shared database (Supabase Auth holds the password) |
| isActive | boolean | |

## products
| Field | Type | Notes |
|---|---|---|
| id | string (uuid) | |
| itemCode | string | from `CF_ITEMID`, always text, leading zeros kept |
| nameTh | string | from `CF_ITEMNAME` |
| unitName | string | from `CF_UNITNAME` (mostly ลัง = case) |
| category | string or null | from `CF_ITEMGROUPL1_GROUPNAME`, prefix `สินค้ายกลัง*` removed |
| supplier | string or null | optional note (not in the POS file) |
| sellPrice | number or null | latest non-zero `CF_TDUNITPRICE`, informational |
| lowStockManual | integer or null | owner's reorder level; null = automatic |
| onHand | integer | sum of signed movements; negative is kept and flagged |
| lastSaleAt | string or null | store wall-clock `YYYY-MM-DDTHH:mm:ss` |
| lastMovementAt | string or null | last non-opening movement |
| source | `pos_import` / `product_list` / `manual` | how it was created |
| isActive | boolean | no hard deletes |

## movements
Every stock change is one row. Never edited or deleted.
| Field | Type | Notes |
|---|---|---|
| id, productId | string | |
| type | `sale` / `receive` / `opening` / `count_adjust` / `write_off` / `correction` | |
| quantity | integer | signed |
| source | `pos_import` / `product_list` / `manual` | |
| importId | string or null | |
| receiptNo, lineNo | string / integer or null | `CF_TRANNO` and line position |
| posOpening | integer or null | `CC_BEG`, kept only on the item's first line in the file |
| unitPrice | number or null | informational |
| reason | string or null | write-off: `damaged` / `lost` / `other`; count: `count`; `accept_pos_opening` |
| occurredAt | string | store wall-clock time, no time-zone conversion |
| createdBy, createdAt | string | |

## receipts
The double-counting guard. One row per applied POS receipt.
| Field | Type | Notes |
|---|---|---|
| receiptNo | string | `CF_TRANNO`; a receipt already here is skipped |
| kind | `sale` / `receive` | prefix `ORCM` = sale, `IRNM` = delivery |
| receiptDate | string | |
| lineCount | integer | |
| importId | string | |

## imports
| Field | Type |
|---|---|
| id, filename | string |
| kind | `pos` / `productList` |
| dateFrom, dateTo | string or null |
| lineCount, receiptsNew, receiptsSkipped, productsCreated, heldLines, mismatchCount | integer |
| uploadedBy, createdAt | string |

## held
Lines that could not be applied; nothing is silently dropped.
| Field | Type | Notes |
|---|---|---|
| id, importId, receiptNo, itemCode, nameTh, qty | string | |
| reason | `unknown_prefix` / `sign_mismatch` / `missing_code` / `missing_receipt` / `missing_date` / `bad_quantity` | |
| resolved | boolean | |

## mismatches
| Field | Type | Notes |
|---|---|---|
| id, importId, productId, itemCode, nameTh | string | |
| appBefore | integer | app stock before the file |
| posOpening | integer | `CC_BEG` for the file's period |
| resolved | boolean | accepted (writes a `count_adjust` movement) or ignored |

## audit
| Field | Type | Notes |
|---|---|---|
| id, userId, createdAt | string | |
| action | string | `pos_import`, `product_list_import`, `accept_pos_opening`, `accept_all_pos_opening`, `ignore_mismatch`, `dismiss_held`, `count`, `write_off`, `set_threshold`, `settings`, `clear_data` |
| detail | string | short text |

## settings (single object)
`leadTimeDays` 2 · `safetyDays` 3 · `orderCoverDays` 7 · `historyDays` 14 · `minHistoryDays` 7 · `slowMoverDays` 30. Only the owner can change them.

## Permissions (enforced in `LocalRepo`)
| Action | owner | staff |
|---|---|---|
| Read products, movements, alerts | yes | yes |
| Count, write off | yes | yes |
| Upload, preview, apply POS or product-list files | yes | no |
| Accept / ignore mismatches, dismiss held lines | yes | no |
| Set reorder level, change settings, clear data | yes | no |
| Imports, held lines, mismatches, to-order list, settings screens | yes | no |

## Derived values (computed, not stored)
Average daily sales, reorder point, urgent, low stock, slow mover and suggested order come from `src/lib/rules/insights.ts` and `metrics.ts`, measured from the latest imported receipt date.

## Shared database rules (as built, `supabase/migrations/001_init.sql`)
| Table | owner | staff |
|---|---|---|
| users, products, movements, receipts, imports, settings | read | read |
| held, mismatches, audit | read, write | no access (audit: can add own rows) |
| products | insert, update, delete | no |
| movements | insert | insert only `count_adjust` or negative `write_off`, as themselves, source `manual` |
| receipts, imports | insert (imports also delete) | no |
| settings | update | no |

- `receipts.receipt_no` is the primary key: the database itself refuses a receipt that was already applied.
- A signed-in person with no row in `users` sees nothing and can write nothing.
- No client may update `on_hand` or delete movements. Clearing demo data is `apply_change` with `clear_all`, owner only.
- `supabase/tests/rls_test.sql` checks every rule above (22 checks).
- Removed on purpose: suppliers table, batches, cost price, expiry (the POS file has none of them). Push subscriptions and orders are not built.
