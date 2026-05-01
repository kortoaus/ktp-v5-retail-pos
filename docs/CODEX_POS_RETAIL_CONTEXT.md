# Codex POS Retail Context

Short re-entry map for `ktpv5-pos-retail`. This file intentionally avoids
duplicating the full product contract.

## Canonical Docs

- `README.md` — product, architecture, app routes, API route map, features,
  permissions, hardware, and commands.
- `AGENTS.md` — repository rules for coding agents and maintainers.
- `retail_pos_app/AGENTS.md` — Electron app boundary rules.
- `docs/sale-domain.md` — sale/payment/refund/repay/shift/cloud-sync decisions
  D-1 ... D-38.
- `TEST_CHECKLIST.md` — manual regression checklist.

Historical/context-only docs live under `docs/outdated/`:

- `docs/outdated/handover.md`
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
- Sale Screen cloud hotkeys use `CloudHotkeyViewerV2`: parent groups stay
  visible in an 8x2 paged group grid, while the selected group renders a 5x5
  paged item grid. Interactive cells are `div`-based rather than native
  buttons so HID barcode scanner keyboard input cannot activate focused
  controls.

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
