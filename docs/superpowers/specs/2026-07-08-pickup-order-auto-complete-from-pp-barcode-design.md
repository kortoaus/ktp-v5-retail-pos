# Pickup Order Auto-Complete From PP Barcode Design

## Goal

Pickup orders should move to `COMPLETED` automatically after the customer receives the goods through the normal POS sale flow. Staff should not need to open the pickup order screen and manually press `COMPLETED` after the item has already been scanned and paid through POS.

## Current Process

The operational flow is:

1. Customer places a pickup order.
2. Local POS server syncs it as `PENDING`.
3. Scale/tablet worker prints pickup work labels.
4. Label print confirms the order as `ORDER_CONFIRMED`.
5. Worker finishes preparation and marks the order `READY`.
6. Goods move to the waiting area.
7. Customer arrives at the store.
8. Staff gives the goods to the customer.
9. Staff scans the label at POS and the item enters the sale cart.
10. Staff completes payment.
11. Pickup order completion is currently manual.

The gap is between steps 10 and 11. The POS sale confirms the goods have left the store, but the pickup order status does not follow automatically.

## Decision

Extend the existing PP barcode payload used on pickup work labels so it carries the pickup order id.

The POS sale cart must preserve that pickup order id on scanned lines. On payment completion, POS derives distinct pickup order ids from the paid cart lines using `new Set(...)` and asks the POS server to complete those pickup orders.

This avoids matching by item barcode alone. Item barcode matching is unsafe because multiple pickup orders can contain the same product.

## Barcode Payload

The existing PP barcode format is:

```text
00:{"00":2,"01":"<item barcode>","02":[...],"03":[...]}
```

Add one optional field:

```json
{
  "09": 260708869
}
```

`"09"` means `pickupOrderId` / CRM pickup order id.

Reasons:

- It keeps the existing `00:` PP barcode prefix.
- It does not break older POS clients; old parsers ignore the field because they only read known keys.
- It lets every pickup work label carry the same order identity even when the order has multiple line labels.

## Scale/Tablet Label Generation

When building pickup work label QR payloads, include:

- item barcode in `"01"`
- line prices in `"02"`
- promo prices in `"03"`
- pickup order id in `"09"`

Every pickup work label for the same pickup order should contain the same `"09"` value. This is intentional. If the customer has multiple pickup orders, scanning labels from multiple orders will add multiple pickup order ids to the cart.

Relevant files:

- `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/pp-payload.ts`
- `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/model.ts`
- `/Users/dev/ktpv5/ktpv5-scale/components/pickupOrders/PickupOrderViewer.tsx`

The POS app also has pickup work label helpers and should stay compatible:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`

## POS Scan Handling

`parsePPBarcode` should parse `"09"` as:

```ts
pickupOrderId: number | null
```

The parsed value must only be accepted when it is a finite positive integer. Missing or invalid `"09"` should behave like a normal PP barcode with `pickupOrderId: null`.

Relevant file:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pp-barcode.ts`

## Zustand Cart State

The cart line should preserve pickup order identity from scan time until payment completion.

Add optional metadata to `SaleLineType`:

```ts
pickupOrderId: number | null;
```

Add optional metadata to `AddLineOptions`:

```ts
pickupOrderId?: number | null;
```

`buildNewLine` copies `options.pickupOrderId ?? null` into the new line.

Line-level metadata is the right boundary because one cart can contain:

- normal non-pickup lines
- lines from one pickup order
- lines from multiple pickup orders
- repeated labels from the same pickup order

The sale screen/payment flow derives the order-level array from lines when needed:

```ts
const pickupOrderIds = Array.from(
  new Set(
    cart.lines
      .map((line) => line.pickupOrderId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
  ),
);
```

Relevant files:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/types/sales.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/index.tsx`

## Payment Completion

Only `SALE` completion should auto-complete pickup orders. `SPEND`, cancelled payments, failed payments, and incomplete payments must not change pickup order status.

After `createSale(payload)` succeeds:

1. Derive distinct pickup order ids from the cart snapshot used to build the sale payload.
2. For each id, request pickup order status update to `COMPLETED`.
3. Continue attempting the remaining ids if one update fails.
4. Clear the cart only after the sale has already succeeded, preserving the current behavior.
5. Show a compact alert/message only when at least one pickup completion failed.

The cart must be snapshotted before clearing so pickup order ids are not lost.

Relevant file:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

## Server Status Rules

The existing status endpoint should remain the write path:

```http
POST /api/pickup-order/:id/status
{ "status": "COMPLETED" }
```

The desired completion behavior is:

- `READY -> COMPLETED`: allowed
- `COMPLETED -> COMPLETED`: idempotent success for auto-complete
- `PENDING -> COMPLETED`: rejected
- `ORDER_CONFIRMED -> COMPLETED`: rejected
- cancelled orders: rejected or unchanged

The idempotent `COMPLETED -> COMPLETED` behavior prevents duplicate label scans or repeated payment-complete retries from surfacing as user-visible errors.

Relevant files:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`

## Failure Handling

Sale creation is the primary business action. Pickup auto-completion is a follow-up status sync.

If sale creation fails:

- Do not complete any pickup orders.
- Leave the cart and payment modal behavior unchanged.

If sale creation succeeds but pickup completion fails:

- Do not roll back the sale.
- Continue receipt/drawer flow.
- Show a concise message with failed order ids.
- The orders remain visible in pickup UI until manually completed or retried by a later flow.

## UX Notes

No new cashier button is required for the default path.

When pickup labels are scanned and sale completes, the cashier should experience this as normal sale completion. The pickup order status should follow in the background.

If there are multiple pickup orders in the same cart, all distinct ids should be completed once.

If there are duplicate labels from the same pickup order, only one completion request should be sent for that order.

## Non-Goals

- Do not match pickup orders by item barcode alone.
- Do not auto-complete on scan.
- Do not auto-complete on label print.
- Do not auto-complete on `READY`.
- Do not complete pickup orders for `SPEND`.
- Do not introduce member filtering.
- Do not send Discord notifications.

## Verification Targets

Server:

- PP status completion tests cover `READY -> COMPLETED`.
- Tests cover idempotent `COMPLETED -> COMPLETED`.
- Tests cover rejected `PENDING/ORDER_CONFIRMED -> COMPLETED`.

POS client:

- PP barcode parser reads `"09"` into `pickupOrderId`.
- `SalesStore` stores `pickupOrderId` on cart lines.
- Payment completion derives distinct ids with `new Set`.
- Payment completion calls status update only after successful sale creation.

Scale/tablet:

- Pickup work label QR payload contains `"09": order.crmOrderId`.
- Existing PP barcode fields remain unchanged.

Build/lint:

- `cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build`
- `cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build`
- `cd /Users/dev/ktpv5/ktpv5-scale && npx tsc --noEmit --pretty false`
- `cd /Users/dev/ktpv5/ktpv5-scale && npm run lint`
- `git diff --check` in both repos
