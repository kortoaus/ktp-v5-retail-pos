# AGENTS.md — ktpv5-pos-retail

Rewritten 2026-10-06 from a code survey (`main` = `7a97bb6`). Detailed, file:line-level reference:
`/Users/dev-m1/ktpv5/ktpv5-rooms/surveys/2026-10-06-pos-retail-reference.md` (raw survey: `2026-10-06-pos-retail.md` / `.json` beside it).
Subproject files: `retail_pos_server/AGENTS.md`, `retail_pos_app/AGENTS.md`. Workspace rules: `/Users/dev-m1/ktpv5/CLAUDE.md`.

## What this repo is

KTP v5 retail point of sale, one install per store:

- **`retail_pos_server`** — Express 5 + Prisma 7 + local Postgres, port 2200 under PM2. It holds the store's sales,
  shifts, cash in/out, vouchers and a down-synced catalog, and it is the **only** component that talks to the cloud
  (api-server + crm-server, via `src/libs/cloud.api.ts`).
- **`retail_pos_app`** — Electron 40 till (electron-vite; main / preload / React 19 renderer, HashRouter). Owns serial
  and TCP hardware (scale, ZPL labels, serial ESC/POS) and a second "customer display" window.
- Other LAN client of the same server (separate repo, read-only from here): `ktpv5-retail-runner` (checkout/order runner/scale).
  `ktpv5-pos-retail-android` (Fast Checkout tablet) was deleted 2026-10-06/07; its work was absorbed into Runner.

## How the two processes talk

- Renderer → server: HTTP `http://<config.server.host>:<port>/api/*` through `retail_pos_app/src/renderer/src/libs/api.ts`,
  called only from `src/renderer/src/service/*.service.ts` (exception: raw `fetch` in `libs/printer/print.service.ts`).
  `host/port` come from `userData/app-config.json` (`src/main/store.ts`), set on `/server-setup`.
- Every request carries header `ip-address` = the till's NIC IPv4 (IPC `app:get-network-ip`, set in
  `contexts/TerminalContext.tsx`). Staff calls add `Authorization: Bearer <staff session JWT>` issued by `GET /api/user/code` (T-12, 2026-10-08); the legacy `<userId>%%%<ts>` shape is still accepted while `STAFF_AUTH_ACCEPT` is unset/`both`.
- Server → clients: Socket.IO on the same port (`retail_pos_server/src/index.ts`), events `order:buckets`,
  `order:pending-count`, `order:new`, `cloud-sync-completed`. App listeners: `components/SyncButton.tsx`,
  `components/orders/OrderNotification.tsx`.
- Renderer → main: IPC through `window.electronAPI` (`src/preload/index.ts`, handlers `src/main/ipc/*.ts`).

## Commands that exist

| Where | Command | Notes |
|---|---|---|
| server | `npm run dev` / `npm run build` / `npm start` | nodemon `src/index.ts` / `tsc` → `dist/` / `node dist/index.js` |
| server | `npx tsc --noEmit` | typecheck (exit 0 on 2026-10-06) |
| server | `docker compose up -d` | dev Postgres `retail_pos_local_postgres` on host **:5555** |
| server | `npx prisma migrate dev` · `migrate deploy` · `generate` | no npm scripts for these; generated client is **committed** (`src/generated/prisma`) |
| server | `scripts/safe-reset.sh` | backup → `prisma migrate reset` → restore, for checksum drift |
| server | `npm test` | node:test over `src/**/*.test.ts` via ts-node transpile-only + offline preload (`scripts/test-offline.cjs`); 129 pass (2026-10-08) |
| app | `npm run dev` / `npm run build` | electron-vite |
| app | `npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false` (and `tsconfig.web.json`) | typecheck main+preload / renderer |
| app | `npm run test:zpl-font` · `test:label-core` · `test:scale-core` · `test:orders` | node:test; 85 · 298 · 36 · 97 pass (2026-10-06) |
| app | `npm run package:win` · `package:mac` · `package:all` | local installers; `package:win:publish` is for CI |
| root | `pm2 reload retail-pos-server` | the only PM2 app (`ecosystem.config.js`, sets `PORT=2200`) |
| root | `./scripts/release-pos.sh patch\|minor\|major` | clean `main` only; bumps app version, commits `Release vX.Y.Z`, tags, **pushes main + tag** |
| CI | `.github/workflows/build-windows.yml` | on tag `v*`: checks tag = app version, builds NSIS x64, publishes to `kortoaus/ktp-v5-retail-pos-releases` with secret `RELEASES_REPO_TOKEN`. No mac CI |
| root | `scripts/store-upsync-backlog.sh`, `scripts/remote-catalog-sync-verify.sh` | SSH ops scripts written for the 2026-07 cutovers; hosts in untracked `scripts/store-hosts.txt` |

