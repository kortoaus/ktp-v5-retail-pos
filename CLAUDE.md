# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Monorepo with two independent Node projects that talk over LAN REST + Socket.IO:

- `retail_pos_app/` — Electron 40 desktop POS (React 19 renderer + main process for serial/hardware).
- `retail_pos_server/` — Express 5 + Prisma 7 + PostgreSQL backend serving a single store.

They do NOT share a `package.json` or workspace tooling. Install and run each project independently.

`README.md` at repo root is authoritative for product features, routes, permission scopes, hardware list, and API surface. Read it before planning non-trivial changes. `retail_pos_app/AGENTS.md` contains hard rules for the Electron side.

## Commands

### App (`retail_pos_app/`)

```bash
npm run dev              # electron-vite dev with HMR
npm run build            # electron-vite build → out/
npm run package:win      # NSIS installer (x64)
npm run package:mac      # DMG (x64 + arm64, unsigned — mac.identity: null)
npm run package:all      # Both
```

Native modules (`serialport` 13.0.0 — the ONLY native dep) rebuild per-OS via `postinstall` → `electron-builder install-app-deps`. Never copy `node_modules` between machines; always `npm install` fresh. Windows builds need VS Build Tools + Python 3.

### Server (`retail_pos_server/`)

```bash
npm run dev              # nodemon on src/index.ts
npm run build            # tsc → dist/
npm run start            # node dist/index.js
npx prisma generate      # → src/generated/prisma
npx prisma db push       # apply schema to DB without a migration
```

Prisma client is generated into `src/generated/prisma` (not `node_modules/@prisma/client`). Uses `PrismaPg` adapter with `DATABASE_URL` + `&uselibpqcompat=true`. Migrations live in `prisma/migrations/`.

No test runner is configured in either project (`npm test` in the server is a stub).

### Process management

`ecosystem.config.js` (PM2) at repo root runs the server on port 2200 in production.

## Architecture

### Electron boundary (`retail_pos_app`)

Electron exists **only** for SerialPort + external-monitor access. The renderer must be buildable as a normal SPA:

- Renderer MUST NOT import `electron`, `fs`, `path`, or any Node API. All native access goes through `window.electronAPI` exposed via `contextBridge` in `src/preload/index.ts`.
- All serial/scale/label IPC handlers live in `src/main/ipc/*` and are registered by `registerAllHandlers()` in `src/main/ipc/index.ts`. Adding an IPC channel means touching three files in sync: the handler in `src/main/ipc/*.ts`, the bridge in `src/preload/index.ts`, and types in `src/preload/index.d.ts`.
- `src/main/index.ts` creates two `BrowserWindow`s: the main window and a fullscreen frameless customer-display window on the external monitor (if present). The customer window loads the same bundle at hash route `#/customer-display`.
- Scale drivers (`src/main/driver/`) have a `BaseScale` interface with `CasScale` and `DatalogicScale` implementations; `autoConnectScale()` runs at app start.

### Renderer app structure

Entry is `src/renderer/src/App.tsx`. Routing uses `HashRouter` (required so Electron `file://` works after build).

- `/customer-display` renders `CustomerScreen` standalone (no providers, no gateway).
- All other routes mount under `<TerminalProvider><ShiftProvider><Gateway>`. `Gateway` enforces server-setup + terminal registration + shift scope. Manager routes are wrapped in `ManagerLayout`.
- Cart state is a single Zustand store (`src/renderer/src/store/newSalesStore.ts`) with 4 independent carts, each with its own member and lines. Line math helpers (merge detection, recompute after member change, reindex) live in `newSalesStore.helper.ts`.
- Money/qty/percent all use integer-scaled representations: `MONEY_SCALE = 100`, `QTY_SCALE = 1000`, `PCT_SCALE = 1000` (see `libs/constants.ts`). Never use raw floats; use `decimal.js` for anything beyond add/subtract of pre-scaled ints.
- Sale math pipeline in `libs/sale/`: `calc-sale-totals.ts` → `finalize-lines.ts` → `calc-payments.ts` → `build-payload.ts`. AU 5¢ rounding happens in `calcDocumentAdjustments`.
- Receipt rendering in `libs/printer/` composes a 576px canvas and sends ESC/POS to the receipt printer. Cash-drawer kick is a separate ESC/POS command. Label printing (ZPL + SLCS/Bixolon) goes through `libs/label-builder.ts` + `label-templates.ts`.
- HTTP client is a single axios singleton (`libs/api.ts`) with a bearer-token interceptor and a fixed `{ ok, result, paging, msg }` response envelope. `setBaseURL()` is called at setup; `setHeader('ip-address', …)` is set by the terminal context so the server's middleware can identify the terminal.

