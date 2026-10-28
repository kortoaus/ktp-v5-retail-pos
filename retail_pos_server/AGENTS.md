# AGENTS.md — retail_pos_server

Read the root `../AGENTS.md` first (map, danger zones, consumers, owner rules). File:line reference:
`/Users/dev-m1/ktpv5/ktpv5-rooms/surveys/2026-10-06-pos-retail-reference.md`.

## Commands

```bash
docker compose up -d          # dev Postgres retail_pos_local_postgres on host :5555 (.env.example says :5438 — fix your .env)
cp .env.example .env          # then add CRM_URL (missing from the example)
npm run dev                   # nodemon src/index.ts
npx tsc --noEmit              # typecheck
npm run build && npm start    # tsc → dist/, node dist/index.js (PM2 runs `npm run start` with PORT=2200)
npx prisma migrate dev        # new migration; then `npx prisma generate` and commit src/generated/prisma
npx prisma migrate deploy     # apply on a store DB
scripts/safe-reset.sh         # backup → migrate reset → restore (checksum drift)
bun run dev:fake-sci          # fake SCI payment terminal on :7400 (no DB) — see "Integrated EFTPOS" below
bun run eft:prune [--days N]  # delete EftEvent rows older than N days (default EFT_EVENT_RETENTION_DAYS) — writes the DATABASE_URL DB
```

`npm test` runs every `src/**/*.test.ts` with node:test (ts-node transpile-only, `scripts/test-offline.cjs` preload points DB/cloud URLs at unroutable hosts); 359 pass on 2026-10-28 (T-6 + review round 1). Keep tests offline.

## Layout

- `src/index.ts`: HTTP server + Socket.IO, starts the 30 s crm order broadcaster, fires the boot sync sweeps.
- `src/app.ts`: global middleware chain, `/health` `/clear` `/ok`, global `terminalMiddleware`, error handler.
- `src/router.ts`: 17 `/api` mounts → `src/v1/<domain>/<domain>.router.ts` → controller → service.
- `src/libs/`: `cloud.api.ts` (api/crm clients), `constants.ts` (env + scales), `db.ts` (Prisma adapter-pg),
  `date-utils.ts` (`momentAU`), `exceptions.ts`, `socket.ts` (`setIO`/`getIO`), `query.ts`, `barcode-utils.ts`.
- `src/v1/cloud/`: catalog migrate (down), invoice/shift sync (up), member anonymize pull, label-update sheets.
- `src/v1/order/`: crm order proxy, collect sweep, pending broadcaster.
- `src/v1/eft/`: integrated EFTPOS (below). `src/dev/fake-sci.ts`: the fake SCI server (entry `scripts/dev/fake-sci.ts`).
- `prisma/schema.prisma` + `prisma/migrations/` (65); `prisma.config.ts`; generated client in `src/generated/prisma` (tracked).
- `backups/`, `db/` and `dist/` are git-ignored local data.

## Local rules

- Throw `HttpException` subclasses from handlers; do not hand-roll error JSON.
- Every new route is behind `terminalMiddleware` automatically. Add `userMiddleware` + `scopeMiddleware` for anything that
  writes or reveals staff/member data.
- New outbound cloud calls go through `apiService`/`crmApiService`. Add the endpoint to the root AGENTS.md consumers list.

## Docs policy
- **Prisma schema changed?** After editing any `prisma/**/*.prisma` and migrating, refresh the hub schema tables: `cd /Users/dev-m1/ktpv5/ktpv5-rooms && bun run schema:sync` and commit the regenerated `schemas/<repo>.{json,md}` there. Agents read those files instead of the raw schema.

## Integrated EFTPOS (`src/v1/eft/`, retail-eftpos D-2..D-5, spec S-3 — added 2026-10-28, T-6)

Provider-neutral card-terminal layer; SCI (Simple Cloud Integration, cloud REST) is the only provider today, Linkly
plugs in later behind `provider.ts`. Spec: `ktpv5-rooms/surveys/2026-10-28-retail-eftpos-S-3-sci-adapter-spec.md`.

