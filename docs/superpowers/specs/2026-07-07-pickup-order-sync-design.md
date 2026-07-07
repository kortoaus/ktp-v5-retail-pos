# Pickup Order Sync Design

Date: 2026-07-07

## Goal

Build the first retail POS slice for online pickup orders: keep a local POS
cache of CRM pickup orders and order lines, refreshed by a gated polling worker.

The immediate purpose is operational visibility and future line-label printing.
CRM remains the canonical owner of pickup order status. POS caches the data it
needs to list orders, detect new orders, and later print one label per line.

## Decisions

- Use read cache plus direct mutation architecture.
- Cache all CRM pickup orders incrementally by CRM `updatedAt`.
- Cache only `PickupOrder` and `PickupOrderLine` snapshots.
- Do not cache `PickupOrderStatusEvent`.
- Do not create an offline action outbox in this slice.
- Run the sync worker only when `CRON_INSTANCE=true`.
- Poll every 60 seconds when enabled.
- Emit a Socket.IO notification when newly cached orders are detected.
- Keep label printing, print history, and status mutation UI out of this slice.

## Why Not A 1:1 Mirror

The POS local server is not the owner of pickup orders. A full CRM table mirror
would make local data look canonical and would pull in history and fields that
the POS does not need for this slice.

The POS needs a durable snapshot for:

- listing orders while the POS server is online locally,
- detecting new orders after polling,
- supporting future line-level order-label printing,
- remaining able to show already-synced orders when internet access drops.

CRM remains responsible for:

- order creation from the online app,
- status transition rules,
- status event history,
- member/order canonical records.

## CRM Server Changes

Add a device-authenticated endpoint under the existing CRM `/device` boundary.
The retail POS already talks to CRM through `crmApiService`, which sends the
device API key headers.

Proposed route:

```text
GET /device/pickup-order/sync
```

Query:

```text
updatedAfter?: ISO datetime
afterId?: number
limit?: number
```

Response:

```ts
{
  ok: true;
  msg: "Pickup orders synced";
  result: {
    items: PickupOrderSyncItem[];
    nextCursor: {
      updatedAt: string;
      orderId: number;
    } | null;
    hasMore: boolean;
  };
  paging: null;
}
```

Ordering:

```text
updatedAt asc, id asc
```

Filter semantics:

```text
updatedAt > updatedAfter
OR (updatedAt = updatedAfter AND id > afterId)
```

The payload includes order fields and ordered lines. It excludes status events.

## POS Local Schema

Use POS-specific cache tables, not CRM table names copied exactly. Keep CRM ids
explicit so the cache is easy to upsert and easy to reconcile.

```prisma
model PickupOrderCache {
  id               Int      @id @default(autoincrement())
  crmOrderId       Int      @unique
  companyId        Int
  documentId       String   @unique
  status           String

  memberId         String
  memberName       String
  memberLevel      Int
  memberPhoneLast4 String?

  pickupStartsAt   DateTime
  linesTotal       Int
  total            Int

  crmCreatedAt     DateTime
  crmUpdatedAt     DateTime
  syncedAt         DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  lines            PickupOrderLineCache[]

  @@index([companyId, status, pickupStartsAt])
  @@index([companyId, pickupStartsAt])
  @@index([companyId, crmUpdatedAt])
  @@index([companyId, syncedAt])
}

model PickupOrderLineCache {
  id                      Int              @id @default(autoincrement())
  crmLineId               Int              @unique
  crmOrderId              Int
  order                   PickupOrderCache @relation(fields: [crmOrderId], references: [crmOrderId], onDelete: Cascade)

  index                   Int
  itemId                  Int
  name_en                 String
  name_ko                 String
  barcode                 String
  code                    String?
  uom                     String

  prices                  Int[]
  promoPrices             Json?
  memberLevel             Int
  optionTotal             Int
  qty                     Int
  total                   Int
  note                    String?
  selectedOptionsSnapshot Json

  crmCreatedAt            DateTime
  crmUpdatedAt            DateTime
  syncedAt                DateTime         @default(now())
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  @@index([crmOrderId, index])
  @@index([itemId])
  @@index([barcode])
  @@index([code])
}

model PickupOrderSyncState {
  id              Int       @id @default(autoincrement())
  key             String    @unique
  cursorUpdatedAt DateTime?
  cursorOrderId   Int?
  lastSyncedAt    DateTime?
  lastSuccessAt   DateTime?
  lastErrorAt     DateTime?
  lastErrorMsg    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

`key` is `"pickup-order"` for this worker.

## Worker Behavior

The POS server starts the pickup order sync worker during boot only when:

```text
CRON_INSTANCE=true
```

If the value is missing or not exactly `true`, the worker does not start. This
prevents duplicate polling in deployments with multiple POS server instances.

Worker loop:

1. Run once at startup when enabled.
2. Poll every 60 seconds.
3. Skip a tick if the previous sync is still running.
4. Load `PickupOrderSyncState`.
5. Request CRM changes after the stored cursor.
6. Upsert orders and lines in a transaction per page.
7. Advance the cursor only after the page is persisted.
8. Continue pages while `hasMore` is true.
9. On failure, keep the previous cursor and store error metadata.

The worker should use a small overlap window when constructing the CRM request,
for example five seconds before the saved `cursorUpdatedAt`. Upsert by
`crmOrderId` and `crmLineId` absorbs duplicate rows from overlap retries.

## New Order Detection

Before upserting a sync page, the POS server checks which incoming `crmOrderId`
values are not present locally.

After successful persistence, if new orders were inserted, emit:

```text
pickup-order:new
```

Payload:

```ts
{
  count: number;
  orderIds: number[];
  latestPickupStartsAt: string | null;
}
```

This slice only emits the event. Renderer badge, toast, sound, and order list UI
are future work.

## Local Query API

Add POS local routes for cached pickup orders, even if the first UI arrives in a
later slice:

```text
GET /api/pickup-order
GET /api/pickup-order/:id
POST /api/pickup-order/sync
```

`POST /api/pickup-order/sync` triggers the same sync function manually and is
useful for operator refresh and testing. It must obey the same concurrency guard.

List filters should be local DB filters:

- status,
- pickup date range,
- keyword over `documentId`, member name, line names, barcode, and code,
- page and limit.

## Offline Behavior

If internet access or CRM is unavailable:

- the worker records the error and retries on the next tick,
- the cursor is not advanced,
- already cached orders remain visible through local APIs,
- future label printing can still print already cached lines,
- status mutations are not attempted in this slice.

New orders created in CRM while the POS is offline are not visible until the
worker reconnects and catches up.

## Future Slices

Line-label printing:

- one label per `PickupOrderLineCache`,
- quantity does not multiply labels in the default flow,
- print history is local canonical.

Recommended future print tables:

```text
PrintHistory
  entityType = "pickup-order-line"
  entityId = crmLineId
  parentEntityType = "pickup-order"
  parentEntityId = crmOrderId
  entitySerial = documentId
  printType = "pickup-order-line-label"
```

Status actions:

- buttons are separate from printing,
- actions call CRM directly,
- successful CRM mutation updates local cache from the response or a fresh fetch,
- failed CRM mutation does not create a local outbox.

## Verification

Implementation should be verified with:

```bash
cd retail_pos_server
npx prisma generate
npm run build
```

CRM server changes should be verified with:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

If existing repo state blocks either command, report the pre-existing failure
separately.
