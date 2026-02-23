# Payment Rules

How the POS calculates the final amount, tax, rounding, and change.

All calculations use `decimal.js` to avoid floating-point errors. All amounts are in dollars.

---

## Calculation Chain

```
subTotal
  → documentDiscountAmount
  → exactDue = subTotal - documentDiscountAmount
  → roundedDue = exactDue rounded to 5c
  → hasCash = any cash payment exists
  → effectiveDue = hasCash ? roundedDue : exactDue
  → effectiveRounding = hasCash ? (roundedDue - exactDue) : 0
  → per-line credit surcharge = r2(creditLineAmount × 1.5%) for each credit payment
  → totalSurcharge = Σ per-line surcharges
  → totalEftpos = totalCredit + totalSurcharge
  → taxAmount (from unrounded exactDue + totalSurcharge)
  → remaining = effectiveDue - totalCash - totalCredit
```

Key design: **surcharge is separate from the sale total.** The bill is `effectiveDue`. The surcharge is collected via the EFTPOS machine on top. This means `cashPaid + creditPaid = total` always balances.

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

Australia eliminated 1c and 2c coins. Rounding applies **only when cash is part of the payment**. Credit-only payments use the exact amount.

| Last digit(s) | Rounds to     |
| ------------- | ------------- |
| .01, .02      | .00 (down)    |
| .03, .04, .05 | .05 (up/stay) |
| .06, .07      | .05 (down)    |
| .08, .09      | .10 (up)      |

```
roundedDue = exactDue rounded to nearest 0.05 (ROUND_HALF_UP)
rounding = roundedDue - exactDue

hasCash = totalCash > 0
effectiveDue = hasCash ? roundedDue : exactDue
effectiveRounding = hasCash ? rounding : 0
```

The summary always displays `roundedDue` as "Cash Total" for cashier reference, regardless of payment method.

### 6. Split Payments

Payments are stored as an ordered list of payment lines. Each line has a type and an amount (what goes toward the sale balance).

```
Payment = { type: "cash" | "credit", amount: number }
```

**Normal flow** (most transactions): Cashier enters credit and/or cash amounts directly, then presses Pay. Payment lines are auto-generated from the current inputs.

**Split flow** (rare): Cashier enters an amount → taps "Add Payment" → the line is committed to a list and inputs reset. Repeat as needed. Press Pay to finalize — committed lines plus any remaining staging inputs become the final payment.

### 7. Credit Card Surcharge (Per-Line)

A 1.5% surcharge is applied **per credit payment line**, rounded to 2 decimal places independently.

```
For each credit payment line:
  surcharge = r2(amount × 0.015)
  eftpos = amount + surcharge

totalSurcharge = Σ per-line surcharges
totalEftpos = totalCredit + totalSurcharge
```

The surcharge is **not included in the sale total**. It is collected via the EFTPOS machine. The card machine charges `eftpos` per line.

Per-line rounding means `totalSurcharge` may differ by a cent from `totalCredit × 0.015` due to independent rounding of each line.

Validated on payment: total credit cannot exceed `effectiveDue`.

### 8. Tax (GST)

All prices are GST-inclusive (10% GST). Tax is extracted, not added.

```
GST = (taxable amount) ÷ 11
```

Tax is calculated on the **unrounded** amounts:

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = totalSurcharge × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

The credit surcharge is subject to GST in proportion to taxable goods.

### 9. Remaining / Change

```
remaining = effectiveDue - totalCash - totalCredit
```

| remaining | Meaning                            |
| --------- | ---------------------------------- |
| > 0       | Customer still owes this amount    |
| = 0       | Fully paid                         |
| < 0       | Change due to customer (abs value) |

Change display is capped at the total cash received (cannot give more change than cash tendered):

```
displayedChange = min(changeAmount, totalCash)
```

---

## Total Discount (Receipt Summary)

For the receipt "You Saved" line:

```
originalSubTotal = Σ (line.unit_price_original × line.qty)
totalDiscountAmount = (originalSubTotal - subTotal) + documentDiscountAmount
```

---

## Payment Methods

| Method        | Surcharge                           | Rounding              |
| ------------- | ----------------------------------- | --------------------- |
| Cash only     | None                                | 5c rounding applied   |
| Credit only   | 1.5% per credit line (via EFTPOS)   | No rounding           |
| Cash + Credit | 1.5% per credit line (via EFTPOS)   | 5c rounding applied   |

