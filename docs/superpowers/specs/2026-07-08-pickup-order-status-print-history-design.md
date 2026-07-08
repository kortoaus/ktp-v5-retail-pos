# Pickup Order Status And Print History Design

Date: 2026-07-08

## Goal

Tighten pickup order detail status actions and label printing rules, then record
successful pickup label prints in a new generic print-history table.

Pickup label printing still prints the selected line label, but the persisted
history is recorded at pickup order level because the current business model is
one pickup order with one line, and list/detail printed indicators are easier to
derive by order id.

## Context

Pickup order status mutation already exists:

- CRM owns canonical pickup order status.
- Retail POS local server forwards status mutations to CRM.
- Retail POS app exposes status CTAs in the pickup order detail action bar.
- `CANCELLED_BY_CUSTOMER` is customer-owned and is not a POS target.

Pickup label printing already exists in the detail viewer:

- The selected line renders a 100x100 pickup work label.
- Print output is built from the same pickup label model as the preview.
- The app prints one label per selected line unit quantity.

This slice adds business rules on top of the mechanical status and print flows.

## Scope

In scope:

- Enforce pickup status transition rules for POS status CTAs.
- Make `READY -> CANCELLED_BY_STORE` manager-only.
- Confirm status impact before printing a `PENDING` order label.
- Automatically change `PENDING -> ORDER_CONFIRMED` after successful label print.
- Block label printing for completed and cancelled pickup orders.
- Add a generic `PrintedHistory` table for new print domains.
- Record pickup label print history at pickup order level.
- Show pickup printed state in pickup order list/detail using `PrintedHistory`.

Out of scope:

- Migrating or porting `PrintedItemSheet`.
- Changing existing item-sheet printed routes, UI state, or localStorage
  migration.
- Backfilling existing item-sheet printed rows into `PrintedHistory`.
- Adding new pickup statuses such as `PRINTED`, `PREPARING`, or `NO_SHOW`.
- Changing pickup order cardinality from the current one-order one-line model.
- CRM-side customer app deep links.

## Existing Printed Item Sheet Boundary

`PrintedItemSheet` remains as-is:

```prisma
model PrintedItemSheet {
  id        Int      @id @default(autoincrement())
  sheetId   Int      @unique
  printedAt DateTime @default(now())
  userId    Int?
  userName  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Do not replace it, migrate it, or reuse its existing APIs for this slice.

`PrintedHistory` is a new generic table for future print domains. The first
domain using it is pickup order label printing.

## Printed History Model

Add to the local retail POS server Prisma schema:

```prisma
model PrintedHistory {
  id         Int      @id @default(autoincrement())
  entityType String
  entityId   Int
  printedAt  DateTime @default(now())
  userId     Int?
  userName   String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([entityType, entityId])
  @@index([entityType, printedAt])
}
```

Use a string `entityType`, not a Prisma enum, so future print domains can be
added without forcing enum migrations. The code should still use constants.

Initial constant:

```ts
const PRINTED_HISTORY_ENTITY_PICKUP_ORDER = "PICKUP_ORDER";
```

Pickup label print rows use:

- `entityType`: `"PICKUP_ORDER"`
- `entityId`: `PickupOrderCache.crmOrderId`
- `userId`: authenticated POS user id when available
- `userName`: authenticated POS user name when available

No unique constraint is used. This is a history table, so reprints create
additional rows.

## Status Transition Rules

Normal POS status flow is forward-only:

| Current | Staff actions | Manager-only actions |
| --- | --- | --- |
| `PENDING` | `ORDER_CONFIRMED`, `CANCELLED_BY_STORE` | same |
| `ORDER_CONFIRMED` | `READY`, `CANCELLED_BY_STORE` | same |
| `READY` | `COMPLETED` | `CANCELLED_BY_STORE` |
| `COMPLETED` | none | none |
| `CANCELLED_BY_STORE` | none | none |
| `CANCELLED_BY_CUSTOMER` | none | none |

`COMPLETED`, `CANCELLED_BY_STORE`, and `CANCELLED_BY_CUSTOMER` are terminal in
the POS.

Manager means the current POS user has `admin` scope. Do not add a new
`manager` scope in this slice.

The policy should be expressible as small functions:

```ts
canTransitionPickupOrderStatus(from, to)
requiresManagerForPickupOrderStatusTransition(from, to)
```

The renderer uses the policy to enable, disable, or annotate CTAs. The local POS
server enforces manager-only rules using `res.locals.user.scope`. CRM enforces
canonical transition validity.

## Label Print Rules

Label printing is allowed only for:

- `PENDING`
- `ORDER_CONFIRMED`
- `READY`

Label printing is blocked for:

- `COMPLETED`
- `CANCELLED_BY_STORE`
- `CANCELLED_BY_CUSTOMER`

The renderer should disable the print affordance for blocked statuses and show:

```text
Labels cannot be printed for completed or cancelled pickup orders.
```

The print handler must also guard against blocked statuses in case it is invoked
through stale UI state.

## Pending Print Confirmation Flow

When printing a label for a `PENDING` order, ask the status-impact confirmation
before the printer confirmation:

1. Status confirmation:

```text
This order is still pending. Printing labels will confirm the order and notify the customer. Continue?
```

2. Printer confirmation:

```text
Print {count} pickup label{s} to {printerName}?
```

3. Print labels.
4. Save `PrintedHistory`.
5. Change status from `PENDING` to `ORDER_CONFIRMED`.
6. Sync/refetch detail and refresh the pickup order list.

The status mutation happens only after successful printing. This avoids
confirming an order when labels did not print.

For `ORDER_CONFIRMED` and `READY`, skip the status-impact confirmation and only
ask the printer confirmation.

## Failure Handling

If status-impact confirmation is cancelled:

- Do not print.
- Do not save print history.
- Do not change status.

If printer confirmation is cancelled:

- Do not print.
- Do not save print history.
- Do not change status.

If printing fails:

- Do not save print history.
- Do not change status.
- Show the printer failure message.

If printing succeeds but `PrintedHistory` save fails:

```text
Labels printed, but print history was not saved.
```

Do not mark the order as printed in UI state unless the server confirms
`PrintedHistory` persistence.

If printing and history save succeed but `PENDING -> ORDER_CONFIRMED` fails:

```text
Labels printed, but order was not confirmed. Confirm manually.
```

The printed history remains valid because labels did print.

## Server API

Add local POS server routes for generic printed history:

```text
GET  /api/printed-history
POST /api/printed-history
```

Both routes require:

- `userMiddleware`
- `scopeMiddleware("sale")`

### `POST /api/printed-history`

Request:

```json
{
  "entityType": "PICKUP_ORDER",
  "entityId": 42
}
```

Behavior:

1. Validate `entityType` as a supported printed-history entity type.
2. Validate `entityId` as a positive integer.
3. For `PICKUP_ORDER`, verify `PickupOrderCache.crmOrderId = entityId` exists.
4. Insert `PrintedHistory`.
5. Return the created row.

Do not upsert. Reprints should create more history rows.

### `GET /api/printed-history`

Initial query shape:

```text
GET /api/printed-history?entityType=PICKUP_ORDER&entityIds=42,43,44
```

Behavior:

1. Validate `entityType`.
2. Validate `entityIds` as positive integer ids.
3. Return one summary per entity id with latest print metadata.

Response result shape:

```ts
type PrintedHistorySummary = {
  entityId: number;
  printCount: number;
  lastPrintedAt: string;
  lastPrintedByUserId: number | null;
  lastPrintedByUserName: string | null;
};
```

The list view can treat presence of a summary as printed.

## Pickup Order List And Detail UI

The pickup order list should show a compact `Printed` badge when the order has
at least one `PrintedHistory` row for:

```text
entityType=PICKUP_ORDER
entityId=order.crmOrderId
```

The detail viewer should show latest print state near the label preview or
status message area:

- not printed: no badge or neutral text
- printed: `Printed`
- optional detail: latest printed timestamp or printed-by text if the layout can
  fit without clutter

This slice should prefer a small badge over a large new panel.

## Data Flow

Successful `PENDING` label print:

```text
renderer confirm status impact
-> renderer confirm printer
-> Electron label printer write
-> POST /api/printed-history
-> POS server inserts PrintedHistory(PICKUP_ORDER, crmOrderId)
-> POST /api/pickup-order/:id/status ORDER_CONFIRMED
-> CRM updates canonical status and sends customer push
-> POS upserts returned pickup order cache
-> renderer sync/refetch/list refresh
```

Successful `ORDER_CONFIRMED` or `READY` label print:

```text
renderer confirm printer
-> Electron label printer write
-> POST /api/printed-history
-> renderer refetch/list refresh
```

Blocked terminal order print:

```text
renderer sees terminal status
-> print control disabled
-> handler guard returns if invoked anyway
```

## Testing Strategy

Retail POS server:

- Unit test printed-history body/query validation.
- Unit test `PICKUP_ORDER` history creation verifies local cached order exists.
- Unit test reprinting creates multiple rows.
- Unit test summary query returns latest print metadata and print count.
- Router test registers printed-history routes under `/api/printed-history`.

Retail POS app:

- Unit test status policy:
  - completed/cancelled statuses are not printable;
  - pending/confirmed/ready are printable.
- Build verification with:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Manual QA:

- `PENDING` print asks status confirmation first, then printer confirmation.
- Cancelling either confirmation does not print or change status.
- Successful `PENDING` print saves history and confirms the order.
- `ORDER_CONFIRMED` and `READY` print without status-impact confirmation.
- `COMPLETED` and cancelled orders cannot print labels.
- Pickup list shows `Printed` after successful history save.

## Open Implementation Notes

- Keep `PrintedHistory` local to the retail POS server. It is not a CRM or cloud
  sync artifact in this slice.
- Do not add `printCount` or `lastPrintedAt` columns to `PickupOrderCache`.
  Derive printed state from `PrintedHistory`.
- If a future domain needs single-print semantics, enforce that in its domain
  service rather than with a global unique constraint.
