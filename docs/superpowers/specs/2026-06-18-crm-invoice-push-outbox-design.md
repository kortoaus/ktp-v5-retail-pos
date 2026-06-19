# CRM Invoice Push Outbox Design

## Goal

Prevent retail POS invoices from syncing successfully to data-server while CRM
member points silently fail to apply.

The invoice sync path must remain resilient: a temporary CRM outage, bad
network hop, timeout, or CRM restart must not block the POS/Data-server invoice
record. The CRM point event must become durable and retryable instead of a
single fire-and-forget request.

## Scope

This work changes both sibling repos in the same Codex session:

- `/Users/dev/ktpv5/ktpv5-data-server`
- `/Users/dev/ktpv5/ktpv5-crm-server`

The current POS repo is the coordinating session. POS local sync behavior does
not need to change for this design.

## Migration Boundary

Codex may update Prisma schema files and run Prisma generate only.

Database migration creation, migration deployment, and migration execution are
owned by the user. Do not run migration commands.

## Current Problem

Current path:

1. POS local server pushes invoice to API server.
2. API server proxies to data-server `/retail/sync/sale-invoice`.
3. Data-server stores `RetailSaleInvoice`.
4. Data-server sends CRM `/push` as best-effort fire-and-forget.
5. CRM creates `MemberPointLedger` and updates `Member.points`.

The weak point is step 4. If CRM push fails after the data-server invoice is
stored, data-server still returns success. POS records `cloudId`, so the invoice
is no longer retried from POS. The missing point event has no durable retry
record.

## Recommended Approach

Add a durable outbox table in data-server and process it with an in-process
background worker.

Keep invoice sync successful even when CRM is unavailable, but create a durable
outbox row in the same transaction as the invoice whenever the invoice has a
member point effect.

## Data-server Design

### Outbox Model

Add a Prisma model similar to:

```prisma
model CrmInvoicePushOutbox {
  id             Int       @id @default(autoincrement())
  invoiceId      Int
  companyId      Int
  memberId       String
  serial         String
  pointsEarned   Int       @default(0)
  pointsReversed Int       @default(0)

  status         String    @default("PENDING")
  attempts       Int       @default(0)
  nextRetryAt    DateTime  @default(now())
  lastError      String?
  sentAt         DateTime?

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([invoiceId])
  @@index([status, nextRetryAt])
  @@index([companyId, memberId])
}
```

The model is intentionally invoice-scoped. CRM already handles earn and reversal
idempotency separately through ledger type, so a single row can carry both
`pointsEarned` and `pointsReversed`.

### Enqueue Rules

During `syncRetailSaleInvoice`, inside the same DB transaction that creates
`RetailSaleInvoice`:

- If `memberId` is absent, do not enqueue.
- If `pointsEarned <= 0` and `pointsReversed <= 0`, do not enqueue.
- If the invoice already exists by `(deviceId, localId)`, do not create a
  duplicate outbox row.
- If the invoice is newly created and has point effects, create one outbox row.

### Worker

Start a lightweight in-process worker when data-server boots.

This is not an external cron. It is a DB-backed retry loop inside the data-server
process:

- Poll every short interval, such as 30 seconds.
- Select `PENDING` or `RETRYING` rows where `nextRetryAt <= now`.
- Process oldest rows first.
- Send CRM `/push` using the existing signed CRM client.
- On success, mark `SENT`, set `sentAt`, clear transient failure state if useful.
- On failure, increment `attempts`, store `lastError`, set `status = RETRYING`,
  and compute exponential backoff in `nextRetryAt`.
- After a fixed maximum attempts threshold, mark `FAILED`.

If data-server restarts, the worker resumes from DB state.

For the first implementation, assume a single data-server process. If multiple
instances become possible, add row claiming or database locking before enabling
parallel workers.

### Reconciliation Helper

Add a service function that can enqueue missing outbox rows for historical
invoices:

- `memberId IS NOT NULL`
- `pointsEarned > 0 OR pointsReversed > 0`
- no existing outbox row for that invoice

This does not need to be a public API in the first pass. It can be an internal
service or script entry point for operations.

## CRM Design

CRM keeps ownership of `Member`, `Member.points`, and `MemberPointLedger`.

No CRM schema change is expected because `MemberPointLedger` already has:

```prisma
@@unique([companyId, entityType, entityId, type])
```

That unique constraint makes retry safe:

- The first successful earn creates the `EARN` ledger and increments points.
- A repeated earn for the same invoice returns as already handled.
- The same applies to reversal with `VOID`.

Improve `/push` response clarity so data-server can log and classify outcomes.

Example response:

```json
{
  "ok": true,
  "result": {
    "earn": { "created": true, "pointsEarned": 74, "balanceAfter": 4820 },
    "reversal": { "created": false, "pointsReversed": 0 }
  }
}
```

If the member does not exist for the company, CRM should continue returning a
failure so data-server can retry and eventually mark the outbox row `FAILED`.

## Error Handling

Data-server invoice sync must not fail because CRM is unavailable.

Outbox processing records failure details in `lastError`, including useful
messages for:

- CRM URL/connectivity failure
- timeout
- invalid/missing CRM push secret
- CRM `401`
- CRM member not found
- unexpected CRM response shape

The signed CRM request path remains the integration boundary. Do not let
data-server mutate CRM point tables directly.

## Observability

The first implementation should log concise worker transitions:

- row picked
- success
- retry scheduled
- final failed

The DB outbox table is the primary operational view. A future admin endpoint can
be added if operators need UI access.

## Testing

Data-server tests:

- New member invoice with positive `pointsEarned` creates an outbox row.
- New member refund with positive `pointsReversed` creates an outbox row.
- Invoice without member does not enqueue.
- Invoice with zero point effects does not enqueue.
- Duplicate invoice sync returns existing invoice and does not duplicate outbox.
- Worker marks success as `SENT`.
- Worker marks failure as `RETRYING` with incremented attempts and future retry.
- Worker marks repeated failure as `FAILED`.

CRM tests:

- `/push` returns earn/reversal result details.
- Earn push creates one ledger row and increments member points.
- Duplicate earn push does not increment member points again.
- Reversal push creates one void ledger row and decrements safely.
- Missing member returns an error.

## Implementation Order

1. Data-server schema update and generated Prisma client update.
2. Data-server enqueue logic inside invoice sync transaction.
3. Data-server CRM outbox worker and retry service.
4. Data-server reconciliation helper.
5. CRM `/push` response shape improvement.
6. Focused tests in both repos.
7. Run Prisma generate only; user owns migrations.

