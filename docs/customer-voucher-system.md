# Customer Voucher System

Customer Voucher is a CRM-owned voucher tender used by the retail POS. The POS
renderer never talks to CRM directly. It talks to the local POS server, and the
local POS server proxies device-authenticated Customer Voucher calls to
`ktpv5-crm-server`.

The first release supports:

- POS-issued point-exchange Customer Vouchers.
- Existing valid Customer Voucher lookup.
- Sale redemption with idempotent CRM redeem and POS-side redeem void on local
  persistence failure.
- Refund issuance of a new Customer Voucher.
- Repay blocking for invoices that used Customer Voucher.

Out of scope:

- Offline Customer Voucher issue, redemption, or refund.
- Mobile point-to-voucher exchange.
- Mirroring full CRM voucher history into the POS local database.

## Ownership

| Area | Owner | Notes |
| --- | --- | --- |
| Voucher rows | CRM server | `CustomerVoucher` table. |
| Voucher event ledger | CRM server | `CustomerVoucherEvent` table. |
| Point deduction for issue | CRM server | `Member.points` and `MemberPointLedger`. |
| Sale invoice/payment rows | POS local server | `SaleInvoicePayment` stores CRM voucher id and label snapshot. |
| POS payment/refund UI | POS renderer | Builds normal POS payloads; no direct CRM calls. |

## Core Data Model

CRM stores the canonical voucher state:

```text
CustomerVoucher
  id                 CRM numeric voucher id
  companyId
  memberId           CRM member id
  serial             YYYY-XXXX-XXXX-XXXX
  kind               POINT_EXCHANGE | REFUND
  initAmount         cents
  balance            cents
  status             ACTIVE | EXPIRED | ARCHIVED
  validFrom
  validTo
  sourcePointLedgerId
  createdByDeviceId

CustomerVoucherEvent
  voucherId
  type               ISSUE | REDEEM | VOID_REDEEM | REFUND_ISSUE | ...
  amount             signed cents
  requestId          idempotency key when applicable
  entityType
  entityId
  entitySerial
  note
```

POS stores only the tender snapshot on invoice payment rows:

```text
SaleInvoicePayment
  type        VOUCHER
  amount      cents
  entityType  customer-voucher
  entityId    CRM CustomerVoucher.id
  entityLabel CRM label snapshot, e.g. "2026-ABCD-2345-WXYZ - Exp 26-05-20"
```

`entityId` for sale payments points to the redeemed CRM voucher. For refund
payments, `entityId` points to the newly issued CRM refund voucher.

## Constants

| Constant | Value | Owner |
| --- | ---: | --- |
| Customer Voucher issue point cost | 1000 points | CRM/POS renderer |
| Point-exchange issue amount | 1000 cents ($10) | CRM/POS renderer |
| Point-exchange validity | 14 days | CRM |
| Refund voucher validity | 7 days | CRM |

## Label Format

CRM generates the Customer Voucher label once and returns it to POS:

```text
{serial} - Exp YY-MM-DD
```

The POS stores this string as `SaleInvoicePayment.entityLabel`, so receipt
reprint and invoice search continue to show the same expiry label even if the
CRM voucher changes later.

## Modules

```text
POS renderer
  retail_pos_app/src/renderer/src/service/customer-voucher.service.ts
  retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/
    CustomerVoucherInput.tsx
    SearchCustomerVoucherModal.tsx
    index.tsx
  retail_pos_app/src/renderer/src/libs/refund/
    compute.ts
    build-payload.ts

POS local server
  retail_pos_server/src/v1/customer-voucher/
    customer-voucher.router.ts
    customer-voucher.controller.ts
    customer-voucher.service.ts
    customer-voucher.types.ts
  retail_pos_server/src/v1/sale/
    sale.create.service.ts
    sale.refund.service.ts
    sale.repay.service.ts

CRM server
  ktpv5-crm-server/src/device/customer-voucher/
    customerVoucher.routes.ts
    customerVoucher.controller.ts
    customerVoucher.service.ts
    customerVoucher.serial.ts
    customerVoucher.types.ts
  ktpv5-crm-server/prisma/schema.prisma
```

