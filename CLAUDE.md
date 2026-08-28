# CLAUDE.md

KTP v5 **retail** POS: an Electron till (`retail_pos_app`) plus the LAN-local Express/Postgres
server (`retail_pos_server`) that backs it, deployed one pair per store.

## Project Role

This repo owns everything at a retail register: cart, payment, refund, repay, shift open/close,
cash in/out, receipts, price/weight labels, the customer display, and serial hardware.
It is **offline-first** — a sale completes and prints with the internet down. Reporting and
analytics live upstream, never here. Two upstream cloud services, both reached **only** by
`retail_pos_server` (the renderer never talks to either directly):

- **ktpv5-api-server** (`API_URL`) — catalogue down-sync (`/device/migrate/*`), invoice/shift
  up-sync (`/device/sync/retail/*`), label-update sheets. Invoices forwarded on to data-server.
- **ktpv5-crm-server** (`CRM_URL`) — members, customer vouchers, post feed.

## Repo Layout

```
retail_pos_app/        Electron 40 + React 19 till       → retail_pos_app/CLAUDE.md
retail_pos_server/     Express 5 + Prisma 7 + Postgres   → retail_pos_server/CLAUDE.md
ecosystem.config.js    PM2: runs retail-pos-server on PORT=2200
scripts/release-pos.sh + .github/workflows/build-windows.yml   → see Deployment
docs/  AGENTS.md  README.md  TEST_CHECKLIST.md                 → see Further Reading

The two share NO package.json/workspace/lockfile/tsconfig — install and run each independently.
```

## Commands

```bash
cd retail_pos_app     && npm run dev | build | package:win | package:mac
cd retail_pos_server  && npm run dev | build | start
npx prisma generate                 # → src/generated/prisma  (NOT node_modules)
npx prisma migrate deploy           # prod schema rollout (dev Postgres: docker compose up -d)
pm2 start ecosystem.config.js       # prod: "retail-pos-server", cwd ./retail_pos_server, PORT=2200
./scripts/release-pos.sh patch|minor|major   # ships a new till version to every terminal
```

`npm test` in the server is a **stub that exits 1**. Real tests exist (see Testing).

## Environment

App: no `.env`. Runtime config lives in `app-config.json` under Electron `userData`, written by
`ServerSetupScreen` / `InterfaceSettingsScreen`; `ELECTRON_RENDERER_URL` (electron-vite dev) is
the only env var main reads. Server (`retail_pos_server/.env`): `PORT`, `DATABASE_URL`, `API_URL`,
`CRM_URL`, `API_KEY`; `ITEM_URL` is declared and imported but never used — dead; `CRON_INSTANCE`
is no longer read anywhere — dead.

## Architecture

```
 Electron main — serialport 13 · scales · ESC/POS serial · ZPL/SLCS labels · app-config.json
        ▲▼ IPC via window.electronAPI (contextBridge preload)
 Renderer (React SPA, HashRouter)        BroadcastChannel     ┌──────────────────────────┐
   service/*.service.ts → libs/api.ts  ── pos-cart ─────────▶ │ Customer display window  │
   SalesStore (4 carts) · usePaymentCal ◀─ pos-refresh ─────  │ 2nd monitor, no preload  │
        │                               ── pos-customer-data▶ └──────────────────────────┘
        │ HTTP http://{host}:2200/api/* + header ip-address: <LAN IP>
        │ Socket.IO (same origin): cloud-sync-completed
        ▼
 retail_pos_server — Express 5 : 2200
   terminalMiddleware (ip-address → Terminal/Company/StoreSetting/Shift)
   /api/{sale,shift,item,crm,customer-voucher,cloud,printer,...}
   Prisma 7 (PrismaPg) ──▶ local PostgreSQL      ← SOURCE OF TRUTH
        │ libs/cloud.api.ts — Bearer dk_<API_KEY> + device-api-key (one key, both services)
        ├─▶ ktpv5-api-server  /device/migrate/* (catalogue down) · /device/item-sheet/… ·
        │                     /device/sync/retail/* (invoices+shifts up) ──▶ data-server
        └─▶ ktpv5-crm-server  /device/member/* · /device/customer-voucher/* · GET /api/post
```

Down-sync is **pull, explicit**: `POST /api/cloud/migrate/item` runs company → category → brand →
item → price → promo-price → barcode normalise → hotkey, then emits `cloud-sync-completed`.
Up-sync is **push, automatic, fire-and-forget**.

## Sale Domain

