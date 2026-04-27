# Codex POS Retail Context

This document is a fast re-entry map for Codex when working on `ktpv5-pos-retail`.
Read it together with root `CLAUDE.md`, `README.md`, `retail_pos_app/AGENTS.md`, and `docs/sale-domain.md` before changing sale, payment, refund, shift, or printing logic.

## Repository Scope

This repo is one POS product made of two independent Node projects:

- `retail_pos_app/` — Electron desktop POS app.
- `retail_pos_server/` — LAN-local Express + Prisma + PostgreSQL server.

They do not share one package manager workspace. Install and run each project separately.

The product is deployed one store at a time. The local server is an offline-capable store cache/proxy and sync point; reports and broader analytics live in the cloud stack.

## Commands

App:

```bash
cd retail_pos_app
npm run dev
npm run build
npm run package:win
npm run package:mac
npm run package:all
```

Server:

```bash
cd retail_pos_server
npm run dev
npm run build
npm run start
npx prisma generate
npx prisma db push
```

Notes:

- There is no real test runner.
- Server `npm test` is a stub.
- App has one native dependency: `serialport@13.0.0`.
- Do not copy `node_modules` across machines or OSes. Run fresh install per OS.
- Prisma client output is `retail_pos_server/src/generated/prisma`.

## Product Shape

High-level flow:

```text
Electron main process
  -> serial / scale / label / app config IPC
  -> preload contextBridge
  -> React renderer POS UI
  -> LAN REST API
  -> local Express server
  -> local PostgreSQL
  -> cloud sync APIs
```

The renderer must remain web-like. Electron exists for native capabilities only:

- serial scales
- barcode/scale device channels
- label printing
- receipt printer / cash drawer support
- app config
- customer display window management

Renderer code must not import Electron, `fs`, `path`, or other Node APIs directly.

## App Architecture

Main process:

- `retail_pos_app/src/main/index.ts`
  - Creates the main POS window.
  - Creates a fullscreen frameless customer display on an external monitor when present.
  - Registers all IPC handlers.
  - Auto-connects the scale on app startup.
- `retail_pos_app/src/main/ipc/index.ts`
  - Registers app, config, serial, scale, and label handlers.
- `retail_pos_app/src/main/driver/`
  - Scale abstraction.
  - Includes `CasScale` and `DatalogicScale`.

Preload:

- `retail_pos_app/src/preload/index.ts`
- `retail_pos_app/src/preload/index.d.ts`

When adding or changing an IPC capability, keep these in sync:

- relevant handler in `src/main/ipc/*.ts`
- bridge in `src/preload/index.ts`
- type definitions in `src/preload/index.d.ts`

Renderer:

- Entry: `retail_pos_app/src/renderer/src/main.tsx`
- Router/root: `retail_pos_app/src/renderer/src/App.tsx`
- Uses `HashRouter` so packaged Electron `file://` builds work.
- `/customer-display` renders the customer display standalone.
- All other routes mount under:

```text
TerminalProvider
  -> ShiftProvider
    -> Gateway
      -> routes/layouts/screens
```

## App Routes

Main routes from `App.tsx`:

- `/`
- `/price-tag`
- `/server-setup`
- `/sale`
- `/manager/settings`
- `/manager/hotkey`
- `/manager/user`
- `/manager/invoices`
- `/manager/refund`
- `/manager/refund/:invoiceId`
- `/manager/cashio`
- `/manager/store`
- `/shift/open`
- `/shift/close`
- `/customer-display`

Manager and shift routes use `ManagerLayout`.

## App Gateway And API Client

Gateway:

- `retail_pos_app/src/renderer/src/components/Gateway.tsx`
- Requires server setup.
- Requires terminal registration.
- Shows device monitor when the app is usable.
- Relies on `TerminalProvider` and `ShiftProvider`.

Terminal setup:

- `retail_pos_app/src/renderer/src/contexts/TerminalContext.tsx`
- Reads server config from `window.electronAPI.getConfig()`.
- Calls `apiService.setBaseURL("http://host:port")`.
- Reads local network IP through `window.electronAPI.getNetworkIp()`.
- Sets the `ip-address` request header so server middleware can identify the terminal.
- Calls `/api/terminal/me`.

HTTP client:

- `retail_pos_app/src/renderer/src/libs/api.ts`
- Singleton axios wrapper.
- Normalizes responses to:

```ts
{ ok, status, msg, result, paging }
```

Service modules:

- `retail_pos_app/src/renderer/src/service/*.service.ts`

Keep renderer API calls inside service modules.

## Server Architecture

Entry:

- `retail_pos_server/src/index.ts`
  - Creates HTTP server.
  - Attaches Socket.IO.
  - Calls `setIO()`.
  - Starts on `process.env.PORT || 3000`.
  - On boot, triggers catch-up cloud sync for sale invoices and shifts.

