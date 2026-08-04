# Receipt Member Total Points — Design

Date: 2026-08-04
Status: approved

## Problem

Members who signed up by phone number only (no smartphone app — typically elderly
customers) have no way to see their accumulated point balance. The balance lives in
CRM; recording a per-invoice balance snapshot in Postgres would require a schema
change, which we explicitly want to avoid.

## Decision

Show `current balance + points earned this sale` in two places, computed entirely
in the renderer from data already in memory. **No schema, server, or viewer change.**

1. **PaymentModal header** — to the right of the member badge, during payment:
   `P 1,234 → 1,246` (balance → balance + `cal.pointsEarned` live estimate).
   Arrow segment only when `cal.pointsEarned > 0`; hidden in spend mode.
2. **Receipt, immediate post-sale print only** — one line `Total Points` directly
   under `Points Earned`, using the server-confirmed `invoice.pointsEarned`.

## Mechanics

- `completedInfo` (PaymentModal) gains `memberPointsBefore: number | null`,
  snapshotted from `activeMember?.points` at `setCompletedInfo` time — this runs
  before `clearActiveCart()` wipes the member, and the value is already refreshed
  by the customer-voucher flow (`setMember({...activeMember, points})`).
- `printSaleInvoiceReceipt` gains an optional trailing `memberTotalPoints?: number`.
  `handlePrintReceipt` passes `memberPointsBefore + detail.pointsEarned` when the
  snapshot exists and the invoice is a SALE. The line prints even when
  `pointsEarned` is 0 — the total is what the customer wants to see.
- Both render modes add the line, gated on `type === "SALE" && memberTotalPoints != null`:
  - raster: `sale-invoice-receipt.ts` render + `estimateHeight()` conditional +1 line
  - escpos: `BuildSaleInvoiceEscposOptions.memberTotalPoints` → `appendTaxAndSavings`
    (ASCII label, no encoding concern)
- Every other call site (reprint chain, Print Latest, refund, SPEND, viewer Print
  Copy) omits the argument, so the line never appears there — the balance is not
  stored anywhere, so a later reprint could not know it anyway.

## Known trade-offs (accepted)

- The balance is a snapshot from the last CRM fetch for that member; concurrent
  earning at another terminal is not reflected.
- Works offline as long as the member is attached to the cart.
- The on-screen `SaleInvoiceViewer` does not show the line (it renders from stored
  data only) — deliberate, per the no-schema-change constraint.

## Verification

`npx tsc --noEmit -p tsconfig.web.json`; manual sale-with-member print per
TEST_CHECKLIST scope (requires hardware).
