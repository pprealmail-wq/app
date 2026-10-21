# Store Stock Manager (สต็อกร้าน)

PWA for รุ่งเรืองพานิช: upload the daily POS file, stock updates (sales subtract, deliveries add).
Runs on Android and iOS (add to home screen). Thai first, English toggle.

## Run
```
npm install
npm test          # 16 rule checks + file reader tests
npm run build     # -> dist/
npm run dev       # http://localhost:5173
```
## Deploy (GitHub Pages)
1. Push to `main`. 2. Settings → Pages → Source: **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes.

## Demo logins
Owner PIN `1111` (upload, review, reset). Staff PIN `2222` (search and view only).

## Shared database (optional)
Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (GitHub repository variables) and the app shares data across phones with real owner/staff rules enforced by the database. Steps: `supabase/SETUP.md`. Without them, data stays on each device.

## Current limits
- Without the Supabase variables, data is stored on this device only (IndexedDB).
- No push notifications. Alerts, to-order list, count and write-off (M5) are not built yet.
- Never commit real POS files (`.gitignore` blocks .xls).

Docs: `docs/` (prd, AGENTS, architecture, schema, implementation-plan, progress).
