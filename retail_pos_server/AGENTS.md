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
```

`npm test` is a placeholder that exits 1. The 13 `src/v1/**/*.test.ts` (node:test) have no runner script.

## Layout

- `src/index.ts`: HTTP server + Socket.IO, starts the 30 s crm order broadcaster, fires the boot sync sweeps.
- `src/app.ts`: global middleware chain, `/health` `/clear` `/ok`, global `terminalMiddleware`, error handler.
- `src/router.ts`: 17 `/api` mounts → `src/v1/<domain>/<domain>.router.ts` → controller → service.
- `src/libs/`: `cloud.api.ts` (api/crm clients), `constants.ts` (env + scales), `db.ts` (Prisma adapter-pg),
  `date-utils.ts` (`momentAU`), `exceptions.ts`, `socket.ts` (`setIO`/`getIO`), `query.ts`, `barcode-utils.ts`.
- `src/v1/cloud/`: catalog migrate (down), invoice/shift sync (up), member anonymize pull, label-update sheets.
- `src/v1/order/`: crm order proxy, collect sweep, pending broadcaster.
- `prisma/schema.prisma` + `prisma/migrations/` (65); `prisma.config.ts`; generated client in `src/generated/prisma` (tracked).
- `backups/`, `db/` and `dist/` are git-ignored local data.

## Local rules

- Throw `HttpException` subclasses from handlers; do not hand-roll error JSON.
- Every new route is behind `terminalMiddleware` automatically. Add `userMiddleware` + `scopeMiddleware` for anything that
  writes or reveals staff/member data.
- New outbound cloud calls go through `apiService`/`crmApiService`. Add the endpoint to the root AGENTS.md consumers list.
