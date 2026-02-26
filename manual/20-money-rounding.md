# Money & Rounding

> How the system handles money, avoids rounding errors, and applies Australian 5-cent rounding.

---

## Precision

All money calculations use **decimal.js** — a library for arbitrary-precision decimal arithmetic. This avoids the floating-point errors that occur with standard JavaScript numbers (e.g. `0.1 + 0.2 ≠ 0.3`).

### Storage Formats

| Where | Format | Example |
|-------|--------|---------|
| Invoice amounts | Decimal(18,2) in database | `$15.50` → stored as `15.50` |
| Shift amounts | Integer (cents) | `$15.50` → stored as `1550` |
| Cash In/Out amounts | Decimal(18,2) | `$15.50` → stored as `15.50` |
| Prices | Float array | `[5.99, 4.99, 3.99]` |

### Why Cents for Shifts?

Shift tallies accumulate many transactions. Using integers (cents) eliminates any possibility of cumulative rounding errors. The conversion happens:
- **Into cents**: `Math.round(dollars × 100)` when closing a shift
- **Back to dollars**: `cents ÷ 100` when displaying

---

## 5-Cent Rounding (Australian Rule)

Australia eliminated 1-cent and 2-cent coins. Cash transactions are rounded to the nearest 5 cents.

### When Rounding Applies

- **Cash payment present** → round the due amount to nearest 5 cents
- **Credit-only payment** → no rounding (exact amount charged)

### How It Works

```
Rounded Due = Exact Due rounded to nearest $0.05 (half-up)
Rounding = Rounded Due − Exact Due
```

| Exact Due | Rounded Due | Rounding |
|-----------|------------|----------|
| $10.01 | $10.00 | −$0.01 |
| $10.02 | $10.00 | −$0.02 |
| $10.03 | $10.05 | +$0.02 |
| $10.04 | $10.05 | +$0.01 |
| $10.05 | $10.05 | $0.00 |

---

## GST (Goods and Services Tax)

Australian GST is **10%, tax-inclusive**. This means the displayed price already includes tax.

### Extracting GST

```
GST = price ÷ 11
```

Not `price × 10%` — because the tax is already included in the price, dividing by 11 extracts it correctly.

### Per-Line Tax Allocation

When distributing tax across multiple items, the system uses the **largest-remainder method** to ensure the per-line tax amounts sum exactly to the total:

1. Calculate each line's proportional share
2. Floor to 2 decimal places
3. Distribute remaining cents to lines with the largest fractional remainders

This prevents the common problem where rounding each line independently produces a sum that's off by 1-2 cents.

---

## Decimal Places

| Type | Decimal Places |
|------|---------------|
| Money (prices, totals) | 2 |
| Quantities | 3 |
| Weight | 3 |
