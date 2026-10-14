# AGENTS.md — Standing rules for the AI

Paste this into System Instructions at the start of every AI Studio session. Project: Stock Manager for Rungruangpanich (see prd.md). Version 0.2.

## Source of truth

- `prd.md` decides behavior. `schema.md` decides table and field names. `architecture.md` decides stack and structure. `implementation-plan.md` decides what to build now.
- Follow `schema.md` exactly. Do not rename, add, or remove fields without asking first.
- Work on **one milestone at a time**. Do not start the next one.
- If something in `prd.md` is ambiguous or marked **[CONFIRM]**, list it at the end of your answer. Do not guess silently.

## Facts about the data (do not contradict)

- The input is a daily POS export (`.XLS`, `.xlsx` or `.csv`) with columns like `CF_ITEMID`, `CF_ITEMNAME`, `CF_UNITNAME`, `CF_ITEMGROUPL1_GROUPNAME`, `CF_TRANNO`, `TRANDATE`, `CF_TDBASEQUANTITY`, `CF_FSTOCKMAIN`, `CC_BEG`, `CF_TDUNITPRICE`. The mapping is in `prd.md` section 3.
- The file has **no barcode, no expiry date, no cost price, no supplier**. Do not build features that need them.
- `ORCM…` receipts are sales (sign −1). `IRNM…` receipts are stock-in (sign +1). Any other prefix is held, not applied.
- Some headers repeat (for example `SYSITEMID` twice) and some columns are empty. The parser must not crash on either. Ignore columns the mapping does not name.
- Do not invent the meaning of unknown columns such as `CF_TDORDINARY`.

## Hard rules (security and multi-user)

- NEVER put a `service_role` key, admin token, or password in client code. Only the public `anon` key may appear in the browser.
- Every table has **row-level security ON**. Write the policy in the same change as the table.
- Roles come from `users.role` (`owner` or `staff`) and are checked by RLS, not only by hiding buttons.
- Every insert, update, import, or correction also writes an `audit_logs` row (user_id, action, old_value, new_value).
- No DELETE on core tables. Use `is_active = false`.
- Stock is changed **only** by inserting a `stock_movements` row and updating `products.on_hand` in the same database transaction. Never edit `on_hand` directly.
- Only the owner can upload files, edit products, or see imports and orders. Enforce in RLS, not in the UI.
- Never log PINs, tokens, or uploaded file contents to the console.

## Data handling rules

- **Read every cell as text** when parsing files. `item_code` must never become a number (`0001` must stay `0001`).
- Trim spaces on codes, names, units and categories.
- Match products by exact `item_code` only. Never fuzzy-match names.
- Skip a receipt whose `receipt_no` is already in `pos_receipts`. Importing the same file twice must change nothing.
- Never drop a line silently. A line that cannot be applied goes to `pos_held_lines` with a reason.
- Do not clamp stock to 0. Negative stock is shown as "check count".
- Dates: use `TRANDATE`. If only a Thai date is available, subtract 543 from years above 2400. Display in Asia/Bangkok.
- Large files are sent to the database in chunks of whole receipts. Because of the duplicate check, a retry is safe.

## Conventions

- Language: TypeScript, React, esbuild (no Vite). Keep functions small and pure where possible.
- Business rules (POS parsing, signed quantity, reorder point, suggested order, slow movers, mismatch check) live in `src/lib/rules/` as **pure functions with no UI and no database calls**, so `runChecks()` can test them.
- All user-facing text is Thai first, from `src/i18n/th.ts`, English from `src/i18n/en.ts`. No hardcoded strings in components.
- Quantities are integers. Money (`sell_price`) is `numeric(12,2)`, never a float.
- Big tap targets (at least 44px). Primary actions reachable with one thumb.
- Every screen needs three states: loading, empty, error. Messages are in Thai and say what to do next.
- Column names accepted by the importers live in one file, `src/lib/csv/aliases.ts`. Do not scatter header names through the code.

## Definition of done (per milestone)

- Tested with **two accounts of different roles** in two browsers (owner and staff).
- Works installed on a phone. No console errors.
- `runChecks()` all PASS on the deployed URL, not only locally.
- No secret keys in the repo (search before every push).
- `progress.md` updated. If `prd.md` changed, the other five docs are updated in the same commit.

## Do not

- Do not generate the whole app in one go.
- Do not add libraries without saying why in `architecture.md`.
- Do not add features listed under "Out of scope" in `prd.md`.
- Do not "fix" a failing check by changing the check. Fix the code or ask.
- Do not assume a product list exists. The app must work from an empty database plus a sales file.
