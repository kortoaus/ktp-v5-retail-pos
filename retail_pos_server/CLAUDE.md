# CLAUDE.md — retail_pos_server

LAN-local Express 5 + Prisma 7 + PostgreSQL server. One instance per store; it is the
only thing in the building that talks to the cloud.

## Runtime & Entry

- `src/index.ts` — creates the HTTP server, attaches Socket.IO (same port, `cors.origin: "*"`),
  listens on `process.env.PORT || 3000`. **PM2 sets `PORT=2200`** (`../ecosystem.config.js`);
  `.env.example` also says 2200. The `|| 3000` fallback is a trap — always set `PORT`.
- On boot it fires: `triggerSyncAllSaleInvoices()`, `triggerSyncAllShifts()`.
- `src/app.ts` — Express wiring. **Order is load-bearing**: `express.json({limit:"1mb"})` →
  cors → request logger → `/health` `/clear` `/ok` (unauthenticated stubs) →
  `terminalMiddleware` → `/api` router → error handler.
- `src/router.ts` — mounts 16 modules under `/api`. Each module is
  `x.router.ts` + `x.controller.ts` + `x.service.ts`. (The Route Map below still
  omits `/order` — known doc drift, recorded in api-docs BACKLOG §Z.)

## Commands

```bash
npm run dev                  # nodemon src/index.ts
npm run build                # tsc → dist/
npm start                    # node dist/index.js   (what PM2 runs)
npx prisma generate          # → src/generated/prisma  (NOT node_modules)
npx prisma migrate deploy    # apply migrations in prod
npm test                     # STUB — exits 1. See Testing below.
docker compose up -d         # local dev Postgres only (host port 5555)
./scripts/safe-reset.sh      # pg_dump → migrate reset → restore (checksum drift rescue)
```

## Environment (`.env`)

| Var | Meaning |
|---|---|
| `PORT` | HTTP + Socket.IO port (2200 in prod) |
| `DATABASE_URL` | Local Postgres. `src/libs/db.ts` appends `&uselibpqcompat=true` — the URL **must already contain a `?query`**, otherwise the concat produces a malformed URL |
| `API_URL` | ktpv5-api-server base |
| `CRM_URL` | ktpv5-crm-server base |
| `API_KEY` | Device key **hex only, without the `dk_` prefix** (see Device Auth) |
| `ITEM_URL` | Declared in `src/libs/constants.ts`, imported by `cloud.api.ts`, **never used**. Dead |
| `CRON_INSTANCE` | No longer read anywhere in `src`. Dead |
| `STRIPE_SECRET_KEY` | **Optional.** Stripe secret key for `/api/stripe/*` (Tap to Pay, Fast Checkout tablet). Absent ⇒ those two routes answer `503 {ok:false,msg:"Stripe is not configured"}`; nothing else is affected |
| `STRIPE_LOCATION_ID` | **Optional.** Terminal Location id. Absent ⇒ `stripe.service.ts` reuses the account's first location (or creates "KTP Dev") and logs the id to pin here |

## Request Pipeline

1. `src/v1/terminal.middleware.ts` runs for **every** `/api/*` request. It reads the
   `ip-address` **header** (client-supplied, not the socket IP), finds a non-archived
   `Terminal` by that IP, plus `Company id=1`, `StoreSetting id=1`, and the open
   `TerminalShift` (`closedAt: null`). It stashes them on `res.locals.{terminal,company,storeSetting,shift}`.
   Missing terminal/company/storeSetting = 404 for the whole API. `shift` may legitimately be `null`.
   There is **no terminal self-registration route** — `GET /api/terminal/me` is read-only;
   new terminals must be INSERTed into Postgres by hand.
2. `src/v1/user/user.middleware.ts` `userMiddleware` parses
   `Authorization: Bearer <userId>%%%<lastSignedAt>`, looks the user up, and populates
   `res.locals.{userId,user,placedBy}`. **It never verifies a signature or the timestamp** —
   the token is a plaintext user id. Treat the LAN as the security boundary.
3. `scopeMiddleware(scope)` — passes if `user.scope` includes `"admin"` or the named scope.
   Scopes: `admin sale interface user hotkey refund cashio store shift`.

## Route Map (`/api` prefix)

