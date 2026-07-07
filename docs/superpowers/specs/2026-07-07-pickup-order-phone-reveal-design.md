# Pickup Order Phone Reveal Design

Date: 2026-07-07

## Goal

Allow POS staff to reveal a pickup customer's full phone number from the pickup
order detail modal only when they explicitly press a button.

CRM remains the owner of encrypted phone data. The retail POS must not sync,
cache, persist, print, or include the full phone number in local order payloads.
The revealed value is transient UI state for the currently opened pickup order.

## Data Source

Use `PickupOrderCache.memberId` as the lookup key.

Schema relationship:

- CRM `PickupOrder.memberId` stores CRM `Member.id`.
- POS `PickupOrderCache.memberId` stores the same CRM member id.
- CRM `Member.phone_e164_enc` stores the encrypted phone value.
- CRM `Member.phone_last4` / POS `PickupOrderCache.memberPhoneLast4` remains
  the default masked display value.

Do not use CRM order id to decrypt the phone number. The order only identifies
which cached row to read locally so the POS server can obtain its `memberId`.

## CRM Server API

Add a device-authenticated endpoint under the existing CRM device member
boundary:

```text
POST /device/member/phone
```

Request:

```ts
{
  memberId: string;
}
```

Behavior:

1. Use the existing `deviceMiddleware`.
2. Read `companyId` from `res.locals.companyId`.
3. Find an active member by `{ companyId, id: memberId, archived: false }`.
4. Decrypt `phone_e164_enc` with `decryptPhone()`, which uses
   `PHONE_ENCRYPTION_KEY` and legacy fallback support.
5. Return only the phone string and minimal display metadata.

Response:

```ts
{
  ok: true;
  msg: "Member phone loaded";
  result: {
    memberId: string;
    phone: string;
    phoneLast4: string | null;
  };
  paging: null;
}
```

Failure rules:

- Missing `memberId`: `400`.
- Member not found in the authenticated company: `404`.
- Decryption failure: `500` with a generic message. Do not log plaintext.
- Do not return `phone_hash` or `phone_e164_enc`.

## Retail POS Server API

Add a sale-scope-protected local proxy endpoint:

```text
GET /api/pickup-order/:id/member-phone
```

The `:id` path value is the CRM pickup order id, matching the existing
`GET /api/pickup-order/:id` detail route.

Behavior:

1. Protect the route with `userMiddleware` and `scopeMiddleware("sale")`.
2. Parse `:id` as a positive integer CRM order id.
3. Find `PickupOrderCache` by `crmOrderId`.
4. Use `PickupOrderCache.memberId` in a direct CRM request:

```ts
crmApiService.post("/device/member/phone", { memberId: row.memberId })
```

5. Return the CRM phone result through the standard POS API envelope.

The POS server must not write the phone number into PostgreSQL, logs, sync
state, receipt payloads, work labels, or any cache table.

Failure rules:

- Missing local pickup order: `404`.
- CRM `400` or `404`: return a client-safe `400`/`404` message.
- CRM auth failure: `401`.
- CRM network or server failure: return a generic unavailable message.

## Retail POS Renderer

Add a service function:

```ts
getPickupOrderMemberPhone(crmOrderId: number)
```

It calls:

```text
GET /api/pickup-order/:crmOrderId/member-phone
```

Renderer state rules:

- Keep `revealedPhone` only in `PickupOrderViewer` component state.
- Reset `revealedPhone`, loading state, and error when:
  - the modal opens for a different `crmOrderId`,
  - the modal closes,
  - the order detail reloads.
- Do not add phone to pickup order DTO types except the dedicated reveal
  response type.
- Do not store the phone in Zustand, localStorage, BroadcastChannel, or any
  printable label/receipt data.

## UI Placement

In the pickup detail modal's left summary panel, remove these fields:

- `MEMBER ID`
- `LEVEL`

Use that row for the reveal control. The existing `PHONE` summary field remains
masked by default, for example `*783`.

The replacement area should span the two-column summary grid row where
`MEMBER ID` and `LEVEL` currently appear.

Default state:

```text
[Show Full Phone]
```

Loading state:

```text
Loading phone...
```

Loaded state:

```text
+61...full number...
[Hide]
```

Error state:

```text
Could not load phone
[Try Again]
```

The button should look like an operational control, not a decorative card. It
should fit inside the summary panel without shifting the modal layout. The
phone value should use a monospace or tabular presentation and must not overflow
the left column.

## Security And Privacy

- Full phone is revealed only after an explicit staff action.
- The local POS database continues to store only `memberPhoneLast4`.
- CRM owns decryption because CRM owns `Member.phone_e164_enc`.
- Retail POS server acts as a scoped proxy so the renderer does not need CRM URL
  or device API key access.
- Do not log decrypted phone numbers in CRM, POS server, or renderer.
- Do not include the full phone in work-order label preview or print output.

## Files Expected To Change

CRM server:

- `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`
- `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
- `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`

Retail POS server:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.repository.ts`
- Optional helper/service file if the CRM proxy logic grows beyond the
  controller.

Retail POS app:

- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

## Verification

CRM server:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Retail POS server:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Retail POS app:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Manual checks:

1. Open a pickup order detail modal.
2. Confirm `MEMBER ID` and `LEVEL` are gone.
3. Confirm the reveal button appears in that row.
4. Confirm the default phone display is still masked.
5. Press the reveal button and confirm the full phone appears.
6. Close and reopen the modal and confirm the full phone is hidden again.
7. Confirm the work-order label preview still shows only the masked phone.
