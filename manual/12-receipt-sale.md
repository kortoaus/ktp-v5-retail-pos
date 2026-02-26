# Sale Receipt

> Understanding what each section of the sale receipt means.

---

## Receipt Layout (top to bottom)

### Header

| Line | Content |
|------|---------|
| 1 | **Store name** (bold, large) |
| 2-3 | Address line 1, Address line 2 |
| 4 | Suburb, State, Postcode |
| 5 | "TAX INVOICE - ABN xxxxxxx" (or just "TAX INVOICE" if no ABN) |
| 6 | Phone number |
| 7 | Website (printed as "https://...") — only if set |

### Meta

| Line | Content |
|------|---------|
| Invoice | Serial number (e.g. 1-5-2-123) |
| Date | Sale date and time |
| Terminal | Terminal name |
| Member | Member level (only if a member was attached) |

### Items

Each item shows:
```
[^][#]Item Name
  qty @ $unit_price                    $total
```

| Symbol | Meaning |
|--------|---------|
| **^** | Price was changed (discounted or overridden — effective ≠ original) |
| **#** | GST applicable (item is taxable) |

For weight items: `0.500kg @ $5.99/kg`
For prepacked items: `1 @ $12.50`
If price changed, the original price appears in parentheses: `(original price)`

### Totals

| Line | Content |
|------|---------|
| SUBTOTAL | Number of items + sum of line totals |
| Discount | Document-level discount (if any, shown as negative) |
| Card Surcharge | Credit card surcharge (if any, shown as positive) |
| Rounding | 5c rounding adjustment (+ or −) |
| **TOTAL** | Final amount including surcharge |

**Note on TOTAL**: The receipt TOTAL includes surcharge. This equals `sale total + credit surcharge`, so the EFTPOS machine total matches.

### Payments

| Line | Content |
|------|---------|
| Cash Received | Total cash given by customer |
| Cash Paid | Cash applied to the bill |
| Change | Change given back |
| Credit Paid | Card payment including surcharge |

### Footer

| Line | Content |
|------|---------|
| GST Included | Total GST amount |
| You Saved | Total discount amount (line + document discounts) — only if > 0 |
| Legend | "^ = price changed  # = GST applicable" |
| Footer text | From Store Settings receipt_below_text (default: "Thank you!") |
| QR code | Encodes the serial number |
| COPY marker | "** COPY **" — only on reprints |
| Print timestamp | When the receipt was printed |