| Prefix | Auth | Notable routes |
|---|---|---|
| `/terminal` | none | `GET /me` |
| `/shift` | user + `shift` (except `/current`) | `GET /current`, `POST /open`, `POST /close/data` (preview, read-only), `POST /close`, `GET /:id` |
| `/item` | none | `GET /search/keyword`, `/search/keyword/scale`, `/search/barcode`, `/search/id/:id`, `POST /search/ids` |
| `/brand` | none | `GET /search`, `GET /search/:id` — **no in-repo consumer** |
| `/hotkey` | none | `GET|POST /`, `GET /cloud`, `DELETE /:id` |
| `/crm` | none | `POST /member/{create,search/phone,search/keyword,search/id,signup/stage,signup/request-otp,signup/verify}` → proxied to CRM |
| `/user` | mixed | `GET|POST /` (`user` scope), `GET /public`, `GET /code`, `GET /me`, `GET /:id` |
| `/sale` | user + `sale`/`refund` | `POST /`, `/spend`, `/refund` (`refund`), `/repay` (`refund`), `GET /`, `/latest`, `/:id/children`, `/:id` — **`/latest` and `/:id/children` MUST stay declared before `/:id`** |
| `/voucher` | user + `sale` | `GET /daily`, `POST /daily/issue` (staff vouchers) |
| `/customer-voucher` | user + `sale` | `GET /valid`, `POST /issue` **only** |
| `/printer` | none | `POST /print` — `express.raw(application/octet-stream, 20mb)`, TCP-bridges bytes to a network printer |
| `/cashio` | user + `cashio` | `GET|POST /` |
| `/store` | GET open, POST + `store` | `GET /`, `GET /label` (no consumer in this repo), `POST /` |
| `/cloud` | none | `POST /migrate/item` (runs the whole down-sync), `GET /post`, `GET|POST /item-sheet/label-update*` |
| `/stripe` | user + `sale` | `POST /connection-token` (→ `{secret, locationId}`), `POST /payment-intent` (`{amount}` cents → `{id, client_secret}`). **Only outbound-to-Stripe surface**; no key ⇒ clean `503 {ok:false,msg:"Stripe is not configured"}` |

## Database

- Prisma 7 with the **`PrismaPg` driver adapter** (`src/libs/db.ts`), client generated to
  `src/generated/prisma`. Import models from `../generated/prisma/models`, enums from
  `../generated/prisma/enums`, `Prisma`/`PrismaClient` from `../generated/prisma/client`.
  Never `@prisma/client`.
- `prisma/schema.prisma` (919 lines) is the domain spec — it carries the long Korean
  invariant comments for `SaleInvoice`, `SaleInvoiceRow`, `SaleInvoicePayment`. Read it
  before touching sale math.
- Cloud-mirrored (down-sync, read-mostly): `Company Category Brand Item ItemScaleData
  ItemCategory Price PromoPrice CloudHotkey CloudHotkeyItem`.
- POS-owned (up-sync or local-only): `Terminal Hotkey StoreSetting User TerminalShift
  CashInOut SaleInvoice SaleInvoiceRow SaleInvoicePayment Voucher VoucherEvent DocCounter
  PrintedItemSheet`.
- `companyId = 1` and `storeSetting.id = 1` are hard-coded everywhere. Single-store deployment.

## Cloud Sync — api-server (`API_URL`)

`src/libs/cloud.api.ts` exposes two axios singletons: `apiService` (→ `API_URL`) and
`crmApiService` (→ `CRM_URL`). Both send `device-api-key: <API_KEY>` **and**
`Authorization: Bearer dk_<API_KEY>`, 30 s timeout, and normalise everything into
`{ ok, msg, status, result, paging }` — network failures come back as `{ok:false,status:0}`,
never a throw.

Down (`src/v1/cloud/cloud.migrate.service.ts`, all `POST` with `{lastUpdatedAt}` watermark):
`/device/migrate/company`, `/category`, `/brand`, `/item`, `/price/retail`,
`/promo-price/retail`, `/hotkey/retail`.
Item down-sync is **field-allowlisted on purpose** — do not splat cloud payloads into
`db.item.upsert`.
Also `GET /device/item-sheet/label-update[/:id]` via `cloud.item-sheet.controller.ts`.

