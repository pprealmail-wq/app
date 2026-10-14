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

## Current limits
- Data is stored on this device only (IndexedDB). Shared database for several phones is the next step (`src/lib/repo/localRepo.ts` is the single place to swap).
- No push notifications. Alerts, to-order list, count and write-off (M5) are not built yet.
- Never commit real POS files (`.gitignore` blocks .xls).

Docs: `docs/` (prd, AGENTS, architecture, schema, implementation-plan, progress).
