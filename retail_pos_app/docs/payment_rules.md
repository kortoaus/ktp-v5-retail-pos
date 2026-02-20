# Payment Rules

How the POS calculates the final amount, tax, rounding, and change.

All calculations use `decimal.js` to avoid floating-point errors. All amounts are in dollars.

---

## Calculation Chain

```
subTotal
  → documentDiscountAmount
  → exactDue = subTotal - documentDiscountAmount
  → roundedDue = exactDue rounded to 5c (ALWAYS, regardless of payment method)
  → rounding = roundedDue - exactDue
  → creditSurchargeAmount = creditReceived × 1.5% (separate from total)
  → eftposAmount = creditReceived + creditSurchargeAmount (what EFTPOS charges)
  → taxAmount (from unrounded exactDue + surcharge)
  → remaining = roundedDue - cashReceived - creditReceived
```

Key design: **surcharge is separate from the sale total.** The bill is `roundedDue`. The surcharge is collected via the EFTPOS machine on top. This means `cashPaid + creditPaid = total` always balances.

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

Validated on payment: discount cannot exceed subtotal.

### 4. Exact Due

What the customer owes before rounding.

```
exactDue = subTotal - documentDiscountAmount
```

### 5. Rounding (Australian 5-Cent Rule)

**Always applied** to `exactDue`, regardless of payment method. Australia eliminated 1c and 2c coins.

| Last digit(s) | Rounds to     |
| ------------- | ------------- |
| .01, .02      | .00 (down)    |
| .03, .04, .05 | .05 (up/stay) |
| .06, .07      | .05 (down)    |
| .08, .09      | .10 (up)      |

```
roundedDue = exactDue rounded to nearest 0.05 (ROUND_HALF_UP)
rounding = roundedDue - exactDue
```

This is the **sale total** — the bill amount shown to the customer.

### 6. Credit Card Surcharge (Separate)

A 1.5% surcharge applied to the credit card payment amount.

```
creditSurchargeAmount = creditReceived × 0.015
eftposAmount = creditReceived + creditSurchargeAmount
```

The surcharge is **not included in the sale total**. It is collected via the EFTPOS machine. The card machine charges `eftposAmount`, the store receives `creditReceived`, and the surcharge offsets processing fees.

Validated on payment: credit cannot exceed `roundedDue`.

### 7. Tax (GST)

All prices are GST-inclusive (10% GST). Tax is extracted, not added.

```
GST = (taxable amount) ÷ 11
```

Tax is calculated on the **unrounded** amounts:

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = creditSurchargeAmount × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

The credit surcharge is subject to GST in proportion to taxable goods.

### 8. Remaining / Change

```
remaining = roundedDue - cashReceived - creditReceived
```

| remaining | Meaning                            |
| --------- | ---------------------------------- |
| > 0       | Customer still owes this amount    |
| = 0       | Fully paid                         |
| < 0       | Change due to customer (abs value) |

---

## Total Discount (Receipt Summary)

For the receipt "You Saved" line:

```
originalSubTotal = Σ (line.unit_price_original × line.qty)
totalDiscountAmount = (originalSubTotal - subTotal) + documentDiscountAmount
```

---

## Payment Methods

| Method        | Surcharge              | Rounding        |
| ------------- | ---------------------- | --------------- |
| Cash only     | None                   | Always applied  |
| Credit only   | 1.5% (via EFTPOS)      | Always applied  |
| Cash + Credit | 1.5% on credit (via EFTPOS) | Always applied |

---

## Payload (OnPaymentPayload)

What gets stored to the database:

| Field                  | Value                                  |
| ---------------------- | -------------------------------------- |
| subtotal               | Σ line.total                           |
| documentDiscountAmount | document-level discount applied        |
| creditSurchargeAmount  | 1.5% surcharge on credit               |
| rounding               | 5c rounding adjustment (+/-)           |
| total                  | roundedDue (sale amount, excl. surcharge) |
| taxAmount              | GST extracted                          |
| cashPaid               | cash applied to bill                   |
| cashChange             | change given back                      |
| creditPaid             | base card charge (excl. surcharge)     |
| totalDiscountAmount    | line + document discounts              |

Identity: `cashPaid + creditPaid = total`

Derivable: `cashReceived = cashPaid + cashChange`, `eftposAmount = creditPaid + creditSurchargeAmount`

---

## Example

Cart: 3 items totalling $47.83 (of which $32.00 is taxable).

Document discount: 5%.

```
subTotal         = $47.83
taxableRatio     = 32.00 ÷ 47.83 = 0.6690...
documentDiscount = 47.83 × 0.05 = $2.39
exactDue         = 47.83 - 2.39 = $45.44
roundedDue       = $45.45 (rounded up)
rounding         = +$0.01
```

Customer pays $20.00 credit + rest cash:

```
creditSurcharge  = 20.00 × 0.015 = $0.30
eftposAmount     = 20.00 + 0.30 = $20.30 (EFTPOS charges this)
remaining        = 45.45 - 20.00 = $25.45 (cash needed)
```

Customer gives $30 cash:

```
remaining = 45.45 - 30.00 - 20.00 = -$4.55 (change)
```

Tax:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.30 × 0.6690 = $0.20
taxAmount        = (30.40 + 0.20) ÷ 11 = $2.78
```

Receipt:

```
Subtotal:          $47.83
Discount (5%):     -$2.39
Rounding:          +$0.01
─────────────────────────
Total:             $45.45
  Credit:          $20.00
  Cash:            $30.00
  Change:           $4.55
─────────────────────────
Card Surcharge:     $0.30
EFTPOS Amount:     $20.30
─────────────────────────
GST Included:       $2.78
You Saved:          $X.XX
```
