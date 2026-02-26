# Refund Receipt

> Understanding the refund receipt.

---

## Differences from Sale Receipt

The refund receipt is similar to the sale receipt but with key differences:

| Difference | Detail |
|-----------|--------|
| Banner | "*** REFUND ***" printed prominently below the header |
| ABN line | Shows "ABN xxxxxxx" without "TAX INVOICE" prefix |
| Original invoice | Shows the original sale's serial number |
| No surcharge | Refunds do not have a credit card surcharge section |
| No discount | No document discount section |
| Payment labels | "Cash Refunded" / "Credit Refunded" instead of "Cash Paid" / "Credit Paid" |
| Footer text | "Refund processed" instead of the customisable footer text |

---

## Receipt Layout

### Header
Same as sale receipt — store name, address, ABN, phone, website.

### Refund Banner
```
*** REFUND ***
```

### Meta
| Line | Content |
|------|---------|
| Refund Invoice | This refund's serial number |
| Original Invoice | The original sale's serial number |
| Date | Refund date and time |
| Terminal | Terminal name |

### Items
Each refunded item with qty and total.

### Totals
| Line | Content |
|------|---------|
| ITEMS | Count + subtotal |
| Rounding | 5c adjustment (if any) |
| **REFUND TOTAL** | Amount refunded |

### Payments
| Line | Content |
|------|---------|
| Cash Refunded | Cash given back to customer |
| Credit Refunded | Amount reversed to card |

### Footer
| Line | Content |
|------|---------|
| GST Included | Tax amount in the refund |
| "Refund processed" | Fixed footer text |
| QR code | Encodes the refund serial number |
| Print timestamp | When printed |
