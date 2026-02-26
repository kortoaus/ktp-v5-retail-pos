# Refunds

> Finding an invoice, selecting items to refund, and processing the return.

---

## Requirements

- A shift must be open
- Must have the **refund** permission

---

## Steps Overview

1. Search for the original sale invoice
2. Select items to refund (full or partial)
3. Review the refund summary
4. Process the refund payment

---

## Step 1: Find the Invoice

1. From the Home screen, tap **Refund**.
2. Tap **Search Invoice**.
3. Search by serial number, item name, or barcode.
4. Select the invoice — only **sale** type invoices can be refunded.

The system loads the invoice with all its items and calculates what's still refundable (accounting for any previous partial refunds).

---

## Step 2: Select Items

The screen shows three panels:

| Panel | Description |
|-------|-------------|
| **Invoice Lines** (left) | Original items with remaining refundable quantities |
| **Refunded Lines** (center) | Items you've selected for this refund |
| **Summary** (right) | Running totals and refund button |

### Adding Items to Refund

Tap an item in the left panel:

| Situation | Behaviour |
|-----------|-----------|
| Weight-prepacked item | Added automatically (all-or-nothing) |
| Qty = 1 | Added automatically (only one to refund) |
| Remaining qty = 1 | Added automatically (only one left) |
| Remaining qty = 0 | Blocked — already fully refunded |
| Qty > 1 and remaining > 1 | Opens quantity input — enter how many to refund |

### Partial Quantity Refunds

When entering a quantity:
- Cannot exceed the remaining quantity
- The refund amount is calculated proportionally: `refund total = (qty ÷ original qty) × original total`
- Tax is also allocated proportionally

### Removing Items from Refund

Tap an item in the center panel (Refunded Lines) to remove it. A confirmation dialog appears.

---

## Step 3: Refund Payment

Tap **Refund** in the summary panel. The Refund Payment Modal opens.

### Payment Caps

The refund payment is **capped** by the original payment method:

```
Max cash refund = original cash paid − already refunded cash
Max credit refund = original credit paid − already refunded credit
```

For example, if the original sale was $50 cash + $30 credit, and $20 cash was already refunded, the remaining cash cap is $30.

### No Surcharge

Refunds do **not** have a credit card surcharge.

### Rounding

5-cent rounding is applied to the refund total (same rules as sales).

---

## What Gets Saved

The refund creates a new invoice with:
- Type = **"refund"**
- Link to the original invoice via `original_invoice_id`
- Each refunded row links back to the original row
- Store information from StoreSetting (same as sales)
- Serial number in the same format as sales

---

## Server Validation

The server validates every refund in a transaction:

1. **Original invoice exists** and is a "sale" type
2. **Per-row quantity check** — refund qty ≤ remaining qty (original − already refunded)
3. **Cash payment cap** — cash refund ≤ remaining cash (original cash − already refunded cash)
4. **Credit payment cap** — credit refund ≤ remaining credit

If any check fails, the entire refund is rejected.

---

## After the Refund

- A refund receipt prints automatically (see [Refund Receipt](./13-receipt-refund.md))
- The refunded quantities are deducted from the original invoice's remaining totals
- Future refund attempts on the same invoice will show updated remaining quantities
- The refund is linked to the current shift and terminal

---

## Multiple Partial Refunds

An invoice can be refunded multiple times:
- Each refund reduces the remaining quantities
- When all items are fully refunded, no more refunds are possible
- Each partial refund gets its own invoice and serial number
