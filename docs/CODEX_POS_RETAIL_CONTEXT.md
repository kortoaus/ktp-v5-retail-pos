# Codex POS Retail Context

Short re-entry map for `ktpv5-pos-retail`. This file intentionally avoids
duplicating the full product contract.

## KTPv5 Role And Boundaries

`ktpv5-pos-retail` owns the retail desktop POS product: an Electron till app and
its LAN-local server for a single store. Read this repo when work involves the
retail sale screen, cart/payment/refund/repay flows, shifts, cash in/out,
receipt or label printing, serial scale/scanner/customer-display hardware,
local POS cloud sync, or store-local item/hotkey/member data used by the till.

Upstream systems are the cloud API server, item server, CRM/member data, and
data/reporting server reached through cloud sync APIs. Downstream consumers are
the cashier-facing Electron renderer, the customer display window, local
PostgreSQL, receipt/label printers, scales, scanners, cash drawers, and the
cloud reporting pipeline after invoices and shifts sync up.

Keep these boundaries sharp:

- Electron main/preload owns native hardware and window access; renderer code
  stays a normal web app and uses `window.electronAPI` only.
- The local server is the offline-capable cache/proxy and sync point; reporting
  calculations belong upstream after sync, not in the till UI.
- Sale math, rounding, refund, repay, and voucher rules are centralized in the
  sale domain files and `docs/sale-domain.md`; do not duplicate them in screens.
- Local POS deployment is single-store/single-company. Do not widen tenant or
  cloud auth assumptions without checking the API/data-server contracts.
- Money, quantity, and percent values are integer-scaled at module boundaries.

Validation is package-specific: use `cd retail_pos_app && npm run build` for
Electron/UI changes, `cd retail_pos_server && npm run build` for local server
changes, and `cd retail_pos_server && npx prisma generate` after schema edits.
There is no configured test runner; server `npm test` is a stub.

## Canonical Docs

- `README.md` — product, architecture, app routes, API route map, features,
  permissions, hardware, and commands.
- `AGENTS.md` — repository rules for coding agents and maintainers.
- `retail_pos_app/AGENTS.md` — Electron app boundary rules.
- `docs/sale-domain.md` — sale/payment/refund/repay/shift/cloud-sync decisions
  D-1 ... D-38.
- `TEST_CHECKLIST.md` — manual regression checklist.

Historical/context-only docs live under `docs/outdated/`:

- `docs/outdated/refund-plan.md`
- `docs/outdated/eftpos-plan.md`
- `docs/outdated/linkly.md`
- `docs/outdated/socket-plan.md`
- `docs/outdated/retail_pos_app-Requests.md`
- `docs/outdated/retail_pos_app-external_device_plan.md`

Do not treat historical plans as current contracts unless the canonical docs or
live code agree.

## Repository Shape

Two independent Node projects share this repository but not package tooling:

- `retail_pos_app/` — Electron 40 app with React 19 renderer.
- `retail_pos_server/` — Express 5 + Prisma 7 + PostgreSQL LAN-local server.

Install, run, build, and package them independently. Prisma client is generated
into `retail_pos_server/src/generated/prisma`; imports use generated subpaths
such as `../generated/prisma/client`, not `@prisma/client`.

## Before Editing

1. Check `git status --short`; this repo often has active work.
2. Read root `AGENTS.md` and `README.md`.
3. Read `retail_pos_app/AGENTS.md` for Electron-side changes.
4. Read `docs/sale-domain.md` before sale, payment, refund, repay, shift, voucher, or cloud-sync changes.
5. Identify the owner boundary: renderer, Electron main/preload, local server, or cloud sync.

## Core Boundaries

- Renderer code must not import Electron, `fs`, `path`, or other Node APIs.
  Native access goes through `window.electronAPI`.
- IPC changes require the handler in `src/main/ipc/*.ts`, the preload bridge in
  `src/preload/index.ts`, and types in `src/preload/index.d.ts`.
- Customer display uses renderer `BroadcastChannel`, not Electron IPC.
- API calls from renderer belong in `src/renderer/src/service/*.service.ts`.
- Server `/api/*` handlers assume `terminalMiddleware` populated
  `res.locals.terminal`, `company`, `storeSetting`, and current `shift`.
- Receipt printing supports Raster Image and ESC/POS Command modes. Raster mode
  renders 576px canvases in the renderer, converts them to bounded ESC/POS
  raster slices in `libs/printer/escpos.ts`, then sends raw bytes to the
  configured receipt printer. Command mode builds native ESC/POS bytes for
  sale/refund/spend receipts and shift settlement Z-reports. Network printers
  still use the local server `/api/printer/print` TCP bridge; serial receipt
  printers use Electron main IPC `escpos:print`, keep a persistent SerialPort
  open, queue writes, and disconnect during app cleanup.
