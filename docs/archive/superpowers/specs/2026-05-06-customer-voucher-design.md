# Customer Voucher Design

## Goal

Implement CRM-owned Customer Vouchers for the retail POS payment flow.

The first release supports POS-issued customer vouchers only. Later, the mobile
app may allow members to exchange points for vouchers, but this design avoids
mobile app redemption flows for now.

## Scope

- A POS user with `sale` scope can issue a Customer Voucher for the active
  member in `PaymentModal`.
- The first issue denomination is fixed at `$10`.
- Issue cost is `1000` member points. The threshold must be extracted into
  constants in both repos:
  - POS renderer: `retail_pos_app/src/renderer/src/libs/constants.ts`
  - CRM server: `src/libs/constants.ts`
- Issued point-exchange vouchers are valid for 14 days.
- Refund-created vouchers are valid for 7 days.
- The CRM server owns voucher records, voucher ledger events, point deduction,
  redemption, redemption voiding, and refund voucher issuance.
- The POS local server remains the renderer's only HTTP target. It proxies
  Customer Voucher requests to the CRM server using the existing device API key
  authentication path.

Out of scope:

- Mobile app point-to-voucher exchange.
- Offline Customer Voucher issue, redemption, or refund.
- Repay for invoices that include a customer-voucher payment.
- Local POS mirroring of the full Customer Voucher history.

## Existing Context

The POS already models customer vouchers as a subtype of `PaymentType.VOUCHER`:

```ts
entityType: "user-voucher" | "customer-voucher"
```

User Voucher is local to the POS database. Customer Voucher is designed as a CRM
entity referenced by `SaleInvoicePayment.entityId`, with receipt/search display
stored as `SaleInvoicePayment.entityLabel`.

The current POS UI shows a Customer Voucher placeholder for member carts. This
feature replaces that placeholder with `CustomerVoucherInput`, matching the
existing `UserVoucherInput` two-step interaction.

## CRM Data Model

Add `CustomerVoucher` to `ktpv5-crm-server`.

Fields:

- `id`: integer primary key, owned by CRM. POS `SaleInvoicePayment.entityId`
  is numeric, so CRM voucher ids must remain numeric for this integration.
- `companyId`: tenant scope from device auth.
- `memberId`: CRM member id.
- `serial`: unique customer-facing code in `YYYY-XXXX-XXXX-XXXX` format.
- `kind`: `POINT_EXCHANGE` or `REFUND`.
- `initAmount`: cents.
- `balance`: cents.
- `status`: `ACTIVE`, `EXPIRED`, or `ARCHIVED`.
- `validFrom`: issue timestamp.
- `validTo`: expiry timestamp.
- `sourcePointLedgerId`: nullable link for point-exchange issues.
- `createdByDeviceId`: POS device id from CRM device auth.
- `createdAt`, `updatedAt`.

Indexes and constraints:

- Unique `serial`.
- Index `[companyId, memberId, status, validTo]` for valid voucher lookup.

Add `CustomerVoucherEvent`.

Fields:

- `id`
- `companyId`
- `voucherId`
- `type`: `ISSUE`, `REDEEM`, `VOID_REDEEM`, `REFUND_ISSUE`, `EXPIRE`,
  `ADJUST`
- `amount`: signed cents. Issue/refund/void are positive; redeem is negative.
- `requestId`: idempotency key for redeem and void flows.
- `entityType`: e.g. `pos-sale-invoice`, `pos-refund-invoice`,
  `pos-sale-request`
- `entityId`: POS local invoice id if available, otherwise the request id.
- `entitySerial`: POS invoice serial if available.
- `note`
- `createdAt`, `updatedAt`.

Indexes and constraints:

- Unique non-null `requestId` for idempotent redeem/void events.
- Index `[voucherId, type]`.
- Index `[companyId, entityType, entityId]`.

Serial generation:

- Format: `YYYY-XXXX-XXXX-XXXX`.
- The year prefix is the CRM server's current business year.
- Random characters should avoid ambiguous characters where practical, e.g.
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- The `serial` column must be unique. On collision, retry generation.

## CRM Transactions

### Point Exchange Issue

CRM endpoint receives `memberId`.

In one transaction:

1. Load the member by `companyId` and `memberId`.
2. Verify `Member.points >= CUSTOMER_VOUCHER_ISSUE_POINTS`.
3. Create a `MemberPointLedger` row:
   - `type = REDEEM`
   - `pointsDelta = -CUSTOMER_VOUCHER_ISSUE_POINTS`
   - `entityType = "customer-voucher"`
   - `entityId = voucher id as a string`
   - `entitySerial = voucher serial`
4. Decrement `Member.points`.
5. Create a `$10` `CustomerVoucher` valid for 14 days.
6. Create `CustomerVoucherEvent ISSUE` for `+1000` cents.
7. Return the voucher with the member's new point balance.

If multiple creation order constraints make it awkward to reference the voucher
from the point ledger before the voucher exists, create the voucher first inside
the same transaction and then create the point ledger, updating
`sourcePointLedgerId` before commit.

### Redeem

CRM endpoint receives:

- `requestId`
- `memberId`
- `voucherId`
- `amount`
- POS context: terminal/device id from auth, cashier id/name if provided, and
  sale request metadata.

In one transaction:

1. If a `REDEEM` event with the same `requestId` already exists, return the
   existing result without decrementing again.
2. Load voucher by `companyId`, `memberId`, and `voucherId`.
3. Verify `status = ACTIVE`.
4. Verify `validFrom <= now <= validTo`.
5. Verify `balance >= amount`.
6. Decrement voucher balance by `amount`.
7. Create `CustomerVoucherEvent REDEEM` with `amount = -amount`.
8. Return the updated voucher and redeem event.

### Void Redeem

Used only when CRM redeem succeeds but POS local invoice persistence fails.

CRM endpoint receives:

- `requestId`
- `redeemRequestId`
- optional failure note.

In one transaction:

1. If `VOID_REDEEM` with `requestId` already exists, return the existing result.
2. Find the original `REDEEM` by `redeemRequestId`.
3. If not found, fail with a clear error.
4. If already voided, return the existing void result.
5. Increment voucher balance by the original redeem amount.
6. Create `CustomerVoucherEvent VOID_REDEEM` with positive amount.

If void fails from the POS side, the POS local server must log enough context
for manual reconciliation: redeem request id, voucher id, member id, amount,
terminal, cashier, and sale payload summary.

### Refund Issue

Customer-voucher refunds do not restore the original voucher because original
validity windows may have expired or may be confusing to the customer.

For a refund involving customer-voucher tender:

1. CRM creates a new `CustomerVoucher kind=REFUND`.
2. Amount equals the customer-voucher refund tender amount.
3. Validity is 7 days from issue.
4. CRM creates `CustomerVoucherEvent REFUND_ISSUE`.
5. POS refund invoice stores the new voucher id and label in its refund payment
   row.

## CRM Device API

Add routes under `/device/customer-voucher`.

- `GET /valid?memberId=...`
  - Returns only active, unexpired, positive-balance vouchers for that member.
- `POST /issue`
  - Issues the fixed `$10` voucher by redeeming points.
- `POST /redeem`
  - Redeems a voucher idempotently.
- `POST /redeem/void`
  - Voids a prior redeem idempotently.
- `POST /refund-issue`
  - Issues a 7-day refund voucher.

All routes use existing `deviceMiddleware`. The CRM server already validates the
local POS API key through the main API server, so no extra HMAC layer is needed
for this feature.

## POS Local Server API

Add a local module mounted under `/api/customer-voucher`.

The route requires `sale` scope because issuing and redeeming vouchers directly
affects monetary value.

Routes:

- `GET /valid?memberId=...`
- `POST /issue`
- `POST /redeem`
- `POST /redeem/void`
- `POST /refund-issue`

Each route proxies to CRM through `crmApiService`. The renderer does not call
CRM directly.

CRM network failures are hard failures:

- Issue fails and the UI stays open.
- Sale completion fails before local invoice persistence.
- Refund completion fails before local refund invoice persistence.

## POS Payment UI

Create `CustomerVoucherInput.tsx` beside `UserVoucherInput.tsx`.

It follows the same two-step UX:

1. Select an existing valid Customer Voucher or issue a new `$10` voucher.
2. Enter the amount with numpad or `EXACT`.
3. `ADD CUSTOMER VOUCHER` commits the staged voucher to the payment list.

Valid voucher list:

- belongs to the active member.
- `status = ACTIVE`.
- `validFrom <= now <= validTo`.
- `balance > 0`.

Issue button:

- Enabled when `activeMember.points >= CUSTOMER_VOUCHER_ISSUE_POINTS`.
- Existing valid vouchers do not block another issue.
- On success, the newly issued voucher becomes selected, but amount remains `0`
  so the cashier intentionally chooses the applied amount.

Payment state:

- `PaymentQueueItem` continues to use:
  - `tender = "VOUCHER"`
  - `entityType = "customer-voucher"`
  - `entityId = CRM voucher id`
  - `entityLabel = CRM serial + expiry snapshot`
- User Voucher and Customer Voucher remain mutually exclusive through the
  existing member/non-member slot selection.

## Complete Sale Flow

For customer-voucher payments, `Complete Sale` performs CRM redemption before
local invoice persistence.

1. Renderer builds the normal sale payload.
2. POS local server detects customer-voucher payments.
3. For each customer-voucher payment, local server calls CRM `/redeem` with an
   idempotency key.
4. If any redeem fails, the sale fails and no local invoice is created.
5. If all redeems succeed, local server creates the invoice in the existing DB
   transaction.
6. If local invoice creation fails after CRM redeem, local server calls CRM
   `/redeem/void` for each successful redeem.
7. If void fails, local server logs the reconciliation context.

This keeps local `SaleInvoicePayment` unchanged while ensuring CRM balance is
the source of truth.

## Refund Flow

When refunding an invoice that contains customer-voucher tender:

- Repay remains blocked, even inside the usual 10-minute same-shift window.
- Normal refund is allowed only while CRM is reachable.
- The refund payment for customer-voucher amount triggers CRM `refund-issue`.
- The refund payment row stores:
  - `type = VOUCHER`
  - `entityType = "customer-voucher"`
  - `entityId = new CRM refund voucher id`
  - `entityLabel = new CRM voucher serial + expiry snapshot`

The original voucher is not restored.

## Constants

POS renderer:

```ts
export const CUSTOMER_VOUCHER_ISSUE_POINTS = 1000;
export const CUSTOMER_VOUCHER_ISSUE_AMOUNT = 1000; // cents
```

CRM server:

```ts
export const CUSTOMER_VOUCHER_ISSUE_POINTS = 1000;
export const CUSTOMER_VOUCHER_ISSUE_AMOUNT = 1000; // cents
export const CUSTOMER_VOUCHER_ISSUE_VALID_DAYS = 14;
export const CUSTOMER_VOUCHER_REFUND_VALID_DAYS = 7;
```

## Live CRM Database Safety

The CRM server currently targets a live database, not a disposable dev DB.

Implementation must follow these rules:

- Do not run destructive reset commands.
- Do not use `prisma db push` against the CRM database for this feature.
- Create a Prisma migration and inspect generated SQL before applying.
- New tables/enums/indexes should be additive.
- Existing member rows and point balances should not be rewritten except by
  explicit voucher issue transactions.
- Manual testing should use the intended test member account only.

## Verification Plan

CRM server:

- `npm run build`.
- Generate Prisma client after schema changes.
- Inspect migration SQL before applying to the live CRM database.
- Test issue with a member below 1000 points: expect failure.
- Test issue with a member at or above 1000 points: expect point deduction,
  point ledger row, voucher row, and voucher event.
- Test duplicate redeem `requestId`: expect no double decrement.
- Test void redeem: expect balance restored once.

POS local server:

- `npm run build`.
- Customer voucher issue proxy returns CRM voucher.
- Sale create with customer voucher persists payment row after CRM redeem.
- Forced local persistence failure after CRM redeem attempts void.

POS renderer:

- `npm run build`.
- Member cart shows Customer Voucher input.
- Non-member cart still shows User Voucher input.
- Issue button requires enough points.
- Existing valid vouchers remain selectable.
- Newly issued voucher becomes selected with amount `0`.
- `EXACT`, numpad, and `ADD CUSTOMER VOUCHER` match User Voucher behavior.

Manual regression:

- Customer voucher + cash sale.
- Customer voucher + credit/giftcard sale.
- Customer voucher-only sale.
- Customer-voucher invoice refund issues a new 7-day voucher.
- Customer-voucher invoice repay remains blocked.
