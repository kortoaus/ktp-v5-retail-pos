# Pricing & Discounts

> How item prices are determined, including member pricing, promo prices, and overrides.

---

## Price Structure

Each item can have:

| Price Type | Source | Description |
|-----------|--------|-------------|
| **Base price** | Price table, level 0 | The standard retail price |
| **Level prices** | Price table, levels 1+ | Member-level pricing (e.g. level 1 = wholesale) |
| **Promo price** | PromoPrice table | Time-limited promotional prices with valid date range |

### How Prices Are Stored

Prices are stored as **arrays indexed by member level**:

```
prices[0] = base price (everyone)
prices[1] = level 1 price
prices[2] = level 2 price
...
```

Both regular prices and promo prices use this same array structure.

---

## Price Resolution

When an item is added to the cart, the system determines three prices:

### 1. Original Price (always used as base)
```
unit_price_original = prices[0]
```
This is the standard retail price, regardless of member level.

### 2. Discounted Price (if a member is attached)
The system looks at:
- `prices[memberLevel]` from the regular price table
- `promoPrice.prices[memberLevel]` from the promo price table (if within valid date range)

It picks the **lowest** of these two, but **only if it's lower than the original price**. If neither is lower, there is no discount.

### 3. Effective Price (what the customer actually pays)
```
effective = adjusted price ?? discounted price ?? original price
```

Priority order:
1. **Adjusted price** — manually overridden by staff (highest priority)
2. **Discounted price** — from member level or promo
3. **Original price** — base retail price (fallback)

---

## Line Total Calculation

```
line total = effective unit price × qty
```

Rounded to 2 decimal places.

### Tax (GST)

Australian GST is **inclusive** — the price already contains tax.

```
tax amount = total ÷ 11
```

Only calculated for items marked as **taxable**. Non-taxable items have zero tax.

```
subtotal = total − tax amount
```

---

## Prepacked Item Pricing

For items with barcode-embedded prices:

| Scenario | Original Price | Qty |
|----------|---------------|-----|
| Normal prepacked (has a system price) | System price (prices[0]) | barcodePrice ÷ system price |
| Supplier prepacked (no system price) | Barcode price | 1 |

This means prepacked items use fractional quantities to represent the actual weight/amount from the barcode.

---

## Member Level Changes

When you attach or remove a member:
- **All lines in the current cart** are recalculated with the new member level
- Each line gets a new discounted price based on the member's level
- Lines with manual price overrides are **not affected** — the override takes priority
- Supplier prepacked items (no system price) are **not affected**

---

## Price Override

Staff can override the price of any line:

1. Select the line by tapping it
2. Tap **Override Price**
3. Enter the new price
4. The line is marked with "PRICE_OVERRIDE" in its adjustments

To remove an override:
- Tap the line, then tap **Clear Override Price**
- The line reverts to the calculated price (discounted or original)

---

## Document-Level Discount

At payment time, you can apply a discount to the entire sale:

| Method | Description |
|--------|-------------|
| **Percentage** | e.g. 10% off the subtotal |
| **Fixed amount** | e.g. $5.00 off |

This is applied after line totals are calculated, before rounding and payment.

See [Payment](./07-payment.md) for details on how this interacts with the final amount.

---

## Summary

```
For each line:
  original price = prices[0]
  discounted price = min(prices[level], promoPrice[level]) if < original
  effective price = override ?? discounted ?? original
  total = effective × qty (rounded 2dp)
  tax = total ÷ 11 (if taxable)
  subtotal = total − tax

For the whole sale:
  subtotal = Σ line totals
  document discount = subtotal × percent OR fixed amount
  due = subtotal − document discount
```