### Inter-window communication

Main ↔ customer display uses `BroadcastChannel` (NOT IPC):

| Channel             | Direction              | Payload                                  |
| ------------------- | ---------------------- | ---------------------------------------- |
| `pos-cart`          | Main → Customer        | `{ carts, activeCartIndex, lineOffset }` |
| `pos-refresh`       | Customer/Button → Main | signal only                              |
| `pos-customer-data` | Main → Customer        | `{ storeSetting, posts }`                |

`useCartBroadcast` in the main window publishes every cart-state change; `CustomerDisplayBroadcast` (in `App.tsx`) fetches cloud posts + storeSetting and replies on `pos-refresh`.

### Server structure (`retail_pos_server/src/`)

- `index.ts` → boots HTTP + Socket.IO on the same port. `libs/socket.ts` holds the global `io` via `setIO()`.
- `app.ts` → Express wiring. Order matters: JSON/cors/logging/health/debug routes first, **then** `terminalMiddleware`, **then** `/api` router, **then** error handler. The `/clear` endpoint wipes transactional tables for dev; do not expose in prod.
- `v1/terminal.middleware.ts` identifies the terminal by the `ip-address` header (not IP from connection — from explicit header set by the client), loads Company id=1, StoreSetting id=1, and the open TerminalShift, then stashes them on `res.locals`. **Every `/api/*` handler assumes `res.locals.terminal/company/storeSetting/shift` are populated.**
- `router.ts` mounts domain modules under `/api/{terminal,shift,item,brand,hotkey,crm,user,sale,printer,cashio,store,cloud}`. Each module is a folder with `*.router.ts` + `*.controller.ts` + `*.service.ts`. Sale has split create/query/refund services; Cloud has migrate/sync/post sub-services.
- Cloud sync (`v1/cloud/cloud.sync.service.ts`) posts completed invoices and closed shifts to an upstream cloud API via `libs/cloud.api.ts`. `synced`/`syncedAt` flags on the records track state.
- Auth is a bespoke `userId%%%` token scheme (no JWT in practice despite `jsonwebtoken` being in deps). Permission scopes (`admin, interface, user, hotkey, refund, cashio, store, shift`) are enforced per-route; `userId=1` (admin) bypasses scope checks.
- Single-company assumption: `companyId=1` and `storeSetting.id=1` are hard-coded. This POS is deployed one-per-store.

### Server ↔ cloud

The server is a LAN-local cache/proxy of a cloud system. Data flows:

- **Down**: Items, categories, brands, users, CRM members, hotkeys are migrated/synced from the cloud into local Postgres (see `cloud.migrate.service.ts`).
- **Up**: Sale invoices, refunds, shifts, cashio are created locally first (offline-capable), then pushed via `cloud.sync.service.ts`. Reporting lives in the cloud — not in this POS.

## Conventions & Gotchas

- Strict TypeScript in all three tsconfigs (`tsconfig.node.json` for main+preload, `tsconfig.web.json` for renderer, server's own `tsconfig.json`). Do not silence types with `as any` / `@ts-ignore`.
- `BroadcastChannel` (not Electron IPC) is the correct transport between main and customer windows — they're separate OS-level displays but the same renderer bundle.
- Prisma client lives at `src/generated/prisma`. Import from there, not `@prisma/client`.
- All shift and invoice monetary fields are stored **in cents** (Int). Convert at the UI boundary only.
- Dates use `dayjs` in the renderer (via `dayjsAU.ts`) and `moment-timezone` (AU/Sydney) on the server. Don't mix libraries in the same module.
- Korean + English are first-class: model fields use `name_en` / `name_ko` pairs. The on-screen keyboard supports dubeolsik Hangul via `es-hangul`.
- POS math and cart mutations are centralized in the Zustand store + `libs/sale/` helpers. Do not duplicate totals/tax/rounding logic in components.
- When users write in Korean, reply in English (per global instruction).
