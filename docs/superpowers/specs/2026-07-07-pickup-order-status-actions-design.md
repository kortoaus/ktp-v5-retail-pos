# Pickup Order Status Actions Design

## Goal

Allow retail POS staff to change cached pickup order statuses from the pickup
order detail viewer, with CRM as the canonical status owner, CRM status event
history, customer push notifications, and POS cache refresh through the existing
pickup-order sync flow.

## Scope

This slice touches three repos:

- `ktpv5-crm-server`: canonical pickup order status mutation, event history, and
  customer push notification dispatch.
- `ktpv5-pos-retail`: POS local server pass-through endpoint, sync trigger, and
  renderer detail actions.
- `ktpv5-dmarket-app`: notification deep-link implementation is deferred; leave
  a code comment at the existing notification tap routing location so the
  future pickup-order detail route can be wired there.

This slice does not define final business workflow rules for when actions are
available, hidden, or blocked. Those rules will be decided in a later slice
after the mechanical flow is working.

## Status Model

CRM already defines:

```prisma
enum PickupOrderStatus {
  PENDING
  ORDER_CONFIRMED
  READY
  COMPLETED
  CANCELLED_BY_STORE
  CANCELLED_BY_CUSTOMER
}
```

POS status-change actions should expose every target status except
`CANCELLED_BY_CUSTOMER`. Customer cancellation remains customer-owned and is not
set by store staff in this slice.

Allowed POS target statuses for this slice:

- `PENDING`
- `ORDER_CONFIRMED`
- `READY`
- `COMPLETED`
- `CANCELLED_BY_STORE`

No transition matrix is enforced yet beyond validating that the target status is
one of the allowed POS target statuses and the pickup order belongs to the
device company.

## CRM Design

Add a device/POS mutation under the existing device pickup-order router:

```text
POST /device/pickup-order/:id/status
```

Request body:

```json
{
  "status": "ORDER_CONFIRMED",
  "actorId": "12",
  "actorName": "Alice",
  "note": "optional short note"
}
```

CRM device middleware supplies `res.locals.companyId`; the request body must not
be trusted for company scope.

CRM behavior:

1. Validate `:id` as a positive CRM pickup order id.
2. Validate `status` as one of the POS-allowed target statuses.
3. Validate optional POS actor snapshot:
   - `actorId`: optional non-empty string after trim.
   - `actorName`: optional non-empty string after trim.
   - `note`: optional string after trim.
4. In a single transaction:
   - Find the order by `{ id, companyId }`.
   - Update `PickupOrder.status`.
   - Append `PickupOrderStatusEvent`.
5. Event fields:
   - `fromStatus`: previous order status.
   - `toStatus`: requested target status.
   - `actorType`: `KTP_USER`.
   - `actorId`: POS user id string when provided, otherwise null.
   - `actorNameSnapshot`: POS user name when provided, otherwise null.
   - `note`: optional note or null.
6. Return the updated order in the same wire shape used by device sync, including
   lines, so POS can update or compare immediately if desired.
7. After the transaction succeeds, fire customer push notification without
   awaiting it as a dependency of the endpoint outcome.

If the order is missing for the device company, return 404. If validation fails,
return 400.

### CRM Push Notification

Push is sent only after the status update and event append succeed.

Push dispatch is fire-and-forget from the endpoint perspective:

```ts
void sendPickupOrderStatusPushNotification(...).catch((error) => {
  console.error("[pickup-order.status] push failed:", error);
});
```

The endpoint response must not fail because:

- the member has no registered push tokens,
- Expo rejects a token,
- push sending throws.

Notification target:

- `companyId`: order company id.
- `memberId`: order member id.

Payload data:

```json
{
  "type": "pickup-order",
  "id": 42,
  "status": "ORDER_CONFIRMED"
}
```

Initial notification content:

- `PENDING`
  - title: `Pickup order updated`
  - body: `Your pickup order is pending.`
- `ORDER_CONFIRMED`
  - title: `Pickup order confirmed`
  - body: `Your pickup order has been confirmed.`
- `READY`
  - title: `Pickup order ready`
  - body: `Your pickup order is ready for pickup.`
- `COMPLETED`
  - title: `Pickup order completed`
  - body: `Your pickup order has been completed.`
- `CANCELLED_BY_STORE`
  - title: `Pickup order cancelled`
  - body: `Your pickup order was cancelled by the store.`