## HTTP Boundary

Renderer uses local POS routes:

```text
GET  /api/customer-voucher/valid?memberId=...
POST /api/customer-voucher/issue
POST /api/customer-voucher/redeem
POST /api/customer-voucher/redeem/void
POST /api/customer-voucher/refund-issue
```

POS local server proxies to CRM device routes:

```text
GET  /device/customer-voucher/valid?memberId=...
POST /device/customer-voucher/issue
POST /device/customer-voucher/redeem
POST /device/customer-voucher/redeem/void
POST /device/customer-voucher/refund-issue
```

All local POS routes require the existing terminal/user context. Customer
Voucher local routes are protected with `sale` scope because they can create or
move monetary value.

## Scenario 1: Valid Voucher Lookup

The cashier opens Customer Voucher search in PaymentModal.

```text
[Cashier]
    |
    v
[POS Renderer: SearchCustomerVoucherModal]
    |
    | GET /api/customer-voucher/valid?memberId=M
    v
[POS Local Server: customer-voucher.controller]
    |
    | crmApiService GET /device/customer-voucher/valid?memberId=M
    v
[CRM Device API: customerVoucher.controller]
    |
    v
[CRM Service: getValidCustomerVouchers]
    |
    | SELECT active, unexpired, positive-balance vouchers
    v
[CRM DB: CustomerVoucher]
    |
    v
[POS Renderer receives CustomerVoucher[]]
```

CRM filters by:

```text
companyId
memberId
status = ACTIVE
validFrom <= now
validTo >= now
balance > 0
```

The renderer additionally disables vouchers already committed in the current
payment list and shows them as `In use`.

## Scenario 2: POS Issues A $10 Customer Voucher

The cashier issues a fixed $10 voucher from PaymentModal. The active member
must have at least 1000 points.

```text
[Cashier taps ISSUE $10]
    |
    v
[POS Renderer: SearchCustomerVoucherModal]
    |
    | POST /api/customer-voucher/issue { memberId }
    v
[POS Local Server]
    |
    | POST /device/customer-voucher/issue { memberId }
    v
[CRM Service: issueCustomerVoucher]
    |
    | transaction
    | - lock/load Member
    | - verify points >= 1000
    | - create CustomerVoucher kind=POINT_EXCHANGE
    | - create MemberPointLedger REDEEM -1000
    | - decrement Member.points
    | - create CustomerVoucherEvent ISSUE +1000
    v
[CRM DB]
    |
    v
[POS Renderer selects voucher with amount 0]
```

Important behavior:

- Existing valid vouchers do not block another issue.
- The newly issued voucher is selected, but staged amount remains `0`; the
  cashier must intentionally enter or press `EXACT`.
- The returned `memberPoints` updates the active cart member point balance.

## Scenario 3: Sale Redeems Customer Voucher

Customer Voucher is committed as a normal POS payment:

```text
PaymentQueueItem
  tender      VOUCHER
  entityType  customer-voucher
  entityId    CRM voucher id
  entityLabel CRM label snapshot
  amount      cents to redeem
```

On sale completion, the POS local server redeems CRM value before local invoice
persistence.

