# Sale Point Earning Design

Date: 2026-05-06

## Scope

Add point earning to completed `SALE` invoices only.

This first version does not subtract or reverse points on `REFUND`, `SPEND`, or
repay flows. Refund reversal can be designed later after the CRM/cloud point
ledger behavior is clear.

## Goals

- Earn points only when a member is attached to the cart.
- Exclude lines whose item snapshot has `isPointExcluded = true`.
- Use `StoreSetting.cash_point_rate` for the cash-paid portion and
  `StoreSetting.other_point_rate` for eligible non-voucher tender portions.
- Store the final earned point count on the invoice.
- Store each row's point-exclusion snapshot on the invoice row.
- Show earned points on printed receipts and invoice viewer previews.

## Non-Goals

- No refund point deduction.
- No point payment tender.
- No point ledger implementation in the POS.
- No storage of point-rate snapshots or per-row point allocation in this phase.
- No customer voucher or CRM conversion changes.

## Data Model

Prisma schema changes:

```prisma
model SaleInvoice {
  pointsEarned Int @default(0)
}

model SaleInvoiceRow {
  isPointExcluded Boolean @default(false)
}
```

Client/server payload and response types should mirror these fields:

- `SaleRowPayload.isPointExcluded`
- `SaleInvoiceRowItem.isPointExcluded`
- `SaleInvoiceListItem.pointsEarned`
- `SaleInvoiceCreated.pointsEarned`, if the completion flow needs it
- Server `SaleCreatePayload` row type includes `isPointExcluded`

`Item.isPointExcluded` is snapshotted into `SaleLineItem` at scan time, then
carried by `SaleLineType`. The sale row payload uses that cart-line snapshot,
not the current item master record.

## Calculation

The preview calculation belongs in `usePaymentCal`, because that hook already
owns the settled payment math:

- line totals
- cash applied versus cash received/change
- non-cash bill portions
- rounding
- credit surcharge split
- remaining/paid state

Inputs needed by point earning:

- cart lines, including `isPointExcluded`
- member presence
- `cash_point_rate`
- `other_point_rate`
- committed and staged payment allocation

The point base is the sum of eligible sale line totals:

```text
eligiblePointBase = sum(row.total where isPointExcluded = false)
```

If there is no member, `pointsEarned = 0`.

If there is a member:

```text
cashBase = eligiblePointBase * cashApplied / linesTotal
earningBase = eligiblePointBase * (linesTotal - voucherBill) / linesTotal
otherBase = earningBase - cashBase

pointsEarned =
  round(cashBase * cash_point_rate / 1000)
  + round(otherBase * other_point_rate / 1000)
```

`cashApplied` is used instead of cash received so change does not earn points.
Surcharge is not part of the point base; item line totals are the point base.
Rounding is also excluded from the point base.
Voucher redemption is excluded from the point-earning base.

For mixed tender, the eligible point base is split proportionally by the cash
portion of the bill and the remaining eligible non-voucher bill portion. This
keeps excluded items and tender splitting predictable without requiring
per-line tender allocation.

The server should recalculate the canonical `pointsEarned` at sale creation
using:

- `payload.member`
- `payload.rows`
- `payload.payments`
- voucher payment total
- `context.storeSetting.cash_point_rate`
- `context.storeSetting.other_point_rate`

The client-sent point preview should not be trusted as canonical unless the
server validates it.

## Sale Creation Flow

Client:

1. Item scan copies `item.isPointExcluded` into `SaleLineItem`.
2. Cart line keeps `isPointExcluded`.
3. `usePaymentCal` exposes `pointsEarned`.
4. `buildSalePayload` includes `isPointExcluded` on each row.
5. The completion UI can show points before the cashier completes the sale.

Server:

1. `validateAmounts` keeps its existing money invariant checks.
2. Sale create computes `pointsEarned` only for `payload.type === "SALE"` and
   `payload.member != null`.
3. `SaleInvoice.pointsEarned` is written with the computed value.
4. Each nested `SaleInvoiceRow` stores `isPointExcluded`.

## Receipt And Viewer

`retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts` should
print earned points for normal `SALE` invoices when `pointsEarned > 0`.

Suggested placement: the GST / You Saved section.

```text
GST Included        $9.09
You Saved           $2.00
Points Earned       123
```

`retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx` should show
the same row in the receipt preview.

Do not show points earned for `REFUND` or `SPEND` in this phase.

## Testing

The repo has no configured test runner, so use focused pure helper tests only
if a lightweight test harness is introduced. Otherwise verify through TypeScript
builds:

- `cd retail_pos_app && npm run build`
- `cd retail_pos_server && npm run build`

Manual scenarios:

- No member attached: points are zero and hidden from receipt/viewer.
- Member attached, all eligible cash sale: cash point rate applies.
- Member attached, all eligible credit sale: other point rate applies.
- Member attached, mixed cash/credit sale: point base splits by tender.
- Member attached, voucher-only sale: points are zero.
- Member attached, voucher plus cash/credit sale: only the non-voucher bill
  portions earn points.
- Member attached, excluded item only: points are zero.
- Member attached, eligible plus excluded item: only eligible line totals earn.
- Cash received with change: only `cashApplied` earns points.