`docs/sale-domain.md` (D-1 … D-41) is the contract; `retail_pos_server/prisma/schema.prisma`
carries the same invariants as inline comments. Verified against code:

```
Invoice.total = linesTotal + rounding + creditSurchargeAmount    Σ payments.amount == total
Σ rows.total == linesTotal          Σ rows.tax_amount == lineTax
unit_price_effective = unit_price_adjusted ?? unit_price_discounted ?? unit_price_original
row.total = round(unit_price_effective * qty / QTY_SCALE)    // AU GST 10% inclusive:
row.tax_amount = taxable ? round(row.total / 11) : 0
```

- Money = integer cents; qty/weight ×1000; percent ×1000; convert only at the UI boundary.
  `InvoiceType`: `SALE | REFUND | SPEND`; `PaymentType`: `CASH | CREDIT | VOUCHER | GIFTCARD`. All
  amounts are **positive** — direction comes from `type`.
- **No document-level discount.** Discounts are item/line-level only (PromoPrice with a validity
  window, lowest-of-{level, promo}). Never reintroduce a `discounts: []` array.
- Surcharge lives **only** in `Invoice.creditSurchargeAmount`; a CREDIT `payment.amount` already
  includes it, and `surchargeTax = round(creditSurchargeAmount / 11)`. AU 5¢ rounding is
  cash-settled; CREDIT/GIFTCARD are exact tenders and suppress it.
- Refund storage is split — `refund_row.total` = product only, `refund_row.surcharge_share` =
  refunded surcharge — with drift-absorbing math: the last refund of a row takes the remainder.
  Repay = full refund + replacement SALE in one transaction; the replacement is a **child SALE**, so
  code walking `invoice.refunds` must filter `type === "REFUND"`. Repay is blocked if refund children
  exist, it's a different shift, >10 min old, or a customer voucher was used.
- Serial = `{company}-{shift}-{terminal}-{seq}` from `DocCounter`, resetting daily at a random
  101–999 start. Shift close recomputes every figure server-side from SQL — the client sends only
  `{ closedNote, endedCashActual }`.
- Two voucher systems, do not conflate: **user voucher** = staff daily allowance in the local
  `Voucher`/`VoucherEvent` tables; **customer voucher** = CRM-owned, POS keeps only a payment
  snapshot (`entityType: "customer-voucher"`, `entityId` = CRM id, `entityLabel` = CRM label).

## Offline & Sync

Local Postgres is the source of truth for anything the store creates; cloud reachability is never
on the critical path of a sale.

**Works offline:** sale / spend / refund / repay create, shift open+close, cash in/out, item and
barcode search, hotkeys, staff user vouchers, receipt and label printing, invoice search and
reprint.
**Hard-fails when the cloud is down** (deliberate — no queue, no cash fallback): customer voucher
lookup/issue/redeem, refused at the tender step (D-21); **refund of any invoice containing a
customer-voucher payment**, refused entirely; CRM member search and signup/OTP; catalogue
down-sync; post feed. `useServerHealth` polls `GET /ok` every 5 s for the
`DeviceMonitor` badge — that covers the local server only, not the cloud.

**Up-sync mechanics** (`retail_pos_server/src/v1/cloud/cloud.sync.service.ts`):
- `cloudId != null ⟺ synced`. There is no `synced`/`syncedAt` column. Sweep
  `WHERE cloudId IS NULL ORDER BY id ASC` and **break on first failure**, so refund/repay children
  never overtake their parent; a child whose parent lacks a `cloudId` also breaks.
  `originalInvoiceId` is resolved to the parent's cloud id before push; data-server upserts on
  `(deviceId, localId)`, so retries are idempotent.
- Triggers: sale/refund/repay create, shift close, cloud migrate, server boot. Module-level
  booleans prevent overlapping sweeps. **No scheduler.**
- Failures are silent — rows stay `cloudId = null` until the next trigger, with no alert, retry
  counter or backlog UI. `SELECT count(*) FROM "SaleInvoice" WHERE "cloudId" IS NULL` is the
  health check.

## Hardware

Paths relative to `retail_pos_app/src/`. Device config lives in `app-config.json`; saving
`InterfaceSettingsScreen` restarts the app so device lifecycles boot clean.