Up (`src/v1/cloud/cloud.sync.service.ts`): `POST /device/sync/retail/sale-invoice` and
`/device/sync/retail/terminal-shift`.
- `cloudId != null ⟺ synced`. There is no `synced`/`syncedAt` column.
- Sweeps `WHERE cloudId IS NULL` in `id ASC` and **breaks on the first failure** so repay/refund
  children never overtake their parent. A child whose parent has no `cloudId` also breaks.
- `originalInvoiceId` is resolved to the parent's **cloud** id before push.
- Module-level `invoiceSweepRunning` / `shiftSweepRunning` booleans guard re-entry.
- Triggers (fire-and-forget, never awaited): sale create, refund create, repay create,
  shift close, cloud migrate, server boot. No scheduler for invoices/shifts.

## CRM Proxy (`CRM_URL`) — not api-server

These go to **ktpv5-crm-server**, not the central api-server:
`/device/member/{create,phone,search/id,search/keyword,search/phone,signup/stage,signup/request-otp,signup/verify}`,
`/device/customer-voucher/{valid,issue,redeem,redeem/void,refund-issue}`,
and `GET {CRM_URL}/api/post` (raw axios, `ktpv5-company` JSON header, in `cloud.post.service.ts`).

`redeem`, `redeem/void` and `refund-issue` have **no local HTTP route** — they are invoked
server-side from `sale.create.service.ts` / `sale.refund.service.ts`. Redeem uses a
deterministic idempotency key `${invoiceRequestId}:cv:${voucherId}:${amount}`; a partial
failure voids the already-redeemed vouchers before rethrowing.

## Sale Domain (canonical implementations)

- `sale.create.service.ts` — validate user vouchers → validate amounts → single transaction
  (invoice + rows + payments + voucher redeem + shift aggregate) → trigger sync.
- `sale.refund.service.ts` — split storage (`row.total` = product only,
  `row.surcharge_share` = refunded surcharge) with drift-absorbing remaining-based math;
  the last refund of a row takes the whole remainder.
- `sale.repay.service.ts` — full refund + replacement SALE in one transaction. Blocked if
  the original has REFUND children, is from another shift, is older than 10 min, or paid
  with a customer voucher. The replacement SALE is a **child** of the original, so any code
  walking `invoice.refunds` must filter `type === "REFUND"`.
- `sale.doc-counter.ts` — `DocCounter` keyed by date; a new day starts at a random
  101–999 counter. Serial = `{company}-{shift}-{terminal}-{seq}`.
- `sale.points.ts` / `sale.refund.points.ts` — point earn/reversal snapshots. CRM owns the
  real ledger; POS only stores `pointsEarned` / `pointsReversed`.
- `shift.service.ts` — `closeTerminalShiftService` recomputes every total from SQL
  (`aggregateShift`) and ignores client-supplied figures; the client sends only
  `{ closedNote, endedCashActual }`.

## Socket.IO Events (server → client)

| Event | Emitted by |
|---|---|
| `cloud-sync-completed` | `cloud.migrate.controller.ts` after a full down-sync |

## Testing

`npm test` is a stub. Real tests are `node:test` files compiled with the app:

```bash
npm run build && node --test dist/v1/sale/sale.doc-counter.test.js
```

Files: `sale.{points,refund.points,doc-counter}.test.ts`, `store.service.test.ts`. All are
pure-function tests with injected deps — none touch Postgres. Keep it that way.

## Gotchas

- `terminalMiddleware` trusts the `ip-address` **header**. Any LAN client can impersonate a
  terminal; combined with the `userId%%%` token, `Authorization: Bearer 1%%%0` is admin.
- `docker-compose.yml` publishes Postgres on host **5555**; `.env.example` points at **5438**.
  Reconcile before assuming either.
- `libs/exceptions.HttpException` subclasses are thrown from `async` handlers. Express 5
  forwards async rejections, but `terminalMiddleware` re-throws inside its own `catch` —
  don't add `await` layers that swallow it.
- `/clear` is a harmless 200 stub. Do not give it destructive behaviour.
- Dates: `moment-timezone` with `Australia/Sydney` (`libs/date-utils.ts`). Never `dayjs` here.