Release state: latest tag `v1.8.3` (2026-09-29), `main` 10 commits ahead, version still 1.8.3. The updater feed moved to
the releases repo in `7a97bb6`; no tag carries it yet. Tills update only when a tag is published, once per app start.

## Server map (82 endpoints; mounts in `retail_pos_server/src/router.ts`)

Global: `express.json(1mb)` → `cors(*)` → logger → `/health` `/clear` `/ok` → **`terminalMiddleware`** → `/api`.

| Domain | Mounts (`/api/...`) | Auth beyond terminal |
|---|---|---|
| retail-pos | `sale`(8) `shift`(5) `cashio`(2) `voucher`(2) `hotkey`(4) `printer`(1) `terminal`(3) `user`(6) | sale/cashio/voucher: user+scope; shift open/close: `shift`; hotkey, printer: none |
| members | `crm`(7) `customer-voucher`(2) | crm: none; customer-voucher: `sale` |
| online-ordering | `order`(18) `stripe`(2) | `sale` (refund-requests POST: `refund_ticket`) |
| catalog | `item`(5) `brand`(2) `cloud`(6) `free-text-template`(3) | none |
| platform | `store`(3) + inline `/health` `/clear` `/ok` | store POST: `store` |

Data: one `prisma/schema.prisma`, 24 models / 8 enums, 65 migrations (last `20260901030313_add_sync_cursor`).
Single-tenant: `Company` and `StoreSetting` are always row `id: 1`.

## Conventions (with paths)

- Envelope `{ ok, msg, result, paging? }`. No helper: services build it, controllers `res.status(200).json(...)`;
  errors are thrown `HttpException` subclasses (`src/libs/exceptions.ts`) rendered by the handler in `src/app.ts`.
- `terminalMiddleware` (`src/v1/terminal.middleware.ts`) sets `res.locals.terminal/company/storeSetting/shift`.
  `userMiddleware` + `scopeMiddleware(x)` (`src/v1/user/user.middleware.ts`) set `res.locals.user/userId/placedBy`;
  `admin` passes all scopes. Scope list: `src/v1/user/user.scopes.ts` (`hotkey`, `interface` are not enforced server-side).
- Scales: money ×100 (cents), qty ×1000, pct ×1000 — `src/libs/constants.ts` in both subprojects.
- Time: server `momentAU()` in `src/libs/date-utils.ts` (moment-timezone); renderer `libs/dayjsAU.ts`. Australia/Sydney.
- Cloud calls only via `apiService` / `crmApiService` (`src/libs/cloud.api.ts`): headers `device-api-key: API_KEY` and
  `Authorization: Bearer dk_${API_KEY}`, 30 s timeout. Exception: `src/v1/cloud/cloud.post.service.ts` (raw axios,
  `ktpv5-company` header, no device key).
- Printing: ZPL labels and serial ESC/POS go renderer → IPC → main (`src/main/ipc/label.ts`, `escpos.ts`); network
  receipts go renderer → `POST /api/printer/print?ip=&port=` → server raw TCP (`src/v1/printer/printer.service.ts`).

## Danger zones

- **ip-address-only writes.** Routes with no user check that still write: `POST/DELETE /api/hotkey`, `POST /api/cloud/migrate/item`,
  `POST /api/cloud/item-sheet/label-update/:id/printed`, `POST /api/crm/member/*` (7), `POST/DELETE /api/free-text-template`,
  `POST /api/printer/print`. Any LAN host that sends a registered terminal IP passes.
- **Printer route = TCP relay.** `POST /api/printer/print` opens a socket to whatever `ip`/`port` (default 9100) the query
  names and writes the body (≤20 MB). Do not widen it; do not expose port 2200 beyond the store LAN.
