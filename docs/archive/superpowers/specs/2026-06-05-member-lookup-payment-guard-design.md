# Member Lookup Payment Guard Design

## Summary

Prevent a sale invoice from being created while a member QR lookup is still in
flight.

The guard is intentionally narrow: it blocks only payment entry and final sale
creation while the POS is waiting for the member lookup response. It must not
block other SaleScreen work such as item scanning, line edits, cart switching,
quantity changes, or member removal.

## Background

Member QR scans are asynchronous:

```text
member%%%{id} scan -> POST /api/crm/member/search/id -> set cart.member
```

Today the SaleScreen keeps a local `loading` state during that request, but the
Pay action is not guarded by that state. A fast operator can scan a member QR,
open PaymentModal, and complete the sale before the CRM response attaches the
member to the cart.

That timing can produce a valid no-member sale invoice even though the UI may
show the member shortly afterward, which makes the operator report look
contradictory.

## Goals

- Track member lookup progress separately from generic item-scan loading.
- Disable opening PaymentModal while member lookup is pending.
- Disable final invoice creation while member lookup is pending.
- Keep all other POS interactions available during the pending lookup.
- Make the pending state visible enough that operators understand why payment is
  temporarily unavailable.
- Avoid changing sale math, member pricing, invoice payload shape, or cloud sync
  behavior.

## Non-Goals

- Do not add a full-screen blocking overlay for member lookup.
- Do not block item scanning, line editing, cart switching, Clear Cart, or
  member removal.
- Do not change CRM lookup endpoints.
- Do not change sale invoice member snapshot fields.
- Do not change data-server sync idempotency behavior in this pass.
- Do not redesign PaymentModal tender entry.

## Design

### Member Lookup State

SaleScreen should maintain a dedicated state value such as:

```ts
const [memberLookupPending, setMemberLookupPending] = useState(false);
```

Only the member QR lookup path should toggle this state. Item barcode lookups
and PP barcode lookups should continue using their existing flow and should not
affect this guard.

The member QR flow becomes:

```text
setMemberLookupPending(true)
request member by id
if found: setMember(member)
if not found: alert as today
finally: setMemberLookupPending(false)
```

The state should be local to SaleScreen unless implementation shows PaymentModal
needs to read it after mount. If PaymentModal needs the value directly, pass it
as an explicit prop rather than introducing a broad global loading flag.

### SaleScreen Pay Guard

The Pay tap target should be disabled when:

```text
lines.length === 0 OR memberLookupPending
```

When `memberLookupPending` is true, tapping Pay should not open PaymentModal.
The UI should communicate the reason with concise text near the action, for
example:

```text
Attaching member...
```

This should be a payment-specific guard, not a screen-level guard. The operator
can keep scanning items or editing the cart while the member lookup resolves.

### PaymentModal Complete Guard

PaymentModal should not create a SALE invoice while member lookup is pending.

If PaymentModal is opened before a member lookup starts, and then a member QR
scan begins while the modal is open, Complete Sale should become disabled until
the lookup settles.

Recommended API:

```tsx
<PaymentModal
  memberLookupPending={memberLookupPending}
  onCancel={...}
/>
```

Then include the flag in the existing complete-disabled calculation:

```text
completeDisabled = existingCompleteDisabled || memberLookupPending
```

The disabled state should only block final invoice creation. Tender entry and
review can remain available unless existing PaymentModal invariants already
disable them for another reason.

### Scanner Behavior While PaymentModal Is Open

This spec does not require suspending all scanner input while PaymentModal is
open, because the explicit user constraint is to avoid blocking unrelated
operations.

However, the member QR path should still respect the same payment guard:

- If a member QR is scanned while PaymentModal is open, `memberLookupPending`
  should become true.
- Complete Sale should remain disabled until the lookup finishes.
- If the lookup changes the active cart member, existing PaymentModal behavior
  should clear staged and committed payments through its member-change effect.

This preserves current flexibility while closing the race that can create a
no-member invoice.

### Member Display Clarity

PaymentModal should show the member's name when a member is attached, not only a
generic `Member` badge.

Recommended labels:

```text
Member: {name}
Voucher available: {name}
```

This is not required for correctness, but it improves operator confirmation and
helps future bug reports distinguish "a member badge was visible" from "the
intended member was visible."

### Optional Follow-Up: Sync Idempotency Diagnostics

Data-server retail invoice sync currently returns the existing cloud invoice id
when `(deviceId, localId)` already exists, without updating the row.

This is correct idempotency behavior, but it can hide rare mismatch cases after
database restore, local id reuse, or manual data repair. A later diagnostic-only
change can log a warning when an existing cloud row has a different member
snapshot than the incoming payload.

This is intentionally outside the main guard implementation.

## Data Flow

```text
SaleScreen member QR scan
  -> memberLookupPending = true
  -> CRM lookup request
  -> Pay and Complete Sale unavailable
  -> other cart operations remain available
  -> CRM lookup response
  -> setMember(member) or show lookup error
  -> memberLookupPending = false
  -> Pay and Complete Sale follow normal rules again
```

## Error Handling

- Successful lookup attaches the member and clears pending state.
- Not-found lookup keeps the current member state unchanged and clears pending
  state after the alert.
- Network/server failure logs as today, clears pending state, and should not
  create an invoice.
- If the user clears the cart while lookup is pending, the lookup response should
  follow current semantics unless implementation identifies a stale-response
  problem. A stale-response guard can be added only if needed.

## Testing

Manual regression should cover:

- Scan member QR and wait for response: Pay opens PaymentModal with the member.
- Scan member QR and immediately tap Pay: PaymentModal does not open until the
  lookup settles.
- Open PaymentModal, scan member QR, and immediately tap Complete Sale: Complete
  remains disabled until the lookup settles.
- While member lookup is pending, item scan still works.
- While member lookup is pending, line quantity/price edits still work.
- While member lookup is pending, cart switching still works.
- Lookup failure clears the pending guard and leaves payment behavior normal.
- A completed member sale stores `memberId` locally and syncs the same member
  snapshot to data-server.

Automated coverage, if practical in the current project, should focus on
component-level behavior:

- SaleScreen does not set `modalTarget = "payment"` while
  `memberLookupPending` is true.
- PaymentModal complete action is disabled while `memberLookupPending` is true.

## Acceptance Criteria

- A member lookup in flight cannot race with `POST /api/sale`.
- No full-screen lock is introduced for member lookup.
- Non-payment SaleScreen actions continue to work during member lookup.
- The disabled payment state has a visible reason.
- Existing sale payload and server sync contracts are unchanged.