---

## Payload (OnPaymentPayload)

What gets stored to the database:

| Field                  | Value                                               |
| ---------------------- | --------------------------------------------------- |
| subtotal               | Σ line.total                                        |
| documentDiscountAmount | document-level discount applied                     |
| creditSurchargeAmount  | Σ per-line credit surcharges                        |
| rounding               | effectiveRounding (0 when credit-only)              |
| total                  | effectiveDue (rounded when cash, exact when credit) |
| taxAmount              | GST extracted                                       |
| cashPaid               | cash applied to bill                                |
| cashChange             | change given back                                   |
| creditPaid             | total credit toward sale (excl. surcharge)          |
| totalDiscountAmount    | line + document discounts                           |
| payments               | `{ type, amount, surcharge }[]` per payment line    |

Identity: `cashPaid + creditPaid = total`

Derivable: `cashReceived = cashPaid + cashChange`, per credit line: `eftpos = amount + surcharge`

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

Customer pays with two credit cards ($15 + $10) and the rest in cash:

```
Payment line 1: credit $15.00 → surcharge = r2(15.00 × 0.015) = $0.23 → EFTPOS $15.23
Payment line 2: credit $10.00 → surcharge = r2(10.00 × 0.015) = $0.15 → EFTPOS $10.15
Payment line 3: cash   $25.00

totalCash      = $25.00
totalCredit    = $25.00
totalSurcharge = $0.23 + $0.15 = $0.38
totalEftpos    = $25.00 + $0.38 = $25.38
```

Since cash is involved: `effectiveDue = roundedDue = $45.45`, `effectiveRounding = +$0.01`.

```
remaining = 45.45 - 25.00 - 25.00 = -$4.55 (change)
```

Tax:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.38 × 0.6690 = $0.25
taxAmount        = (30.40 + 0.25) ÷ 11 = $2.79
```

Receipt:

```
Subtotal:          $47.83
Discount (5%):     -$2.39
Rounding:          +$0.01
─────────────────────────
Total:             $45.45
Cash Total:        $45.45
  Credit:          $25.00
  Cash:            $25.00
  Change:           $4.55
─────────────────────────
Card Surcharge:     $0.38
EFTPOS Total:      $25.38
─────────────────────────
GST Included:       $2.79
You Saved:          $X.XX
```

---

## Post-Payment Behaviour

### Change Screen

When the customer is owed change, a full-screen overlay appears showing the change amount. The cashier hands back the cash, then taps **Close** to finish the sale. A **Kick Drawer** button is also available to re-open the cash drawer.

### Cash Drawer

The cash drawer kicks automatically when `cashPaid > 0`. Uses ESC/POS pulse command on pin 2 (`ESC p 0x00`). The cashier can also manually kick the drawer from the change screen.

### Receipt Printing

A receipt is printed automatically after payment via the ESC/POS thermal receipt printer. The receipt is rendered as a **canvas image** (576px wide) and sent as a raster bitmap — not text-mode ESC/POS.

Receipt sections (top to bottom):

1. **Store header** — company name, address, ABN, phone
2. **TAX INVOICE** label
3. **Meta** — invoice serial number, date/time, terminal name, member level
4. **Line items** — each item with qty/weight, unit price, line total
   - `^` prefix = price was changed (override/discount)
   - `#` prefix = GST applicable
   - Weighted items show: `0.650KG @ $5.00/KG`
   - Price-changed items show original price in brackets: `($3.50)`
5. **Totals** — subtotal, discount, card surcharge, rounding, **TOTAL**
   - Receipt TOTAL = `effectiveDue + totalSurcharge` (what the customer actually pays out of pocket, including surcharges)
6. **Payments** — cash amount, credit EFTPOS amount (incl. surcharge), change
7. **Footer** — GST included, You Saved, legend, "Thank you!"
8. **QR code** — encodes the invoice serial number for quick lookup
9. **Print timestamp**

Copy receipts (reprints) show `** COPY **` at the bottom.

### Invoice Lookup

Past invoices can be searched via the Invoice Search screen (`/sale/invoices`). Search by serial number, item name (EN/KO), or barcode. Results are paginated and each invoice can be reprinted as a copy.