```text
[POS Renderer: Complete Sale]
    |
    | POST /api/sale payload
    v
[POS Local Server: createSaleService]
    |
    | validate sale math
    | detect customer-voucher payments
    | invoiceRequestId = randomUUID()
    v
[POS Local Server: redeemCustomerVouchersForSale]
    |
    | for each customer voucher payment:
    | requestId = invoiceRequestId:cv:voucherId:amount
    | POST /device/customer-voucher/redeem
    v
[CRM Service: redeemCustomerVoucher]
    |
    | transaction
    | - advisory lock requestId
    | - idempotency check CustomerVoucherEvent.requestId
    | - verify voucher active, valid, member-owned
    | - verify balance >= amount
    | - decrement balance
    | - create CustomerVoucherEvent REDEEM -amount
    v
[POS Local Server: buildSaleInTx]
    |
    | transaction
    | - create SaleInvoice
    | - create SaleInvoicePayment customer-voucher snapshot
    | - redeem local user-vouchers if any
    v
[POS DB]
```

The local sale fails before persistence if CRM is unreachable or redemption is
rejected.

## Scenario 4: Sale Redeem Succeeds But Local Persistence Fails

If CRM redemption succeeded but local invoice creation fails, POS attempts to
void the CRM redeems.

```text
[CRM REDEEM succeeded]
    |
    v
[POS local DB transaction fails]
    |
    v
[POS Local Server: voidRedeemedCustomerVouchersForSale]
    |
    | for every redeemed voucher:
    | requestId = redeemRequestId:void
    | POST /device/customer-voucher/redeem/void
    v
[CRM Service: voidCustomerVoucherRedeem]
    |
    | transaction
    | - find original REDEEM by redeemRequestId
    | - idempotency check VOID_REDEEM requestId
    | - increment voucher balance by original redeem amount
    | - create CustomerVoucherEvent VOID_REDEEM +amount
```

If one void fails, POS still attempts all remaining voids and logs reconciliation
context:

```text
redeemRequestId
voucherId
memberId
amount
terminal
cashier/user
shift
sale payload summary
void outcomes
```

## Scenario 5: Partial Redeem Failure

For multi-voucher sales, one CRM redeem may succeed and a later one may fail.
The helper compensates earlier successful redeems before rethrowing the original
CRM error.

```text
[Redeem voucher A] ---> success
       |
       v
[Redeem voucher B] ---> failure
       |
       v
[Void voucher A redeem]
       |
       v
[Sale returns failure; no local invoice]
```

This prevents CRM balance from being decremented without a matching local POS
invoice.

## Scenario 6: Refund Of Customer Voucher Tender

Refund does not restore the original Customer Voucher. Instead, CRM issues a
new `kind=REFUND` voucher valid for 7 days.

```text
[Cashier opens refund invoice]
    |
    v
[POS Renderer: SaleRefundDetailScreen]
    |
    | computeTenderCaps()
    | customer-voucher appears as refundable tender
    v
[POS Renderer: buildRefundPayload]
    |
    | payment before submit:
    | type=VOUCHER
    | entityType=customer-voucher
    | entityId=original CRM voucher id
    | entityLabel=original CRM label
    v
[POS Local Server: createRefundService]
    |
    | lock original invoice
    | compute refund rows/aggregates
    | validate tender caps
    | issue CRM refund voucher
    v
[CRM Service: issueRefundCustomerVoucher]
    |
    | transaction
    | - idempotency by entityType + entityId
    | - create CustomerVoucher kind=REFUND
    | - create CustomerVoucherEvent REFUND_ISSUE +amount
    v
[POS Local Server]
    |
    | replace payment metadata:
    | entityId = new CRM refund voucher id
    | entityLabel = new CRM refund voucher label
    v
[POS DB: create REFUND invoice/payment]
```

The original redeemed voucher balance is not changed by refund.

## Scenario 7: Refund Idempotency And Local Failure

CRM refund issue is idempotent by:

```text
entityType = pos-refund-request
entityId   = stable POS refund intent key
```

The POS stable key includes:

```text
originalInvoiceId
customer-voucher-refund
original voucher key
refund amount
selected refund rows and quantities
```

This means retrying the same refund intent after a local POS failure asks CRM
for the same refund voucher instead of minting another one.

