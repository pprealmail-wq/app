# schema.md — Tables, fields, and who did what

Version 0.2 · Last updated 2026-10-13 · PostgreSQL (Supabase)

Lock this before any code. If a field name changes here, change it in the code and in `prd.md` in the same commit.

Removed since v0.1: `suppliers`, `stock_batches`, `cost_price`, expiry fields, and waste value. The data has none of them.

## Conventions

- Primary keys are `uuid` (default `gen_random_uuid()`) unless stated.
- Every table has `created_at timestamptz default now()`.
- Quantities are `integer` (signed in `stock_movements`). Money is `numeric(12,2)`.
- `item_code` is `text`, never a number.
- No hard deletes. Use `is_active`.
- RLS is ON for every table below.

## users

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | equals Supabase Auth user id |
| name | text | display name |
| role | enum `owner` / `staff` | |
| is_active | boolean | default true |

## products

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_code | text UNIQUE NOT NULL | from `CF_ITEMID`, trimmed, leading zeros kept |
| name_th | text NOT NULL | indexed |
| name_en | text null | |
| unit_name | text | one unit per product, for example ลัง |
| category | text null | from `CF_ITEMGROUPL1_GROUPNAME`, prefix `สินค้ายกลัง*` removed |
| supplier | text null | optional free-text note |
| sell_price | numeric(12,2) null | latest non-zero `CF_TDUNITPRICE`, informational |
| barcode | text null UNIQUE | optional, unused in the MVP |
| low_stock_manual | integer null | owner override of the reorder point |
| on_hand | integer default 0 | cached sum of movements, changed only by database functions |
| last_sale_at | timestamptz null | updated by `apply_pos_import`, used for slow movers |
| source | enum `pos_import` / `product_list` / `manual` | how the product was created |
| is_active | boolean | default true |

## stock_movements

Every change of stock is one row. Never edited, never deleted. A correction is a new row.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| product_id | FK → products | |
| type | enum `sale` / `receive` / `opening` / `count_adjust` / `write_off` / `correction` | |
| quantity | integer | signed: positive adds, negative removes |
| source | enum `pos_import` / `product_list` / `manual` | |
| import_id | FK → pos_imports null | set for POS and product-list imports |
| receipt_no | text null | `CF_TRANNO` |
| line_no | integer null | position of the line inside the receipt |
| pos_opening | integer null | `CC_BEG`, kept only on the item's first line in the file |
| unit_price | numeric(12,2) null | informational |
| reason | text null | for write-off: `damaged` / `lost` / other |
| occurred_at | timestamptz | from `TRANDATE`, or now() for manual entries |
| created_by | FK → users | |
| created_at | timestamptz | |

Unique index on (`receipt_no`, `line_no`) where `receipt_no` is not null.

## pos_imports

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| filename | text | |
| date_from | date | earliest movement date in the file |
| date_to | date | latest movement date in the file |
| line_count | integer | |
| receipts_new | integer | |
| receipts_skipped | integer | already imported |
| products_created | integer | |
| held_lines | integer | |
| mismatch_count | integer | |
| status | enum `applied` / `partial` / `failed` | |
| uploaded_by | FK → users | |
| created_at | timestamptz | |

## pos_receipts

One row per receipt that has been applied. This is the double-counting guard.

| Field | Type | Notes |
|---|---|---|
| receipt_no | text PK | `CF_TRANNO` |
| kind | enum `sale` / `receive` | from the prefix `ORCM` / `IRNM` |
| receipt_date | date | |
| line_count | integer | |
| import_id | FK → pos_imports | |

## pos_held_lines

Lines that could not be applied. Nothing is silently dropped.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| import_id | FK → pos_imports | |
| receipt_no | text | |
| raw | jsonb | the normalized row |
| reason | text | `unknown_prefix` / `sign_mismatch` / `missing_code` / `missing_receipt` / `missing_date` / `bad_quantity` |
| resolved | boolean | default false |

## orders

The to-order list the owner marks as ordered. The app does not send orders anywhere.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_label | text | the category the list was grouped by |
| status | enum `draft` / `ordered` / `received` / `cancelled` | |
| ordered_at | timestamptz null | |
| created_by | FK → users | |

## order_items

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| order_id | FK → orders | |
| product_id | FK → products | |
| suggested_qty | integer | from prd.md rule 12 |
| ordered_qty | integer | what the owner actually ordered |

## push_subscriptions (not used; push dropped for now)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | FK → users | |
| endpoint | text UNIQUE | |
| keys | jsonb | |

## settings

Single row.

| Field | Type | Default |
|---|---|---|
| id | integer PK | always 1 |
| lead_time_days | integer | 2 |
| safety_days | integer | 3 |
| order_cover_days | integer | 7 |
| history_days | integer | 14 |
| min_history_days | integer | 7 |
| slow_mover_days | integer | 30 |
| language | text | `th` |

## audit_logs

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | FK → users | |
| action | text | for example `pos_import`, `product_list_import`, `count`, `write_off`, `edit_product`, `pin_override` |
| table_name | text | |
| record_id | uuid | |
| old_value | jsonb null | |
| new_value | jsonb null | |
| created_at | timestamptz | |

## Views

| View | Purpose | Access |
|---|---|---|
| `v_avg_daily_sales` | product_id, units sold in the last `history_days` ÷ days with at least one POS receipt in that window, plus `has_history` (at least `min_history_days` such days) | owner, staff |
| `v_reorder_point` | product_id, reorder point (`low_stock_manual` or rule 9) | owner, staff |
| `v_low_stock` | `on_hand <= reorder_point` and `reorder_point > 0` | owner, staff |
| `v_urgent` | rule 11 | owner, staff |
| `v_check_count` | `on_hand < 0`, or a POS mismatch not yet resolved | owner, staff |
| `v_slow_movers` | rule 13, with stock value at `sell_price` when known | owner, staff |
| `v_suggested_order` | suggested quantity per product, grouped by category (rule 12) | owner |
| `v_pos_mismatch` | product_id, app stock before the file, POS opening (`CC_BEG`), difference | owner |
| `v_weekly_summary` | best sellers, stockouts, slow-mover count, units sold vs received | owner |

## RLS summary

| Table | staff | owner |
|---|---|---|
| users | read self | read all, update |
| products | read | read, update (insert and stock fields only through functions) |
| stock_movements | read, insert only through functions | read |
| pos_imports / pos_receipts / pos_held_lines | none | all |
| orders / order_items | none | all |
| settings | read | update |
| audit_logs | none | read |
| push_subscriptions | own rows | own rows |

Stock tables are written only through database functions: `apply_pos_import`, `import_product_list`, `record_count`, `record_write_off`, `accept_pos_balance`, `correct_movement`. Each function writes the movement, updates `products.on_hand` and `last_sale_at`, and writes `audit_logs` in one transaction. `apply_pos_import` and `import_product_list` check that the caller is an owner.