Express app:

- `retail_pos_server/src/app.ts`
  - JSON limit: `1mb`.
  - CORS allows `Content-Type`, `Authorization`, and `ip-address`.
  - `/health`, `/clear`, `/ok`.
  - Mounts `terminalMiddleware` before `/api`.
  - Mounts `/api` router.
  - Converts `HttpException` to `{ ok: false, msg }`.

Important warning:

- `/clear` is a dev endpoint. Do not expose destructive reset behavior in production.

Terminal middleware:

- `retail_pos_server/src/v1/terminal.middleware.ts`
- Reads `ip-address` header, not socket remote IP.
- Finds `Terminal` by `ipAddress`.
- Loads hard-coded `Company id=1`.
- Loads hard-coded `StoreSetting id=1`.
- Loads current open `TerminalShift` for the terminal.
- Writes `res.locals.terminal`, `res.locals.company`, `res.locals.storeSetting`, and `res.locals.shift`.

Every `/api/*` handler assumes those locals exist.

Server router:

- `retail_pos_server/src/router.ts`

Mounted prefixes:

- `/api/cloud`
- `/api/terminal`
- `/api/shift`
- `/api/item`
- `/api/brand`
- `/api/hotkey`
- `/api/crm`
- `/api/user`
- `/api/printer`
- `/api/cashio`
- `/api/store`
- `/api/voucher`
- `/api/sale`

Module convention:

- `*.router.ts`
- `*.controller.ts`
- `*.service.ts`

## Auth And Permissions

Server auth is a bespoke token scheme, not practical JWT auth:

- Token shape: `userId%%%lastSignedAt`
- Header: `Authorization: Bearer <token>`
- Middleware: `retail_pos_server/src/v1/user/user.middleware.ts`
- Writes:
  - `res.locals.userId`
  - `res.locals.lastSignedAt`
  - `res.locals.user`
  - `res.locals.placedBy`

Route scopes are enforced through `scopeMiddleware(scope)`.

Known scopes:

- `admin`
- `interface`
- `user`
- `hotkey`
- `refund`
- `cashio`
- `store`
- `shift`
- `sale`

Users with `admin` scope bypass route scope checks.

## Local Database And Prisma

Server Prisma:

- `retail_pos_server/prisma/schema.prisma`
- `retail_pos_server/src/libs/db.ts`
- Uses `@prisma/adapter-pg` and `PrismaPg`.
- Adds `&uselibpqcompat=true` to `DATABASE_URL`.
- Generated client import path: `src/generated/prisma/client`.

Important models:

- `Company`
- `Category`
- `Brand`
- `Item`
- `ItemScaleData`
- `ItemCategory`
- `Price`
- `PromoPrice`
- `CloudHotkey`
- `CloudHotkeyItem`
- `Terminal`
- `Hotkey`
- `HotkeyItem`
- `StoreSetting`
- `User`
- `TerminalShift`
- `CashInOut`
- `SaleInvoice`
- `SaleInvoicePayment`
- `SaleInvoiceRow`
- `Voucher`
- `VoucherEvent`
- `DocCounter`

Single-store assumptions:

- `companyId=1`
- `StoreSetting.id=1`
- One local server per store.

## Numeric And Date Rules

Shared scale constants exist in both app and server:

- `MONEY_SCALE = 100`
- `QTY_SCALE = 1000`
- `PCT_SCALE = 1000`

Rules:

- Store money as integer cents.
- Store quantities/weights as integer thousandths.
- Store percentages as integer permille-style values where applicable.
- Use `decimal.js` in the renderer for non-trivial math beyond add/subtract of pre-scaled ints.
- Convert only at UI boundaries.

Dates:

- Renderer uses `dayjs` helpers, especially `libs/dayjsAU.ts`.
- Server uses `moment-timezone`, especially `libs/date-utils.ts`.
- Business timezone is `Australia/Sydney`.
- Do not mix date libraries inside the same module.

## Sale Domain Rules

Before changing sale/payment/refund/shift aggregation logic, read:

- `docs/sale-domain.md`
- `TEST_CHECKLIST.md`
- `retail_pos_app/docs/pricing_rules.md`
- `retail_pos_app/docs/shift_rules.md`

Core invariant:

```text
Invoice.total = linesTotal + rounding + creditSurchargeAmount
sum(payments.amount) == Invoice.total
```

There is no document-level discount. Discounts are item/line-level only.

Line price priority:

```text
unit_price_effective = unit_price_adjusted ?? unit_price_discounted ?? unit_price_original
```

Line total/tax:

```text
total = round(unit_price_effective * qty / QTY_SCALE)
tax_amount = taxable ? round(total / 11) : 0
net = total - tax_amount
```

Important sale files:

- `retail_pos_app/src/renderer/src/store/SalesStore.ts`
- `retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
- `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
- `retail_pos_app/src/renderer/src/libs/sale/payload.types.ts`
- `retail_pos_server/src/v1/sale/sale.create.service.ts`
- `retail_pos_server/src/v1/sale/sale.refund.service.ts`
- `retail_pos_server/src/v1/sale/sale.repay.service.ts`
- `retail_pos_server/src/v1/sale/spend.create.service.ts`

Payment rules:

- `PaymentModal/usePaymentCal.ts` is the central client calculation hook.
- Server revalidates money invariants.
- CREDIT payment amount is EFTPOS keyed amount and already includes surcharge.
- GIFTCARD behaves like credit without surcharge.
- CASH is aggregated into one payment in payload; change lives on invoice-level `cashChange`.
- AU 5-cent rounding applies only in cash-only settleable mode.
- Mixed tender and card-only payments are exact.
- SPEND invoices have zero total and no payments.

Refund/repay rules:

- Refund rows use positive amounts; invoice `type` carries direction.
- Surcharge refund is proportional.
- Repay creates a full refund plus a replacement sale in one transaction.
- Customer-voucher invoices may be blocked from offline refund/repay paths depending on server rules.

Serial rule:

- Sale serials use shift/day/type sequence semantics through `DocCounter`.

## Cart And Pricing

Cart store:

- `retail_pos_app/src/renderer/src/store/SalesStore.ts`
- Four independent carts.
- Each cart has its own member and lines.
- Normal items merge when item and price conditions match.
- Member changes recalculate existing lines.

Pricing docs:

- `retail_pos_app/docs/pricing_rules.md`

Item types:

- normal
- weight
- prepacked
- weight-prepacked

Pricing behavior:

- Original price is a snapshot.
- Discounted price is best available member/promo price when it beats original.
- Adjusted price is operator/manual/PP markdown override.
- Member/promo changes affect discounted price, not original snapshot.
- Prepacked label pricing can derive quantity from embedded label price.

## Printing And Hardware

Renderer printing code:

- `retail_pos_app/src/renderer/src/libs/printer/`
- Sale invoice receipt.
- Shift settlement receipt.
- ESC/POS helpers.

Label printing:

- `retail_pos_app/src/renderer/src/libs/label-builder.ts`
- `retail_pos_app/src/renderer/src/libs/label-templates.ts`
- Native send path goes through `window.electronAPI.printLabel`.
- `/price-tag` has Item mode and Item Sheet mode.
- Item Sheet mode:
  - Lists cloud label-update sheets from `/api/cloud/item-sheet/label-update`.
  - Loads rows with `/api/cloud/item-sheet/label-update/:id`.
  - Syncs items from cloud before printing.
  - Resolves queued rows with `POST /api/item/search/ids` instead of per-barcode
    lookups.
  - Splits labels into 70×30 and 70×90 batches; promo items use 70×90 when a
    70×90 printer is selected, otherwise they print as 70×30.
  - Sends print jobs sequentially: 70×30 first, then 70×90.
  - Stores printed sheet ids in localStorage per terminal id for UI badges.

Hardware capabilities:

- CAS scale.
- Datalogic scale/scanner.
- USB HID barcode scanner through keyboard emulation.
- ZPL label printer.
- SLCS/Bixolon label printer.
- ESC/POS receipt printer.
- Cash drawer kick through ESC/POS command.

IPC/native boundary:

- Renderer calls `window.electronAPI`.
- Main process owns serial ports and native device access.
- Keep `contextIsolation: true`.
- Do not enable `nodeIntegration`.

## Customer Display

Customer display:

- Main process opens a separate fullscreen window on the external monitor.
- It loads the same renderer bundle at `#/customer-display`.
- It does not go through the normal providers/gateway.

Inter-window communication uses `BroadcastChannel`, not Electron IPC:

- `pos-cart`
  - Main POS window to customer display.
  - Sends `{ carts, activeCartIndex, lineOffset }`.
- `pos-refresh`
  - Customer display or button to main POS window.
  - Signal to refresh customer data.
- `pos-customer-data`
  - Main POS window to customer display.
  - Sends `{ storeSetting, posts }`.

Relevant files:

- `retail_pos_app/src/renderer/src/hooks/useCartBroadcast.ts`
- `retail_pos_app/src/renderer/src/components/CustomerScreen.tsx`
- `retail_pos_app/src/renderer/src/components/CustomerIdleScreen.tsx`
- `retail_pos_app/src/renderer/src/App.tsx` (`CustomerDisplayBroadcast`)