```text
[CRM refund issue succeeds]
    |
    v
[POS local REFUND persistence fails]
    |
    v
[POS logs reconciliation context]
    |
    v
[Cashier retries same refund intent]
    |
    v
[CRM returns already-issued refund voucher]
```

There is no CRM `refund-issue/void` endpoint in this release. If local
persistence fails after CRM issue and the cashier does not retry, the POS logs
the context needed for manual reconciliation.

## Scenario 8: Repeat Partial Refund Caps

Refund payments store the new CRM refund voucher id, not the original redeemed
voucher id. Because of that, customer-voucher caps are tracked as one aggregate
customer-voucher tender bucket for refund purposes.

```text
Original SALE payments
  VOUCHER customer-voucher #10  $6
  VOUCHER customer-voucher #11  $4

First REFUND payment persisted
  VOUCHER customer-voucher #90  $3   (#90 is new refund voucher)

Next refund cap
  original customer-voucher total = $10
  prior customer-voucher refunds  = $3
  remaining customer-voucher cap  = $7
```

User Voucher caps remain entity-specific because local user-voucher refunds
restore the original local voucher balance and keep the original entity id.

```text
VOUCHER:user-voucher:12       remains per voucher
VOUCHER:customer-voucher      aggregate bucket
```

## Scenario 9: Repay Block

Repay creates a full refund and replacement sale in one local transaction. It
remains blocked for Customer Voucher invoices because Customer Voucher refund
issues CRM value and original voucher restoration is intentionally not used.

```text
[POS Renderer requests repay]
    |
    v
[POS Local Server: createRepayService]
    |
    v
[loadOriginalOrThrow]
    |
    v
[validateEligibility]
    |
    | if any original payment entityType=customer-voucher
    v
[BadRequestException: Repay is not allowed for customer-voucher invoices]
```

## Failure Policy

Customer Voucher requires CRM connectivity.

| Operation | CRM unavailable behavior |
| --- | --- |
| Valid lookup | Search/issue UI cannot load vouchers. |
| Issue | Issue fails; no points or voucher change should occur. |
| Sale redeem | Sale fails before local invoice persistence. |
| Sale redeem void | POS logs manual reconciliation context if void fails. |
| Refund issue | Refund fails before local refund persistence if CRM call fails. |
| Repay | Blocked for customer-voucher invoices. |

## Invariants

- Customer Voucher balances are canonical in CRM.
- POS local `Voucher` and `VoucherEvent` tables are for user/staff vouchers
  only.
- POS stores Customer Voucher usage only as `SaleInvoicePayment` snapshots.
- Sale creation redeems CRM before local invoice persistence.
- Refund creates a new CRM refund voucher; it does not restore the original
  voucher.
- Repay is not allowed for Customer Voucher invoices.
- Customer Voucher refund caps are aggregate customer-voucher caps because
  persisted refund payments point to newly issued CRM refund vouchers.

## Operational QA Checklist

Use only the intended CRM test member when mutating live points or vouchers.

```text
1. Member below 1000 points
   - POS issue button disabled
   - direct issue API fails

2. Member at/above 1000 points
   - issue creates $10 voucher
   - points decrease by 1000
   - MemberPointLedger REDEEM exists
   - CustomerVoucherEvent ISSUE exists
   - POS selected amount remains 0

3. Sale redeem
   - CRM balance decreases
   - CustomerVoucherEvent REDEEM exists
   - POS SaleInvoicePayment stores customer-voucher id/label

4. Duplicate redeem requestId
   - second CRM call returns existing result
   - balance is not decremented twice

5. Redeem void
   - balance restores once
   - duplicate void is idempotent

6. Refund
   - original voucher balance unchanged
   - new CRM REFUND voucher created
   - new voucher valid for 7 days
   - POS refund payment points to new voucher id/label

7. Repeat partial refund
   - prior customer-voucher refund reduces remaining customer-voucher cap

8. Repay
   - server returns "Repay is not allowed for customer-voucher invoices"
```
