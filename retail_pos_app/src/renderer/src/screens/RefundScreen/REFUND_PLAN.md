# Refund Screen Restructure Plan

> All values in DB/store are Int. Money = cents (×100), Qty = ×1000.
> The key change: refund now uses `total - discount_amount` instead of `total`.

---

## Current State — What's Wrong

1. **All Decimal.js** — every file imports Decimal, does `.add()/.sub()/.mul()/.div()`. Now Int, plain arithmetic.
2. **discount_amount ignored** — refund uses `row.total` as refund amount, but `discount_amount` (allocated promo+manual discount) is not subtracted. Customer gets refunded more than they paid.
3. **qty/weight display** — still raw numbers, need `/ QTY_SCALE` for display.
4. **fmt() uses Decimal** — `fmt(d: Decimal) => $${d.toFixed(2)}`. Should be `fmt(cents) => $${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`.
5. **RefundPaymentModal** — `cashRefund`/`creditRefund` stored as dollars, converted with `Math.round(x * 100)`. Should be cents natively.
6. **Server RefundRowDto** — missing `discount_amount` field.

---

## Key Design Decision: Net Total for Refund

```
Original row: total = 1000 (cents), discount_amount = 167 (cents)
Net = total - discount_amount = 833 (what customer actually paid)

Refund full qty: refund 833, not 1000
Refund partial: (833 / originalQty) × refundQty
```

**IMPORTANT**: Old invoices have `discount_amount = 0` (default). Their refund behavior is unchanged — `total - 0 = total`.

---

## Files to Modify

### 1. `refund.types.ts`
- Remove `Decimal` import
- `fmt` → Int cents version
- `ClientRefundableRow.applyQty` stays as-is (×1000 Int)

### 2. `RefundPanels.tsx` — Core refund logic
- Remove `Decimal` import
- `onQtyConfirm`: 
  - `inputQty` comes as ×1000 Int (from RefundQtyModal)
  - `appliedEffectiveUnitPrice = row.total / row.qty` → Int division, careful with rounding
  - `appliedTotal = Math.round(appliedEffectiveUnitPrice * inputQty / QTY_SCALE)` — wait, this needs thought...
  
  Actually, the correct approach for partial refund:
  ```
  netTotal = row.total - row.discount_amount    ← what was actually paid for this row
  refundTotal = Math.round(netTotal * inputQty / row.qty)
  refundTax = Math.round(row.tax_amount_included * inputQty / row.qty)
  refundDiscount = Math.round(row.discount_amount * inputQty / row.qty)
  ```
  
  For "all remaining":
  ```
  refundTotal = row.remainingTotal              ← server already computed remaining
  refundTax = row.remainingIncludedTaxAmount
  ```

  Wait — `remainingTotal` is based on `row.total`, not net. The server needs to also track `remainingDiscountAmount`. 
  
  Actually, for simplicity: remaining is always computed from original. If partial refunds happened before, those refund rows already subtracted proportionally. So `remainingTotal = original.total - Σ(refund.total)` where each refund.total was computed proportionally.
  
  **Decision**: Keep `remainingTotal` as-is from server. For new refund calculation:
  - Full remaining: use `remainingTotal`, `remainingIncludedTaxAmount` as-is
  - Partial: calculate proportionally from original values

### 3. `RefundDocumentMonitor.tsx`
- Remove Decimal, use Int arithmetic
- Display: `cents / MONEY_SCALE`

### 4. `RefundableRowCard.tsx`
- Remove Decimal
- `unitPrice = row.total / row.qty` → plain Int division... but this gives cents per ×1000 unit
  - Actually: `unitPrice = Math.round(row.total * QTY_SCALE / row.qty)` to get cents per 1 unit
  - Or just display: `row.unit_price_effective` which is already correct
- qty display: `row.remainingQty / QTY_SCALE` / `row.qty / QTY_SCALE`

### 5. `RefundedRowCard.tsx`
- Remove Decimal
- Same display fixes

### 6. `RefundQtyModal.tsx`
- `row.remainingQty` is now ×1000. Display: `/ QTY_SCALE`
- User types float (e.g. "2"), convert to ×1000 on confirm: `Math.round(parsed * QTY_SCALE)`
- Validation: `inputQtyInt <= row.remainingQty`

### 7. `RefundPaymentModal.tsx`
- Remove ALL Decimal usage
- `cashRefund`/`creditRefund` → store as cents (Int) directly
- `refundTotal` = `Σ(row.total)` — already cents
- `refundGst` = `Σ(row.tax_amount_included)` — already cents
- Rounding: `Math.round(refundTotal / 5) * 5` for 5c
- `remaining` = `effectiveTotal - cashRefund - creditRefund - voucherTotal`
- Numpad: already returns cents
- Caps: `remainingCashCap`, `remainingCreditCap` — already cents from server
- Row payload: add `discount_amount` field

### 8. Server `sale.refund.service.ts`
- `RefundRowDto` — add `discount_amount: number`
- Store it in DB on create

---

## Implementation Order

1. `refund.types.ts` — fmt + remove Decimal
2. `RefundableRowCard.tsx` — Int display
3. `RefundedRowCard.tsx` — Int display
4. `RefundQtyModal.tsx` — qty ×1000 conversion
5. `RefundPanels.tsx` — core logic, Decimal → Int
6. `RefundDocumentMonitor.tsx` — Int display
7. `RefundPaymentModal.tsx` — full rewrite (Decimal → Int, cents native)
8. Server `sale.refund.service.ts` — add `discount_amount` to DTO + create