- **Who holds what.** Only this server knows the pairing API key, signing secret part A (env) and part B (per pairing,
  AES-256-GCM with `EFT_SECRET_KEY` in `EftPairing.signingSecretPartBEnc`), `key_id` and the SCI base URL. Tills and
  Runner see `/api/eft/*` only; `actionForm` buttons reach them with `submit: true` instead of `submit_url`. Never
  show the vendor name in client-facing text — say "SCI".
- **Files.** `provider.ts` (interface: pair / pairingInfo / unpair / createTransaction / pollTransaction /
  submitAction / cancel) · `sci/sci.provider.ts` + `sci/sci.signing.ts` (RFC 9421 HMAC-SHA256, `@authority` =
  host[:port], fetch 70 s polls / 15 s otherwise, `redirect: "error"`) · `eft.engine.ts` (state machine, per-transaction
  server poll loop, override, boot recovery, pairings, `/lanes`) · `eft.store.ts` / `eft.store.prisma.ts` · `eft.router.ts`.
- **Data.** `EftPairing`, `EftTransaction` (`@@unique([operationId, kind])`; `saleOperationId` = the till's sale
  operation id on every attempt; a retry after a decline, a *certain* failure or override NO rewrites the old row's
  `operationId` to `<operationId>#<rowId>` — an unresolved row is never retired), `EftEvent` (append-only, `seq` per transaction), `Terminal.eftPairingId` (the lane's chosen
  pairing). The sale/refund write backfills `EftTransaction.invoiceId` by operation id inside the invoice transaction
  (`eft.link.ts`). No EFT column on `SaleInvoice` / `SaleInvoicePayment`; a card tender is still `{type: CREDIT}`.