| Device | Transport | Code |
|---|---|---|
| CAS PD-II scale | serial, request/response (`0x57` → `STX…CR`) | `main/driver/CasScale.ts` |
| Datalogic scale + scanner | serial, streaming `CR` packets; `S11…` = weight, else barcode | `main/driver/DatalogicScale.ts` |
| HID barcode scanner | keyboard wedge, decoded from `e.code` (IME-safe), Enter suffix | `renderer/src/hooks/useBarcodeScanner.ts` |
| ESC/POS receipt, serial | persistent port + write queue, IPC `escpos:print` | `main/ipc/escpos.ts` |
| ESC/POS receipt, network | renderer → `POST /api/printer/print` → server TCP :9100 | `renderer/src/libs/printer/print.service.ts` + `retail_pos_server/src/v1/printer/printer.service.ts` |
| ZPL / SLCS labels (serial 115200/8/N/1 or TCP) | IPC `label:print`, never via the server | `main/ipc/label.ts` |

Cash drawer = ESC/POS kick `1b 70 00 19 fa` on the same transport (`libs/printer/kick-drawer.ts`).
Receipts render as `raster` (576 px canvas → `GS v 0` slices) or `escpos` (native commands) per
`config.devices.receiptPrintMode`; Korean encodes via `text:encode` (`cp949`/`euc-kr`).

## Device Auth

api-server and crm-server authenticate this POS with a device key. **Only `retail_pos_server`
holds it** — the Electron app has no cloud credential. It is a plain `API_KEY` in
`retail_pos_server/.env`, read at boot by `src/libs/constants.ts` and baked into both axios
instances in `src/libs/cloud.api.ts`; one key serves both services.
- Every cloud request sends **both** `device-api-key: <API_KEY>` and
  `Authorization: Bearer dk_<API_KEY>`. **`API_KEY` must therefore be the hex body WITHOUT the
  `dk_` prefix** — pasting the full `dk_…` key yields `Bearer dk_dk_…` → 401 on everything.
- **No provisioning, rotation, refresh or expiry handling exists anywhere in this repo.** Nothing
  reads api-server's `expiresAt`; the `DEVICE_KEY_EXPIRED` literal appears in zero files. On expiry,
  invoices silently accumulate with `cloudId = null` and CRM/voucher lookups fail at the tender step;
  the only fix is editing `.env` + `pm2 restart`. Treat rotation as a maintenance window.
- Local auth is far weaker and unrelated: `terminalMiddleware` trusts a client-supplied
  `ip-address` **header**, and `userMiddleware` accepts `Bearer <userId>%%%<timestamp>` unsigned
  and unexpiring — `Bearer 1%%%0` is admin. The LAN is the security boundary.

## Deployment & Auto-Update

**Server**: `tsc` → `dist/`, run under PM2 (`ecosystem.config.js` → `retail-pos-server`,
`cwd: ./retail_pos_server`, `npm run start`, `PORT=2200`). A Dockerfile exists but the `app` service
in `docker-compose.yml` is commented out — compose serves the dev Postgres only.
**App**: `./scripts/release-pos.sh patch|minor|major` must run from a clean `main`; it bumps
`retail_pos_app/package.json`, commits `Release vX.Y.Z`, tags and pushes both. The tag fires
`.github/workflows/build-windows.yml` (windows-2022, Node 22), which verifies tag == package
version, runs `package:win:publish`, and uploads the NSIS installer + `latest.yml` to a GitHub
Release (`kortoaus/ktp-v5-retail-pos`). **No tag push = no POS update.** No macOS workflow exists.
Terminals check **once at boot only**, auto-download, then restart-and-install with no prompt
(`retail_pos_app/src/main/updater.ts`) — a till that never restarts never updates, and one that
does may update mid-shift.

## Testing

No test runner is wired into either `package.json` (server `npm test` is a literal stub). Tests are
~9 `node:test` files, all pure functions with injected deps — none touch Postgres or hardware.
Coverage: sale points, doc counter, refund points, store label format, label layout. Colocated
`*.test.mjs` files run like the app example below.

```bash
cd retail_pos_server && npm run build && node --test dist/v1/sale/sale.points.test.js
cd retail_pos_app    && node --experimental-strip-types scripts/tests/invoice-search-scan.test.ts
```

Everything else rides on `TEST_CHECKLIST.md`, the manual regression script — run it before any
release touching sale, payment, refund, shift or printing. Typecheck is the real gate: `npm run
build` in each project, plus `npx prisma generate` after any schema edit.

## Conventions & Invariants

1. **Single store, single company.** `companyId = 1` and `storeSetting.id = 1` are hard-coded; do
   not widen tenancy without checking the api-server and data-server contracts.