- **Staff session (T-12, 2026-10-08).** `GET /api/user/code?code=` (terminal-only) returns the `User` row plus a signed HS256 `token`
  (`typ: staff`, exp ≤ 14 h; secret `STAFF_SESSION_SECRET`, random per boot when unset). `userMiddleware` verifies it and rejects
  archived users; `STAFF_AUTH_ACCEPT=both` (default) also accepts the legacy `<userId>%%%<ts>` token with one INFO line, `session` rejects it.
- **Socket.IO** has `cors origin *` and no auth middleware.
- **`src/libs/db.ts:6`** — `DATABASE_URL + "&uselibpqcompat=true" || ""`: the fallback is dead, an unset var becomes
  `"undefined&…"`, and the URL must already contain `?`. `.env.example` points at :5438 but compose serves :5555.
- **Env is never validated.** All vars default to `""` at import. `CRM_URL` is missing from `.env.example`;
  `ITEM_URL` is listed but unused. `PORT` falls back to 3000 outside PM2.
- **Upload is event-driven, not timed.** Invoices (`cloudId` null) and closed shifts go up only at boot, after
  sale/refund/repay, shift close, or the Sync button (`POST /api/cloud/migrate/item`). Failures are silent (row stays
  `cloudId = null`). Online orders: crm is polled every 30 s (`src/v1/order/order.pending-broadcaster.ts`).
- **Sale-core drift.** (Historical: the deleted `ktpv5-pos-retail-android` repo's `scripts/sync-sale-core.mjs` copied 15 files from
  `retail_pos_app/src/renderer/src` (sibling checkout); its `--check` failed on 6: `store/SalesStore.helper.ts`,
  `libs/sale/build-payload.ts`, `libs/sale/payload.types.ts`, `libs/sale/member-level-estimate.ts`, `libs/pp-barcode.ts`,
  `types/models.ts` at the 2026-10-06 survey.) `ktpv5-retail-runner` has the same script; 2 mismatches
  (`types/models.ts`, `components/orders/pick-list-render.ts`). Editing those files here changes what both copy.
- **Migrations** run against each store's own Postgres; there is no deploy script in the repo. After a schema change,
  regenerate and commit `src/generated/prisma`. Do not run server tests or ad-hoc scripts against a shared DB without
  reading their cleanup code first.
- **Releasing** pushes `main` and a tag in one step and auto-updates every till on its next start.

## Consumers — what this repo depends on

api-server (all `deviceAuthMiddleware`, 11): `GET /device/item-sheet/label-update`, `GET /device/item-sheet/label-update/:id`,
`GET /device/member-anonymize-events`, `POST /device/migrate/{company,brand,item}`, `POST /device/migrate/price/retail`,
`POST /device/migrate/promo-price/retail`, `POST /device/migrate/hotkey/retail`, `POST /device/sync/retail/sale-invoice`,
`POST /device/sync/retail/terminal-shift`.

crm-server (33): `GET /api/post/`; `/device/customer-voucher`: `GET /valid`, `POST /issue`, `/redeem`, `/redeem/void`,
`/refund-issue`; `/device/order`: `GET /`, `/:id`, `/:id/refund-requests`, `/buckets`, `/delivery-manifest`, `/pending-count`,
`POST /:id/{accept,collect,deliver,dispatch,picking,printed,ready,refund-requests,reject,schedule}`, `POST /{dispatch,printed,schedule}`;
`/device/member`: `POST /create`, `/phone`, `/search/id`, `/search/keyword`, `/search/phone`, `/signup/stage`,
`/signup/request-otp`, `/signup/verify`.

Local surface with no known caller (app, Android, runner): `GET /clear`, `GET /api/brand/search/:id`.

## Docs policy

`AGENTS.md` files are the agent entry point; each `CLAUDE.md` is one line (`@AGENTS.md`). Old CLAUDE/AGENTS are under
`docs/archive/` (history, not truth). `README.md`, `TEST_CHECKLIST.md` and `docs/` are unverified. Verify against code before
citing any doc. Record findings as hub records (`/Users/dev-m1/ktpv5/ktpv5-rooms`, a finding in the relevant room; api-docs BACKLOG is frozen, hub D-6); do not fix them as a side effect.
- **Prisma schema changed?** After editing any `prisma/**/*.prisma` and migrating, refresh the hub schema tables: `cd /Users/dev-m1/ktpv5/ktpv5-rooms && bun run schema:sync` and commit the regenerated `schemas/<repo>.{json,md}` there. Agents read those files instead of the raw schema.