- **States.** `CREATING → PENDING → AWAITING_POS → FINALISED` (`financialStatus` APPROVED / DECLINED / CANCELLED /
  UNKNOWN) · `FAILED` only when nothing can have been charged (a 4xx answer such as 424 / TRANSACTION_REFUSED /
  signature 401, no pairing) · `TIMEOUT` = unresolved, override required: `[TIMEOUT] DEADLINE` (no new SCI version
  for `EFT_SCI_POLL_DEADLINE_MS`; the timer aborts an in-flight long poll) or `[NET|POS] CREATE_UNKNOWN` (the create
  may have reached SCI: no answer, timeout, 5xx, unreadable 2xx, or a server restart mid-create — amended A-5/A-15) ·
  `FINALISED_BY_OVERRIDE` / `CANCELLED_BY_OVERRIDE` (cashier's Yes/No, with user id). Every status write goes through
  `transition()` in the engine: under the row lock, checked against the current status/version; an overridden row
  never changes again (A-19). While TIMEOUT the loop keeps watching ~5 min and a FINALISED answer still applies;
  after an override a late answer is only an event (`LATE_RESULT`). Once a create has landed, poll errors are retried
  until the deadline. A failed action relay (answer lost, F-3) puts the row back to PENDING and resumes the loop with
  a recovery GET: a landed action shows its result, one that never landed re-shows the form (AWAITING_POS). Boot
  (`startEftRecovery` in `index.ts`): PENDING / AWAITING_POS / TIMEOUT-with-upstream-id rows resume; CREATING without
  an upstream id → TIMEOUT `[POS] CREATE_UNKNOWN`.
- **Lane API** (`terminalMiddleware` → `userMiddleware` → `scopeMiddleware("sale")`, as `/api/stripe`):
  `GET|POST /pairings` (`{pairingCode, nickname?}` → row + `confirmationCode`), `POST /pairings/:id/test|unpair|select`
  (`select` with `:id = none` clears), `POST /transactions` (`{operationId, kind: PURCHASE|REFUND, amountCents,
  surchargeCents?}` → 201 new / 200 same attempt / 409 other amount), `GET /transactions/:id?min_version=N`,
  `POST /transactions/:id/actions` (`{buttonKey, inputs: {name: value}, version?}` — 409 `ACTION_IN_FLIGHT` /
  `STALE_VERSION` / `STALE_STATE`, 502 when the relay's answer was lost), `POST /transactions/:id/override`
  (`{answer: YES|NO}`, only when `overrideRequired`), `POST /transactions/:id/cancel` (marks it; cancel on the terminal),
  `GET /transactions/:id/events`, `GET /lanes`. No pairing env → 503 `EFT is not configured`.
- **Long-poll contract for clients (D-4).** Payment state is never on socket.io. `GET /transactions/:id?min_version=N`
  answers as soon as the row's `version` ≥ N, else holds up to `EFT_LANE_POLL_HOLD_MS` (20 s) and answers 200 with the
  current state — never 404 on expiry. Send last seen `version + 1`; omit `min_version` to read at once. Render
  `displayMessage`; print when `merchantPrintSeq` / `customerPrintSeq` grow or `autoActions` has
  `PRINT_MERCHANT_RECEIPT`; show the override dialog while `overrideRequired` (also right after a create whose outcome
  is unknown); stop at `final`. After a 502 on an action keep long-polling — the server is already checking the
  terminal. Keep the sale's `operationId` across a till restart: the same create returns the same row (no double
  charge), and a new attempt is only created after a decline, a certain failure or override NO.
- **Logging (D-5).** Every step is an `EftEvent` (TILL_CREATE, SCI_CREATE_REQ/RES, SCI_POLL_REQ/RES,
  SCI_POLL_TIMEOUT_404, STATE, ACTION_SHOWN, TILL_ACTION, SCI_ACTION_REQ/RES, AUTO_ACTION, OVERRIDE, DEADLINE,
  RECOVERY_RESUME, LATE_RESULT, TILL_CANCEL, ERROR) and one console line `[eft] txn=<id> lane=<terminalId> <event> …`
  (`pm2 logs`). `errorClass` NET | PAIR | TERM | BANK | TIMEOUT | POS + `errorCode` are on the row and in the cashier
  text (`Terminal not connected — … [TERM]`). `detail` passes `eft.events.ts#sanitizeDetail` (no headers, keys,
  secrets, PAN runs, `sig1=` values; ≤ 4 KB); an upstream error body is kept only when structured, after the
  request's own secret values (Signature, Signature-Input, key id, part A/B) are redacted — an unstructured body is
  dropped and only status + code remain (`sci.provider.ts#excerpt`, F-4). Owner diagnosis over SSH: `curl -H 'ip-address: <till ip>' -H 'Authorization: Bearer
  <staff token>' localhost:2200/api/eft/lanes` (and `/transactions/<id>/events`).
- **Env (names only, `.env.example`).** `EFT_SCI_PAIRING_API_URL`, `EFT_SCI_PAIRING_API_KEY`,
  `EFT_SCI_SIGNING_SECRET_PART_A`, `EFT_SECRET_KEY` (32-byte hex), `EFT_SCI_POLL_DEADLINE_MS` (60 000),
  `EFT_LANE_POLL_HOLD_MS` (20 000), `EFT_EVENT_RETENTION_DAYS` (180). Fake → real tenant = these values + re-pairing
  every lane; no code change. Losing `EFT_SECRET_KEY` makes stored pairings unreadable → re-pair.
- **Fake SCI** (`bun run dev:fake-sci`, `EFT_FAKE_SCI_PORT` 7400; set `EFT_SCI_PAIRING_API_URL=http://127.0.0.1:7400`
  and the same `EFT_SCI_SIGNING_SECRET_PART_A` on both). Any 6-digit pairing code (confirmation = last 3 digits
  twice); verifies signatures (401 `no_valid_signatures_found`). Amounts: ≥ $1.00 approve, $0.01/0.05/0.06/0.51/0.54/
  0.55/0.91/0.94 decline with the Gecko Bank reason, $0.68 never finalises (override demo), `.77` → signature on the
  POS. Switches: env `FAKE_SCI_DEVICE_OFFLINE=1` / `FAKE_SCI_REFUSE=1` / `FAKE_SCI_UNPAIR=1`, or at runtime
  `curl -X POST localhost:7400/_fake/mode -d '{"deviceOffline":true}'`; `GET /_fake/state`.
- **Tests** (`src/v1/eft/*.test.ts`, `sci/sci.signing.test.ts`): in-memory store (`eft.test-fakes.ts`) + the fake on an
  ephemeral port; no test touches a DB. Signing vectors were computed with openssl — a change there is a protocol change.