- Interface Settings save persists the app config and restarts the Electron app
  so scale, label, and ESC/POS printer lifecycle changes apply from a clean boot.
- Sale Screen cloud hotkeys use `CloudHotkeyViewerV2`: parent groups stay
  visible in an 8x2 paged group grid, while the selected group renders a 5x5
  paged item grid. Interactive cells are `div`-based rather than native
  buttons so HID barcode scanner keyboard input cannot activate focused
  controls.
- `MemberSearchModal` owns cashier-assisted CRM member signup. Search and QR
  member assignment still select existing members immediately, but creating a
  new member is OTP-gated: stage name/phone, send CRM SMS OTP, enter the
  customer-provided code, then select the created member returned by CRM.
- `useBarcodeScanner` is the single scanner boundary for serial scanner events
  and HID keyboard-emulated scans. It also updates `DeviceMonitorStore` with the
  last scanner payload so the bottom `DeviceMonitor` can show "Last Scan"
  globally. Do not add per-screen last-scan state unless the screen needs extra
  local presentation.

## Numeric And Date Rules

- Money is integer cents.
- Quantities/weights use `QTY_SCALE = 1000`.
- Percentages use `PCT_SCALE = 1000`.
- Use `decimal.js` in renderer for non-trivial math beyond add/subtract of
  already scaled integers.
- Renderer dates use `dayjs`/`libs/dayjsAU.ts`; server dates use
  `moment-timezone`/`libs/date-utils.ts`.
- Business timezone is `Australia/Sydney`.

## Sale Domain Guardrails

The invariant is:

```text
Invoice.total = linesTotal + rounding + creditSurchargeAmount
sum(payments.amount) == Invoice.total
```

There is no document-level discount. Discounts are line/item-level only.

Line price priority:

```text
unit_price_effective = unit_price_adjusted ?? unit_price_discounted ?? unit_price_original
```

Central files:

- `retail_pos_app/src/renderer/src/store/SalesStore.ts`
- `retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
- `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
- `retail_pos_app/src/renderer/src/libs/refund/`
- `retail_pos_server/src/v1/sale/sale.create.service.ts`
- `retail_pos_server/src/v1/sale/sale.refund.service.ts`
- `retail_pos_server/src/v1/sale/sale.repay.service.ts`
- `retail_pos_server/src/v1/sale/spend.create.service.ts`

PaymentModal guardrails:

- Tender entry order is voucher-first, cash-second, exact-last.
- User Voucher is shown for non-member carts; Customer Voucher placeholder is
  shown for member carts. They are mutually exclusive.
- Cash can follow voucher and absorb AU 5¢ rounding on the cash remainder.
  CREDIT/GIFTCARD are exact tenders and suppress rounding.
- Member changes while PaymentModal is open clear staged and committed payments.
- PaymentModal controls use div-based tap targets rather than `<button>` to
  avoid HID scanner Enter suffixes triggering focused controls.

Refund storage is split: `refund_row.total` is product only and
`refund_row.surcharge_share` is the refunded surcharge share. Use the D-26
remaining-based, last-refund drift-absorbing math in `docs/sale-domain.md`.

Repay creates a full refund plus replacement sale in one transaction. Code that
iterates `invoice.refunds` must filter by `type === "REFUND"` when it only
wants refund children, because repay also creates a child SALE.

## Cloud Sync

The POS server is a LAN-local cache/proxy:

- Down-sync: items, categories, brands, users, CRM members, hotkeys, posts, and
  item sheets.
- Item down-sync is intentionally allowlisted in
  `retail_pos_server/src/v1/cloud/cloud.migrate.service.ts`. Do not spread raw
  cloud item payloads into local `db.item.upsert`; the cloud item server may add
  fields before the local POS Prisma schema supports them.
- Catalog/report category fields from the cloud item server are not POS-local
  item fields. POS category migration continues to use the legacy category data
  and `ItemCategory` rows.
- `/api/hotkey/cloud` patches each hotkey key's item with active default price
  and current promo price data, trimmed to `prices[0]`, so the POS can display
  `$price/uom` on cloud hotkey item tiles.
- Up-sync: sale invoices, refunds, repay chains, spend invoices, closed shifts,
  and cash in/out where included in shift payloads.

`cloudId != null` means a local invoice/shift has been pushed. `cloud.sync`
sweeps `cloudId = null` rows in `id ASC` order and breaks on failures so parent
invoice dependencies are preserved. Sync is trigger-based: sale/refund/repay,
shift close, explicit cloud sync, and server boot. There is no cron.

## Verification

- App TypeScript/UI changes: consider `cd retail_pos_app && npm run build`.
- Server TypeScript changes: consider `cd retail_pos_server && npm run build`.
- Prisma schema changes: run `cd retail_pos_server && npx prisma generate`.
- There is no real test runner; server `npm test` is a stub.