2. **Prisma client is generated to `retail_pos_server/src/generated/prisma`**, never `@prisma/client`.
3. **Renderer is a plain web app** — no `electron`/`fs`/`path` imports; native access only via
   `window.electronAPI`. IPC changes touch handler + `preload/index.ts` + `preload/index.d.ts`.
4. **All renderer HTTP lives in `service/*.service.ts`** and targets only the local server; the raw
   `fetch` in `libs/printer/print.service.ts` (binary body) is the one sanctioned exception.
5. **Sale math has exactly three homes**: `SalesStore.helper.recalculateLine` (line),
   `PaymentModal/usePaymentCal` (payment/invariants), `libs/sale|refund/build-payload` (payload),
   with the server re-deriving canonically. Never duplicate totals/tax/rounding in a component.
6. Strict TypeScript, no `as any` / `@ts-ignore`; `serialport` (pinned 13.0.0) is the app's only
   native dependency. Dates: `dayjs` via `libs/dayjsAU.ts` in the renderer, `moment-timezone` via
   `libs/date-utils.ts` on the server (`Australia/Sydney`) — never mixed in one module.
   `name_en`/`name_ko` pairs are first-class; the on-screen keyboard does dubeolsik via `es-hangul`.
   Item down-sync is **field-allowlisted on purpose** in `cloud.migrate.service.ts` — the cloud item
   server outruns the local schema; never splat cloud payloads into `db.item.upsert`.

## Gotchas

- **Express route order in `sale.router.ts`**: `/latest` and `/:id/children` must stay declared
  before `/:id`. Same pattern in `cloud.router.ts` for `/item-sheet/label-update/printed`.
- **Scanner Enter suffix**: PaymentModal and `CloudHotkeyViewerV2` use `div` tap targets instead of
  `<button>` so a scan's Enter cannot activate a focused control. Intentional — do not "fix" it.
- **Cart state is not persisted.** `SalesStore` has no persist middleware, so a reload or crash
  loses all four carts — and `SyncButton` calls `window.location.reload()`.
- **`DATABASE_URL` must already contain a `?query`** — `libs/db.ts` blindly appends
  `&uselibpqcompat=true`. **`PORT` falls back to 3000**, not 2200, outside PM2. `docker-compose.yml`
  publishes Postgres on 5555 while `.env.example` says 5438. **`retail_pos_app/build/`** (the
  electron-builder icons) is deleted in the working tree though present in git HEAD — CI is
  unaffected, a local `package:win` is not.
- **Unused surface — do not assume it is live**: `GET /api/brand/*` and `GET /api/store/label` have
  no consumer here;  `decimal.js` is imported nowhere;
  `ITEM_URL` and `refreshToken` are written and never read.

## Further Reading

- `docs/sale-domain.md` — **read before touching invoice/payment/voucher/refund/repay/sync.**
  D-1 … D-41 with rationale. Largely accurate.
- `docs/linkly/` — Linkly EFTPOS TCP/IP integration reference (official-sources-only,
  built 2026-08-05; protocol, transactions, recovery, integration mapping). **Read before
  any card-payment integration work.** Nothing implemented yet; open design decisions in
  `06-integration-notes.md`.
- `docs/customer-voucher-system.md` — CRM voucher contract and failure scenarios. Accurate on
  ownership and idempotency, but its "HTTP Boundary" section overstates the local surface: only
  `GET /api/customer-voucher/valid` and `POST /api/customer-voucher/issue` exist as routes; `redeem`,
  `redeem/void` and `refund-issue` are server-internal calls from the sale/refund services.
- `docs/electron-auto-update.md` (release mechanics + `npm version` recovery — accurate) ·
  `docs/ktpv5-retail-system-overview-ko.md` (non-technical overview, Korean) · `TEST_CHECKLIST.md`
  (manual regression, Korean) · `docs/superpowers/{plans,specs}/` (design history) · `docs/outdated/`
  (dead plans, never a contract).
- `README.md` — product/feature/permission reference. Mostly accurate; its server route table
  omits `/api/customer-voucher`, its app route table omits `/barcode-print`.
- `AGENTS.md` + `retail_pos_app/AGENTS.md` — the Codex-era rules these files supersede; still
  substantially correct. Known drift: both claim "no test runner is configured" (~9 `node:test`
  files exist); the root router list omits `customer-voucher`;
  the app IPC table omits `ipc/escpos.ts` and `ipc/text-encoding.ts`; `store.ts` is hand-rolled
  JSON, not `electron-store`. Do not edit these, `README.md`, `TEST_CHECKLIST.md` or `docs/*` as a
  side effect of code work — update them deliberately, or record the drift here.
