# Refund Rules

How the POS processes refunds against previously completed sales.

---

## Overview

A refund creates a new invoice with `type: "refund"` linked to the original sale via `original_invoice_id`. Refunds can be full or partial — by item and by quantity. The refund amount is calculated from the selected items, not entered manually.

---

## Refund Flow

### 1. Find the Original Invoice

The manager searches for a sale invoice using the Invoice Search screen. Search supports keyword (serial number, item name, barcode), date range, and member filter. Barcode scanning auto-searches serial numbers.

### 2. Select Items to Refund

The original invoice's items are shown in the left panel. Each item displays its remaining refundable quantity (original qty minus already-refunded qty from previous refunds).

Clicking an item adds it to the refund list (right panel):

| Item Type | Behaviour |
|-----------|-----------|
| Weight-prepacked | All-or-nothing — added at full qty (weight items are indivisible) |
| Qty = 1 | Added directly — no quantity input needed |
| Remaining qty = 1 | Added directly — only one unit left, no choice |
| Qty > 1, remaining > 1 | Opens quantity input modal — enter how many to refund |

Items already fully refunded (remaining = 0) are blocked with an alert.

Items already in the current refund list are blocked — remove first to change quantity.

### 3. Refund Amounts

For partial quantity refunds, amounts are calculated proportionally from the original sale line:

```
effectiveUnitPrice = originalTotal ÷ originalQty
refundTotal        = effectiveUnitPrice × refundQty
refundTax          = originalTax × (refundQty ÷ originalQty)
```

When refunding the entire remaining quantity, the exact remaining values are used instead of proportional calculation (avoids accumulated rounding errors from multiple partial refunds).

### 4. Review

The third panel shows a live summary:
- Number of items selected
- Total quantity
- Refund subtotal
- GST included
- **Refund Due** (the amount to give back)

### 5. Process Refund (Payment)

Pressing "Process Refund" opens the payment modal. The refund amount must be split between cash and credit, respecting the original sale's payment methods.

---

## Payment Rules

### Payment Method Caps

Each payment method is capped at the remaining refundable amount for that method from the original sale, accounting for any previous refunds:

```
remainingCashCap   = originalCashPaid − Σ previousRefundsCash
remainingCreditCap = originalCreditPaid − Σ previousRefundsCredit
```

The server provides `remainingCash` and `remainingCredit` with the refundable invoice data.

**Example:** Original sale paid $30 cash + $20 credit. First refund returned $10 cash. For the next refund: cash cap = $20, credit cap = $20.

### Rounding

The 5-cent rounding rule always applies to the refund total (same as sales). This means the refund amount is always rounded to the nearest 5 cents regardless of payment method.

### No Surcharge

Credit refunds do **not** incur a surcharge. The surcharge from the original sale is not reversed.

### Balance Requirement

Cash refund + credit refund must exactly equal the (rounded) refund total. The confirm button is disabled until balanced.

Double-tapping the cash or credit input auto-fills the remaining balance.

---

## Server Validation

The server validates every refund inside a database transaction to prevent race conditions (e.g., two terminals refunding the same item simultaneously):

1. **Row validation** — each refund row's `original_invoice_row_id` must exist on the original invoice, and qty must not exceed remaining qty
2. **Payment validation** — cash refund ≤ remaining cash cap, credit refund ≤ remaining credit cap
3. **Invoice creation** — `type: "refund"`, linked to original via `original_invoice_id` and `original_invoice_serialNumber`
4. **Shift update** — `refundsCash` and `refundsCredit` incremented on the terminal shift (used for settlement)

---

## Receipt

A refund receipt is printed automatically after confirmation. It uses a separate template from the sale receipt.

Refund receipt sections:
1. **Store header** — same as sale receipt
2. **\*\*\* REFUND \*\*\*** banner
3. **Meta** — refund invoice serial number, original invoice serial number, date/time, terminal
4. **Refunded items** — each item with qty and total
5. **Totals** — item count, rounding (if any), **REFUND TOTAL**
6. **Payments** — Cash Refunded, Credit Refunded
7. **Footer** — GST included, "Refund processed"
8. **QR code** — refund invoice serial number
9. **Print timestamp**

### Reprinting

When reprinting a sale invoice that has refunds, the system prints the sale receipt followed by all linked refund receipts as **one continuous paper** with a single cut at the end. Standalone refund reprints print individually.

---

## Cash Drawer

The cash drawer kicks automatically when cash is refunded (`cashPaid > 0`).

---

## After Completion

After a successful refund, the system navigates back to the home screen. The refund screen state is cleared.

---

## Settlement Impact

Refunds are tracked separately on the terminal shift:

```
endedCashExpected = startedCash + salesCash − refundsCash
```

Both `refundsCash` and `refundsCredit` are stored in cents on `TerminalShift` and updated atomically with each refund invoice creation.

---

## Restrictions

- Only `type: "sale"` invoices can be refunded (not other refunds)
- Manager authentication is required to access the refund screen
- A refund row always links back to the original row (`original_invoice_row_id`)
- Items cannot be refunded beyond their original quantity
- Payment caps cannot be exceeded beyond what was originally paid per method