The push helper should reuse existing CRM push utilities:

- `getPushTokens(companyId, memberId)`
- `sendPushNotification(tokens, title, body, data)`

No push outbox is introduced in this slice.

## Retail POS Local Server Design

Add a local POS endpoint under the existing pickup-order router:

```text
POST /api/pickup-order/:id/status
```

This route uses the existing POS auth boundaries:

- `userMiddleware`
- `scopeMiddleware("sale")`

Request body from renderer:

```json
{
  "status": "ORDER_CONFIRMED"
}
```

Server behavior:

1. Parse `:id` as CRM pickup order id.
2. Validate `status` as one of the POS-allowed target statuses.
3. Read authenticated POS user from middleware context.
4. Call CRM:

```text
POST /device/pickup-order/:id/status
```

with:

```json
{
  "status": "ORDER_CONFIRMED",
  "actorId": "12",
  "actorName": "Alice"
}
```

5. Map CRM errors through the same style as existing pickup-order CRM helpers.
6. Return OK to renderer when CRM returns OK.

After the renderer receives OK, the renderer triggers the existing POS sync
endpoint:

```text
POST /api/pickup-order/sync
```

The sync step remains outside the status-change endpoint so the user-visible
mutation outcome stays clearly tied to CRM success.

## Retail POS Renderer Design

Add status actions to the pickup order detail viewer:

- File: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
- Service: `retail_pos_app/src/renderer/src/service/pickup-order.service.ts`

UI behavior:

1. Show status action controls in the order summary area.
2. Offer target statuses:
   - `PENDING`
   - `ORDER_CONFIRMED`
   - `READY`
   - `COMPLETED`
   - `CANCELLED_BY_STORE`
3. Do not offer `CANCELLED_BY_CUSTOMER`.
4. Disable or omit the action for the order's current status to avoid a no-op
   mutation.
5. On action tap, show two confirmation dialogs:
   - First confirmation states the target status.
   - Second confirmation states that the customer may receive a push
     notification.
6. If both confirmations pass, call the POS local status endpoint.
7. When the status endpoint returns OK:
   - trigger `/api/pickup-order/sync`;
   - refetch the selected pickup order detail;
   - ask the parent search panel to refresh its current page.
8. Display a non-blocking error message if the status mutation or sync fails.

No final visibility or transition business policy is encoded in this slice.

## Dream Market App Note

The app currently routes notification taps for:

- `type: "post"`
- `type: "receipt"`

Pickup-order deep linking is deferred because the Dream Market pickup order
detail screen and service are not implemented yet. A code comment should live
under the receipt notification routing branch in:

```text
ktpv5-dmarket-app/app/_layout.tsx
```

The future app-side implementation should route:

```json
{
  "type": "pickup-order",
  "id": 42
}
```

to the eventual pickup order detail screen.

## Testing Strategy

CRM server:

- Add service tests proving status changes update the order and append an event
  in one transaction.
- Add validation tests proving `CANCELLED_BY_CUSTOMER` is rejected for POS
  status changes.
- Add push tests proving push dispatch is invoked after a successful status
  change and is not required for the endpoint response.
- Add router registration tests for `POST /:id/status`.

Retail POS server:

- Add CRM wrapper tests proving the correct device endpoint and actor snapshot
  payload are sent.
- Add local status service/controller tests proving validation, error mapping,
  and CRM response handling.
- Add router registration tests for `POST /:id/status`.

Retail POS app:

- Build verification is the main check because the app has no configured test
  runner.
- Manually verify the detail modal shows status actions and performs the two
  confirmations before calling the server.

Dream Market app:

- No behavior is implemented in this slice.
- Verify the notification handler comment is in the intended location.

## Verification Commands

Run after implementation:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

If Dream Market app code changes beyond the routing comment in a later slice,
run:

```bash
cd /Users/dev/ktpv5/ktpv5-dmarket-app && npx tsc --noEmit
```

## Deferred Decisions

The next slice will decide the business workflow rules:

- which source statuses can transition to which target statuses;
- which actions are hidden, disabled, or shown with warnings;
- whether `COMPLETED` or `READY` require additional operational checks;
- whether reverting to `PENDING` should notify the customer or use different
  copy;
- whether push notification text should be bilingual or localized by member
  language preference.
