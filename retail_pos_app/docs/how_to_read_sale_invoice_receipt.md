# How to Read a Sale Receipt

This guide explains each section of a printed sale receipt so you can understand what every line means.

---

## Receipt Layout

A receipt is printed top-to-bottom in this order:

```
┌──────────────────────────────┐
│        STORE HEADER          │
│──────────────────────────────│
│       RECEIPT NUMBER         │
│     DATE / TIME / STAFF      │
│──────────────────────────────│
│        LINE ITEMS            │
│──────────────────────────────│
│          TOTALS              │
│──────────────────────────────│
│         PAYMENT              │
│──────────────────────────────│
│          FOOTER              │
└──────────────────────────────┘
```

---

## 1. Store Header

The top of the receipt shows your store information.

| Line | Example | Meaning |
|------|---------|---------|
| Store name | **Fresh Mart** | Business trading name |
| ABN | ABN 12 345 678 901 | Australian Business Number |
| Address | 123 Main St, Sydney NSW 2000 | Store address |
| Phone | (02) 1234 5678 | Store phone number |

---

## 2. Receipt Number & Transaction Info

| Line | Example | Meaning |
|------|---------|---------|
| Receipt No. | `1-5-2-42` | Unique receipt number (Company-Shift-Terminal-Invoice) |
| Date/Time | 23/02/2026 10:30 AM | When the sale was made |
| Terminal | Terminal 2 | Which register processed the sale |
| Staff | John | Who served the customer |
| Member | M-1001 (Level 2) | Customer member ID and discount level (if scanned) |

**Receipt number breakdown**: `1-5-2-42` = Company 1, Shift 5, Terminal 2, Invoice 42. Use this number when looking up a past transaction.

---

## 3. Line Items

Each item purchased appears as one line (or multiple lines if the name is long).

### Standard item

```
Coca Cola 600ml          x1     $3.50
```

| Part | Meaning |
|------|---------|
| Item name | Product name (Korean name may appear on a second line) |
| x1 | Quantity purchased |
| $3.50 | Line total (unit price x quantity) |

### Weighted item (sold by KG)

```
Banana                0.650kg   $3.25
  @ $5.00/kg
```

| Part | Meaning |
|------|---------|
| 0.650kg | Measured weight from the scale |
| $3.25 | Line total ($5.00 x 0.650) |
| @ $5.00/kg | Unit price per kilogram |

### Prepacked item (price in barcode)
```
Beef Steak (Prepacked)
  1 @ $8.75                        $8.75
```

The price is embedded in the barcode label. The weight and price were set at packing time. On the receipt, prepacked items always show qty 1 and the barcode price as the unit price.

### Line adjustments

If a line has a discount or price override, it shows below the item:

```
Apple                    x3     $4.50
  Discount 10%                  -$0.50
  Line total                    $4.00
```

---

## 4. Totals Section

This section shows how the final amount was calculated.

```
──────────────────────────────
Subtotal                 $56.00
Discount                  -$5.00
Credit Surcharge           $0.77
GST (incl.)                $4.65
Rounding                  -$0.02
──────────────────────────────
TOTAL                    $51.75
──────────────────────────────
```

| Line | Meaning |
|------|---------|
| **Subtotal** | Sum of all line item totals before any document-level discount |
| **Discount** | Document-level discount applied to the whole sale (% or flat $). Does NOT include per-line discounts — those are already reflected in the subtotal |
| **Credit Surcharge** | 1.5% surcharge on the credit card portion only. Only appears if customer pays any amount by credit card |
| **GST (incl.)** | Goods & Services Tax (10%) — already included in the prices, shown for information only |
| **Rounding** | Australian 5-cent rounding. The total is always rounded to the nearest 5 cents. Can be positive or negative |
| **TOTAL** | The final amount the customer must pay |

---

## 5. Payment Section

Shows how the customer paid.

### Cash only

```
Cash                     $55.00
Change                    $3.25
```

### Credit only

```
Credit                   $51.75
```

### Split payment (cash + credit)

```
Cash                     $20.00
Credit                   $31.75
Change                    $0.00
```

| Line | Meaning |
|------|---------|
| **Cash** | Amount of cash given by the customer |
| **Credit** | Amount charged to credit card |
| **Change** | Cash returned to the customer (Cash paid minus amount due) |

---

## 6. Footer

The bottom of the receipt may include:

- Thank you message
- Return policy
- Store website

---

## Common Questions

**Q: Why is the total different from the subtotal?**
The total includes document discount, credit surcharge, and 5-cent rounding. Check each line in the Totals section to see what was added or removed.

**Q: What does "Rounding" mean?**
Australia no longer uses 1-cent and 2-cent coins. All cash totals are rounded to the nearest 5 cents. For example, $10.02 becomes $10.00, and $10.03 becomes $10.05. This applies regardless of payment method.

**Q: Why is there a "Credit Surcharge"?**
A 1.5% fee is applied to the credit card portion of the payment. If you pay entirely by cash, there is no surcharge.

**Q: What does the member level mean?**
Members may receive discounted prices. Level 1 = standard member, Level 2 = VIP, etc. The discounted prices are already reflected in the line item totals.

**Q: I need to look up an old receipt. What do I need?**
Use the receipt number (e.g., `1-5-2-42`) to search for the transaction in the system.