## Working with the hub (owner operating model, 2026-10-07)

- Start a job with `cd /Users/dev-m1/ktpv5/ktpv5-rooms && bun run room:brief <room>` and read your task record (`rooms/<room>/tasks/T-n.md`): its `done` / `verify` / `qa` fields are the contract. Do only what the task says; stop before anything destructive (delete, force-push, DB writes outside the task, production migrations or deploys — production is the owner's).
- Take the repo lock before writing: `bun run room:lock acquire <repo-path> --as <session> --kind opus|codex --why "..."`, export the same `HUB_SESSION` before `git commit` (the pre-commit hook checks it). If the lock is held, file an ask ticket and do the rest; never two writers on one repo. Claude job sessions work in a git worktree on branch `job/<T-n>`; Codex works on the owned repo's main checkout. Jobs never push — the conductor merges and pushes.
- Cross-repo changes (api-server, crm-server) are allowed when the task needs them, under that repo's lock, with visible contract changes: consumer-matrix check, a hub record naming affected consumers, `bun run schema:sync` after Prisma (hub D-12).
- Notify the owner only through hub tickets: `bun run room:ticket done "<한국어 요약>" --room <room> --repo <repo> --detail "<한국어 설명>"` when the task is complete, `room:ticket ask "<한국어 질문>"` when the owner must decide. Ticket text is Korean (product names as on screen); records stay English. The owner's done-label printer is retired — never print status labels (store product-label printers are unaffected).
- Hand back in ≤ 3 KB (`ktpv5-rooms/.claude/skills/handback/SKILL.md`): sha or "uncommitted", files, each done-criterion met/not met with evidence, each verify command with counts, skipped items. Long detail goes to `ktpv5-rooms/surveys/<date>-<T-n>-report.md`. Never claim device QA.
- Diffs touching payment/refund/cash, auth/OTP/tokens/sessions, DB migrations, price calculation or central sync contracts get a cross-vendor review before merge (hub D-14); say so in the hand-back.

## Owner rules (carried over, not re-verified)

From the archived CLAUDE files unless noted:
- Target screen 1366×768 (main window size in `src/main/index.ts`); keypad column ≥ 560 px (owner memory, not in old files).
- `ip-address` header trust is accepted by owner ruling (2026-08-03, closed LAN). Do not re-raise it (workspace CLAUDE.md).
- The POS never reads or reserves Retail Stage quantity (caller brief; not found in old files).
- Product label text: `code || barcode || "N/A"`, display only (workspace CLAUDE.md, 2026-09-14).
- Label media sizes configured per ZPL printer: `7030`, `7090`, `100100` (`devices.zplNet[].mediaSize`).
- Single store, single company: keep `id: 1` tenancy unless api-server/crm contracts are checked first.
- Prisma client is imported from `src/generated/prisma`, never `@prisma/client`.
- Renderer imports no `electron`/`fs`/`path`. An IPC change touches handler + `preload/index.ts` + `preload/index.d.ts`.
- Sale math lives in `SalesStore.helper.recalculateLine`, `PaymentModal/usePaymentCal`, `libs/sale|refund/build-payload`,
  and the server re-derives it. Never duplicate totals/tax/rounding in a component. No `discounts: []` array.
- Surcharge lives only in `Invoice.creditSurchargeAmount`. Code that walks `invoice.refunds` filters `type === "REFUND"`.
- User vouchers (staff allowance) and customer vouchers (crm) are separate systems. Do not conflate them.
- Item down-sync is field-allowlisted. Never pass cloud payloads straight into `db.item.upsert`.
- In `sale.router.ts`, `/latest` and `/:id/children` stay before `/:id`; `cloud.router.ts` `/printed` stays before `/:id`.
- PaymentModal and `CloudHotkeyViewerV2` use `div` tap targets on purpose (scanner Enter suffix). Do not change them to buttons.
- `/clear` stays a harmless stub. Printing must never block a sale.
- Strict TS: no `as any` or `@ts-ignore`. `serialport` (pinned 13.0.0) is the only native dep. Keep `nodeIntegration: false`.
  Never copy `node_modules` between machines.
- `API_KEY` is the hex body **without** the `dk_` prefix (the code adds it).
