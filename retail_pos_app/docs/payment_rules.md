# Payment Rules

How the Retail POS calculates the final amount, tax, rounding, and change.

All calculations use `decimal.js` to avoid floating-point errors. All amounts are in dollars.

---

## Calculation Chain

```
subTotal
  → documentDiscountAmount
  → exactDue = subTotal - documentDiscountAmount
  → creditSurchargeAmount = creditReceived × 1.5%
  → totalDue = exactDue + creditSurchargeAmount
  → roundedTotalDue = round to 5c (only when cash is involved)
  → taxAmount (from unrounded exactDue + surcharge)
  → remaining = roundedTotalDue - cashReceived - creditReceived
```

---

## Step by Step

### 1. Subtotal

Sum of all line totals (effective unit price × quantity per line).

```
subTotal = Σ line.total
```

### 2. Taxable Ratio

Proportion of the subtotal that is taxable. Used later to distribute tax across goods and surcharge.

```
taxableRatio = (Σ taxable line totals) ÷ subTotal
```

If subtotal is zero, taxable ratio is zero (no division by zero).

### 3. Document Discount

A whole-document discount applied after line-level pricing. Two methods:

| Method  | Calculation                |
| ------- | -------------------------- |
| Percent | subTotal × (percent ÷ 100) |
| Amount  | Flat dollar amount         |

**Capped at subTotal** — discount cannot exceed the subtotal. The due can never go negative from a document discount.

### 4. Exact Due

What the customer owes before surcharges and rounding.

```
exactDue = subTotal - documentDiscountAmount
```

### 5. Credit Card Surcharge

A 1.5% surcharge applied to the credit card payment amount.

```
creditSurchargeAmount = creditReceived × 0.015
```

The surcharge is calculated on the amount actually paid by credit, not on the total due. If the customer pays $50 by credit on a $100 bill, the surcharge is on $50.

### 6. Total Due

```
totalDue = exactDue + creditSurchargeAmount
```

### 7. Cash Rounding (Australian 5-Cent Rule)

Australia eliminated 1c and 2c coins. Cash transactions are rounded to the nearest 5 cents using Swedish rounding (round half up).

| Last digit(s) | Rounds to     |
| ------------- | ------------- |
| .01, .02      | .00 (down)    |
| .03, .04, .05 | .05 (up/stay) |
| .06, .07      | .05 (down)    |
| .08, .09      | .10 (up)      |

**Rounding only applies when cash is involved.** Full credit card payments are not rounded.

```
if cashReceived > 0:
  roundedTotalDue = totalDue rounded to nearest 0.05 (ROUND_HALF_UP)
else:
  roundedTotalDue = totalDue
```

The rounding adjustment is tracked separately for the receipt:

```
cashRounding = roundedTotalDue - totalDue
```

This can be positive (rounded up) or negative (rounded down), and appears as a line on the receipt.

### 8. Tax (GST)

All prices are GST-inclusive (10% GST). Tax is extracted, not added.

```
GST = (taxable amount) ÷ 11
```

Tax is calculated on the **unrounded** amounts to avoid rounding affecting the tax figure:

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = creditSurchargeAmount × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

The credit surcharge is subject to GST in proportion to taxable goods.

### 9. Remaining / Change

```
remaining = roundedTotalDue - cashReceived - creditReceived
```

| remaining | Meaning                            |
| --------- | ---------------------------------- |
| > 0       | Customer still owes this amount    |
| = 0       | Fully paid                         |
| < 0       | Change due to customer (abs value) |

---

## Total Discount (Receipt Summary)

For the receipt "You Saved" line, the total discount combines line-level and document-level discounts:

```
originalSubTotal = Σ (line.unit_price_original × line.qty)
totalDiscountAmount = (originalSubTotal - subTotal) + documentDiscountAmount
```

- `originalSubTotal - subTotal` = all line-level savings (price overrides, promo prices, line discounts)
- `+ documentDiscountAmount` = the document-level discount

---

## Payment Methods

| Method        | Surcharge              | Rounding             |
| ------------- | ---------------------- | -------------------- |
| Cash only     | None                   | 5c rounding applies  |
| Credit only   | 1.5%                   | No rounding          |
| Cash + Credit | 1.5% on credit portion | 5c rounding on total |

---

## Example

Cart: 3 items totalling $47.83 (of which $32.00 is taxable).

Document discount: 5% → $2.39.

```
subTotal         = $47.83
taxableRatio     = 32.00 ÷ 47.83 = 0.6690...
documentDiscount = 47.83 × 0.05 = $2.39
exactDue         = 47.83 - 2.39 = $45.44
```

Customer pays $20.00 credit + rest cash:

```
creditSurcharge  = 20.00 × 0.015 = $0.30
totalDue         = 45.44 + 0.30 = $45.74
roundedTotalDue  = $45.75 (rounded up to nearest 5c)
cashRounding     = 45.75 - 45.74 = +$0.01
```

Tax:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.30 × 0.6690 = $0.20
taxAmount        = (30.40 + 0.20) ÷ 11 = $2.78
```

Customer gives $30 cash:

```
remaining = 45.75 - 30.00 - 20.00 = -$4.25 (change)
```

Receipt shows:

```
Subtotal:          $47.83
Discount (5%):     -$2.39
Credit Surcharge:   $0.30
Cash Rounding:     +$0.01
─────────────────────────
Total:             $45.75
  Credit:          $20.00
  Cash:            $30.00
  Change:           $4.25
─────────────────────────
GST Included:       $2.78
You Saved:          $X.XX
```