## Cloud Sync Boundary

The POS server is a LAN-local cache/proxy.

Cloud down:

- items
- categories
- brands
- users
- CRM members
- hotkeys
- posts

Cloud up:

- completed sale invoices
- refunds
- shifts
- cash in/out where implemented

Important files:

- `retail_pos_server/src/libs/cloud.api.ts`
- `retail_pos_server/src/v1/cloud/cloud.migrate.service.ts`
- `retail_pos_server/src/v1/cloud/cloud.sync.service.ts`
- `retail_pos_server/src/v1/cloud/cloud.post.service.ts`

Cloud API auth:

- `libs/cloud.api.ts` sends `device-api-key` and `Authorization: Bearer dk_<API_KEY>`.

Sync state:

- Sale invoices and terminal shifts have `synced`/`syncedAt` style fields.
- Boot triggers catch-up sync.

## Response Shape

Server routes generally return:

```ts
{ ok: boolean; msg?: string; result?: T; paging?: PagingType | null }
```

Renderer API client normalizes this into:

```ts
{ ok, status, msg, result, paging }
```

Client code should check `res.ok`.

## Important First Files By Task

Server setup / terminal registration:

- `retail_pos_app/src/renderer/src/contexts/TerminalContext.tsx`
- `retail_pos_app/src/renderer/src/screens/ServerSetupScreen.tsx`
- `retail_pos_server/src/v1/terminal.middleware.ts`
- `retail_pos_server/src/v1/terminal/terminal.router.ts`

Sale screen:

- `retail_pos_app/src/renderer/src/screens/SaleScreen/index.tsx`
- `retail_pos_app/src/renderer/src/store/SalesStore.ts`
- `retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/*`

Payment/invoice payload:

- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
- `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
- `retail_pos_server/src/v1/sale/sale.create.service.ts`

Refund/repay:

- `retail_pos_app/src/renderer/src/screens/SaleRefundPickerScreen.tsx`
- `retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/`
- `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/`
- `retail_pos_app/src/renderer/src/libs/refund/`
- `retail_pos_server/src/v1/sale/sale.refund.service.ts`
- `retail_pos_server/src/v1/sale/sale.repay.service.ts`

Shift:

- `retail_pos_app/src/renderer/src/contexts/ShiftContext.tsx`
- `retail_pos_app/src/renderer/src/screens/OpenShiftScreen.tsx`
- `retail_pos_app/src/renderer/src/screens/CloseShiftScreen.tsx`
- `retail_pos_server/src/v1/shift/shift.service.ts`

Printing:

- `retail_pos_app/src/renderer/src/screens/PriceTagScreen.tsx`
- `retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTag.tsx`
- `retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx`
- `retail_pos_app/src/renderer/src/components/priceTags/SearchItemSheetList.tsx`
- `retail_pos_app/src/renderer/src/libs/printer/`
- `retail_pos_app/src/main/ipc/label.ts`
- `retail_pos_app/src/preload/index.ts`
- `retail_pos_app/src/preload/index.d.ts`
- `retail_pos_server/src/v1/item/item.search.*`

Cloud sync:

- `retail_pos_app/src/renderer/src/components/SyncButton.tsx`
- `retail_pos_app/src/renderer/src/service/cloud.service.ts`
- `retail_pos_server/src/v1/cloud/`
- `retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts`
- `retail_pos_server/src/libs/cloud.api.ts`

## Development Checklist

Before editing:

- Check `git status --short`; this repo often has active work in both app and server.
- Read root `CLAUDE.md`, root `README.md`, and this document.
- For sale/payment/refund changes, read `docs/sale-domain.md`.
- For Electron-side changes, read `retail_pos_app/AGENTS.md`.
- Identify whether the change belongs in renderer, main/preload IPC, local server, or cloud sync.

While editing:

- Keep renderer free of direct Electron/Node imports.
- Keep IPC handler, preload bridge, and preload types in sync.
- Keep API calls inside renderer service modules.
- Preserve `{ ok, msg, result, paging }` style server responses.
- Preserve integer money/qty/percent scales.
- Do not duplicate sale totals/tax/rounding logic outside `SalesStore`, `usePaymentCal`, payload builders, and server sale services.
- Revalidate sale/payment invariants server-side.
- Keep single-store assumptions explicit when touching terminal/company/store settings.

Before finishing:

- For app TypeScript/UI changes, consider `cd retail_pos_app && npm run build`.
- For server TypeScript changes, consider `cd retail_pos_server && npm run build`.
- After Prisma schema changes, run `cd retail_pos_server && npx prisma generate`.
- Do not run nonexistent tests as if they were meaningful.
- Mention any command that could not be run.
