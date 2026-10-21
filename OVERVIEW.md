# Store Stock Manager

A mobile-first web app (PWA) that helps **รุ่งเรืองพานิช (Rungruangpanich)**, a store that sells mostly by the case, keep stock under control from one daily POS file.

> Status: v0.3. First build runs (upload, search, roles, PWA). See the project README for how to run it. See [`progress.md`](progress.md).

## The problem

- Stock lives in a spreadsheet that is updated by hand, across hundreds of products.
- Popular items run out before the owner notices.
- Money is tied up in items that do not sell.

## The idea

The owner uploads **one POS export file per day**. That single file:

- **subtracts sales** (receipts starting `ORCM`),
- **adds deliveries** (receipts starting `IRNM`, still to be confirmed with the owner),
- **creates products** the app has never seen, so no product list is needed,
- **skips receipts it has already seen**, so uploading a file twice changes nothing.

The app then shows:

- **Alerts:** items that are out or nearly out, low stock, items that need a recount, and slow movers (stock that has not sold for 30 days).
- **To-order list:** grouped by category, with a suggested quantity based on recent sales. The owner orders by phone or LINE and marks the list as ordered.
- **Quick count and write-off** for fixing stock by hand.

## Who uses it

| Role | Can do |
|---|---|
| `owner` | Upload the daily file, see alerts, get the to-order list, change settings |
| `staff` | Look up stock, quick count, write off damaged or lost goods |

## Daily routine

1. Export the day's file from the POS (`.XLS`, `.xlsx` or `.csv`).
2. Upload it and check the preview.
3. Tap **Apply**.
4. Open **Alerts**, and **To order** when it is time to order.

## What is not included

- Expiry dates and batches, barcode scanning, and cost or profit, because the POS data has none of them.
- Live POS integration, automatic ordering, and multiple branches.

Full list: `prd.md`, section 9.

## Tech

- React + TypeScript + esbuild, installable as a PWA on iPhone and Android, hosted on GitHub Pages
- First build keeps data on the device (IndexedDB); Supabase is the planned shared backend
- Built-in readers for .XLS, .xlsx, .csv
- Thai first, English as fallback

Details: [`architecture.md`](architecture.md).

## The six docs

| File | What it is |
|---|---|
| [`prd.md`](prd.md) | What the app does, the real POS data, permissions, business rules, open questions |
| [`AGENTS.md`](AGENTS.md) | Standing rules for the AI (security, data handling, conventions) |
| [`architecture.md`](architecture.md) | Stack, data flow, file reading rules, folder structure, PWA |
| [`schema.md`](schema.md) | Tables, fields, views, row-level security |
| [`implementation-plan.md`](implementation-plan.md) | Milestones M0 to M7, `runChecks()` list, demo data, risks |
| [`progress.md`](progress.md) | Done, blocked, measured, change log |

**Order of authority:** `prd.md` decides behavior, `schema.md` decides names, `architecture.md` decides structure, `implementation-plan.md` decides what to build now. If one changes, update the others in the same commit.

## Using the docs with an AI

1. Paste `AGENTS.md` into the AI's system instructions.
2. Attach the other five files.
3. Ask for **one milestone at a time** from `implementation-plan.md`.
4. Test with two accounts (owner and staff) before moving on.

## Demo data

After the demo there is no original product list, so the app must work from an empty database plus a sales file. The demo uses:

- real daily sales files as uploads,
- a made-up product list generated from those files (real products plus invented slow movers, with the same column names as the POS export),
- two demo paths: with a product list, and without one.

See `implementation-plan.md`, "Demo data".

## Open questions for the owner

Answered: IRNM = deliveries, quantity in cases, `CC_BEG` = opening balance. Still open: which POS report makes the file and whether it exports date ranges; see `prd.md` section 13.

## Course timeline

| Date | Checkpoint |
|---|---|
| Wed 14 Oct | Weekly update 2 |
| Mon 19 Oct | Code freeze, feedback video, submission |
| Wed 21 Oct | Final presentation |

## Team

[Team name] · [Member names and roles]
