# Payment

> Processing cash and credit payments, surcharges, rounding, and GST.

---

## Opening the Payment Screen

From the Sale screen, tap **Pay** (bottom-right). The Payment Modal opens with:

- **Left panel** — numpad for entering amounts + quick note buttons ($100, $50, etc.)
- **Center panel** — payment summary showing all calculations
- **Right panel** — discount, cash, and credit input fields

---

## Payment Flow

### 1. Apply Document Discount (optional)

Tap the **Discount** field and enter a discount:
- **Percentage mode** — e.g. enter 10 for 10% off
- **Dollar mode** — e.g. enter 5.00 for $5 off

The discount cannot exceed the subtotal.

### 2. Enter Payment

Tap **Cash** or **Credit** to select the payment target, then enter the amount using the numpad.

**Shortcut**: Tap Cash or Credit twice when it's already selected and the amount is zero — the system auto-fills the remaining amount.

**Quick notes**: Tap $100, $50, $20 etc. to add that amount to the cash field.

### 3. Split Payment (optional)

For split payments (part cash, part credit):
1. Enter the cash amount and tap **Add Payment**
2. Switch to credit and enter the credit amount
3. Or vice versa

Multiple payment lines can be committed. Tap a committed line to remove it.

### 4. Complete

When the remaining amount is zero (or overpaid with cash), tap **Confirm Payment**.

---

## How the Total is Calculated

```
Subtotal = sum of all line totals
Document Discount = subtotal × percentage, or fixed amount
Exact Due = subtotal − document discount
```

### 5-Cent Rounding (Australian Rule)

If the payment includes **any cash**:
```
Rounded Due = exact due rounded to nearest 5 cents
Rounding = rounded due − exact due
```

If paying entirely by credit card, **no rounding** is applied.

### Credit Card Surcharge

Each credit payment line has a surcharge:
```
Surcharge = credit amount × surcharge rate (from Store Settings)
```

Default rate is 1.5%. The surcharge is **separate from the sale total** — it is charged on the EFTPOS machine on top of the base amount.

```
EFTPOS total = credit amount + surcharge
```

**Important**: The sale total (`cashPaid + creditPaid`) always balances without surcharge. The surcharge is tracked separately.

---

## GST Calculation

Australian GST is tax-inclusive — prices already contain 10% GST (÷11).

### Goods Tax
```
Taxable ratio = sum of taxable line totals ÷ subtotal
Goods tax = exact due × taxable ratio ÷ 11
```

### Surcharge Tax
```
Surcharge tax = total surcharge ÷ 11
```

### Total Tax
```
Tax amount = goods tax + surcharge tax
```

### Per-Line Tax Allocation

The goods tax is distributed across taxable lines using the **largest-remainder method**:

1. Calculate each taxable line's share: `line total ÷ taxable total × goods tax`
2. Floor each to 2 decimal places
3. Distribute remaining cents one-by-one to lines with the largest fractional remainders

This ensures per-line tax amounts sum to exactly the total goods tax — no rounding errors.

---

## Change

If the customer overpays with cash:
```
Change = total cash paid − due amount
```

A change screen appears showing the amount to give back. The cash drawer opens automatically when cash is received.

---

## What Gets Saved

The invoice records:

| Field | Value |
|-------|-------|
| Subtotal | Sum of line totals |
| Document Discount | Amount deducted |
| Credit Surcharge | Sum of all credit surcharges |
| Rounding | 5c adjustment (positive or negative) |
| Total | Effective due (what the customer pays, excluding surcharge) |
| Tax Amount | Goods tax + surcharge tax |
| Cash Paid | Cash applied to the bill (received minus change) |
| Cash Change | Change given back |
| Credit Paid | Credit amount (excluding surcharge) |
| Total Discount | Line discounts + document discount |
| Payments | Each payment line with type, amount, and surcharge |
| Rows | Each item with all price details and per-line tax |

### Serial Number

Each invoice gets a serial number: `companyId-shiftId-terminalId-invoiceId`

### Receipt

A sale receipt prints automatically after payment (see [Sale Receipt](./12-receipt-sale.md)). If the customer paid any cash, the drawer kicks open.

---

## Validation

The server validates before saving:
- At least one row and one payment required
- Row totals must approximately equal subtotal (within 2c tolerance)
- Payment total must approximately equal the sale total
- Total must approximately equal subtotal − discount + rounding

If validation fails, the sale is rejected with an error message.

---

## Summary

```
subtotal = Σ line totals
discount = subtotal × percent OR fixed amount
exact due = subtotal − discount
rounded due = round to nearest 5c (if cash)
effective due = has cash? rounded due : exact due
surcharge = Σ (credit amount × rate) per credit line
change = max(0, total cash − effective due)
cash paid = min(total cash, effective due − total credit)
tax = (exact due × taxable ratio ÷ 11) + (surcharge ÷ 11)
```
