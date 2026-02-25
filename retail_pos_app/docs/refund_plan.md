# Refund Process Plan

## Status: PLANNING (not yet implemented)

---

## Open Questions

### 1. Payment Methods

- Cash only? Or credit refund too?
- If credit refund, any surcharge reversal from original sale?
  answer: can be mixed. but cash and credit can not exceeded each original payment.

### 2. Rounding

- 5c rounding on cash refund (like sale), or exact amount?
  answer: yes. rounding with cash. but I think we don't have to restrict it.

### 3. Receipt

- Same receipt template with "REFUND" header, or separate template?
- Print automatically on confirm?
  answer: same template but I will separate template for future. print automatically.

### 4. Cash Drawer

- Kick drawer on cash refund?
  answer: yes.

### 5. Refund Total Calculation

- Sum `refundedRows` totals client-side to get refund total?
- Or does the server compute it?
  answer1: it doesn matter. just compute in client side and pass just results like sale invoice.(type: "refund")

answer2: I think we have to calculate remaining's or something strictly in server side. there can be race issues.

### 6. API Endpoint

- Same `createSaleInvoice` endpoint with `type: "refund"` + `original_invoice_id`?
- Or a dedicated refund endpoint?
  answer: dedicated endpoint.

### 7. After Completion

- Navigate back to home?
- Stay on refund screen (for another refund)?
- Clear state?
  answer: navigate back home

---

## What We Know So Far

### Current Flow (implemented)

1. User searches for an invoice on RefundScreen
2. Invoice loads as `RefundableInvoice` (rows patched with `remainingQty`, `remainingTotal`, `remainingIncludedTaxAmount`)
3. User clicks rows in left panel (Invoice Lines) to add to right panel (Refunded Lines)
   - **All-or-nothing**: `weight-prepacked` or `qty === 1` items add directly
   - **Partial**: Other items open `RefundQtyModal` (Numpad input, validates against `remainingQty`)
4. Each refunded row becomes a `ClientRefundableRow` with computed: `applyQty`, `unit_price_effective`, `total`, `tax_amount_included`, `original_invoice_row_id`, `original_invoice_id`
5. User can remove rows from refund list (confirm dialog)

### Third panel placeholder

- Currently shows `"function"` text — this is where refund payment/action buttons will go

### Server

- `SaleInvoice` table handles both sale and refund (`type` field)
- `SaleInvoiceRow` has `original_invoice_id` / `original_invoice_row_id` for refund linking
- Same `createSaleInvoiceService` creates both types
- `getRefundableSaleInvoiceByIdService` computes remaining qty/total/tax by subtracting already-refunded rows

### Existing Sale Payment Modal (reference)

- Discount (% or $), credit/cash split, 1.5% credit surcharge, 5c rounding
- MoneyNumpad + note denomination buttons
- Committed payment list with add/remove
- Creates invoice via `createSaleInvoice` service
- Fetches created invoice, prints receipt, kicks drawer
- Change screen overlay if overpaid

---

## Proposed Plan

### Overview

Refund total is computed client-side from `refundedRows`. Server validates remaining qty/total on its own (race protection). Dedicated refund endpoint. Simpler than sale payment — no discount, no surcharge.

### Third Panel: Refund Document Monitor

Like `DocumentMonitor` in SaleScreen. Computed from `refundedRows`:
- Item count (number of rows)
- Total qty (sum of `applyQty`)
- Subtotal (sum of row totals)
- GST (sum of row `tax_amount_included`)
- **Refund Due** (large, prominent)

### RefundPaymentModal (new, simple)

Opened from a "Refund" button in the third panel (only enabled when refundedRows.length > 0).

**No split payment, no committed payment list.** Just two fields: cash and credit.
No surcharge on refund.

