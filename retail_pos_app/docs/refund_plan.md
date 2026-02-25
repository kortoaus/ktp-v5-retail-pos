# Refund Process Plan

## Status: IN PROGRESS

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
- `getRefundableSaleInvoiceByIdService` computes remaining qty/total/tax by subtracting already-refunded rows
- Refund goes through manager auth — `user` passed to service for `userId` on invoice
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

### Schema Change — DONE

**`TerminalShift`** — added `refundsCash`, `refundsCredit` (Int, default 0).
Prisma client regenerated.

Settlement calc: `endedCashExpected = startedCash + salesCash - refundsCash`

### Server: Dedicated Refund Endpoint — DONE

**Route:** `POST /api/sale/refund`
**Files:** `sale.refund.service.ts`, `sale.refund.controller.ts`, `sale.router.ts`

**Server logic (inside `$transaction`):**
1. Fetch original invoice (type "sale") + all existing refund invoices
2. Validate each row: `original_invoice_row_id` exists, qty ≤ remaining
3. Validate payment caps: cash ≤ remaining cash cap, credit ≤ remaining credit cap (accounting for previous refunds)
4. Create `SaleInvoice` with `type: "refund"`, `original_invoice_id`, `userId: user.id`
5. Generate serial number
6. Increment `refundsCash` / `refundsCredit` on `TerminalShift` (in cents)
7. Return created invoice id
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

| File | Status | Change |
|------|--------|--------|
| `schema.prisma` | ✅ DONE | Added `refundsCash`, `refundsCredit` to `TerminalShift` |
| `sale.refund.service.ts` (server) | ✅ DONE | `createRefundInvoiceService()` with validation + shift update |
| `sale.refund.controller.ts` (server) | ✅ DONE | Controller with user auth |
| `sale.router.ts` (server) | ✅ DONE | `POST /sale/refund` route |
| `RefundPanels.tsx` | TODO | Third panel: refund document monitor + "Refund" button |
| `RefundScreen/RefundPaymentModal.tsx` | TODO | Cash/credit inputs, MoneyNumpad, confirm |
| `RefundScreen/RefundDocumentMonitor.tsx` | TODO | Item count, qty, subtotal, GST, refund due |
| `sale.service.ts` (client) | TODO | `createRefundInvoice()` API call |
| `refund-receipt.ts` (client) | TODO | Refund receipt renderer |
| `printer/` | — | Reuse `buildPrintBuffer` + `printESCPOS` |

### Remaining Work (client)

1. `RefundDocumentMonitor` — third panel summary from `refundedRows`
2. `RefundPaymentModal` — cash/credit inputs, MoneyNumpad, confirm flow
3. `sale.service.ts` — `createRefundInvoice()` API call
4. Wire modal into `RefundPanels.tsx` — "Refund" button, onComplete → navigate home
5. `refund-receipt.ts` — receipt renderer (separate template)
6. DB migration — `npx prisma db push` or migration for new shift fields