**Layout:**
- Refund total (read-only)
- GST included (read-only)
- Original payment caps: cash $X / credit $Y (from `invoice.payments`)
- Cash refund input (MoneyNumpad target, capped at original cash)
- Credit refund input (MoneyNumpad target, capped at original credit)
- Cash + Credit must equal refund total (5c rounding on cash, not strictly enforced)
- MoneyNumpad (reuse existing)
- Confirm button (disabled until balanced)

**Reused UI primitives:**
- `MoneyNumpad`
- `InputField` from `PaymentParts.tsx`
- `SummaryRow` from `PaymentParts.tsx`
- `ModalContainer`

**On Confirm:**
1. Build refund invoice payload:
   - `type: "refund"`
   - `original_invoice_id: invoice.id`
   - `rows`: refundedRows mapped to InvoiceRowDto (with `original_invoice_row_id`)
   - `total`: positive (server knows it's refund by type)
   - `payments`: `[{ type: "cash", amount, surcharge: 0 }, { type: "credit", amount, surcharge: 0 }]`
   - `subtotal` = sum of row totals
   - `documentDiscountAmount: 0`, `creditSurchargeAmount: 0`
   - `rounding`: 5c rounding amount (if cash)
   - `taxAmount`: sum of row `tax_amount_included`
   - `cashPaid`, `cashChange: 0`, `creditPaid`
   - `totalDiscountAmount: 0`
2. POST to dedicated refund endpoint
3. Server validates remaining qty/total (race protection), creates invoice
4. Fetch created invoice
5. Print refund receipt
6. Kick cash drawer (if cash refund > 0)
7. Navigate to home

### Schema Change

**`TerminalShift`** — add:
```prisma
refundsCash    Int @default(0)
refundsCredit  Int @default(0)
```

Settlement calc: `endedCashExpected = startedCash + salesCash - refundsCash`

On sale creation: `salesCash += cashPaid`, `salesCredit += creditPaid`
On refund creation: `refundsCash += cashPaid`, `refundsCredit += creditPaid`

### Server: Dedicated Refund Endpoint

**Route:** `POST /api/sale/refund`

**Request body:** Same shape as `CreateSaleInvoiceDto` + `original_invoice_id: number`

**Server logic:**
1. Fetch original invoice + all existing refund invoices for it
2. For each row in the request, validate:
   - `original_invoice_row_id` exists on the original invoice
   - `qty` does not exceed remaining qty (original qty - sum of already-refunded qty)
3. Validate total payment amounts:
   - Cash refund ≤ original cash paid (across all payments)
   - Credit refund ≤ original credit paid
4. Create `SaleInvoice` with `type: "refund"`, `original_invoice_id`
5. Update `TerminalShift`: increment `refundsCash` / `refundsCredit`
6. Return created invoice id

### Refund Receipt

- Separate file: `refund-receipt.ts`
- Same canvas/ESC-POS approach as `sale-invoice-receipt.ts`
- Header: "REFUND" instead of "TAX INVOICE"
- Show original invoice serial number
- List refunded items with qty and total
- Show refund total, GST, payment method breakdown
- QR code of refund invoice serial number
- Print timestamp

### File Changes Summary

| File | Change |
|------|--------|
| `schema.prisma` | Add `refundsCash`, `refundsCredit` to `TerminalShift` |
| `RefundPanels.tsx` | Third panel: refund document monitor + "Refund" button |
| `RefundScreen/RefundPaymentModal.tsx` | New: cash/credit inputs, MoneyNumpad, confirm |
| `RefundScreen/RefundDocumentMonitor.tsx` | New: item count, qty, subtotal, GST, refund due |
| `sale.service.ts` (client) | New: `createRefundInvoice()` API call |
| `sale.router.ts` (server) | New: `POST /sale/refund` route + controller |
| `sale.service.ts` (server) | New: `createRefundInvoiceService()` with validation + shift update |
| `refund-receipt.ts` (client) | New: refund receipt renderer |
| `printer/` | Reuse `buildPrintBuffer` + `printESCPOS` |
