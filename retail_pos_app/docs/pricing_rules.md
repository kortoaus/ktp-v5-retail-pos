# Pricing Rules

How the POS calculates prices.

---

## Item Types

| Type | What it is | Example |
|------|-----------|---------|
| **Normal** | Regular shelf item | A bottle of milk |
| **Weight** | Sold by weight, weighed at register | Loose bananas |
| **Prepacked** | Pre-weighed and labelled, price on label | Tray of mince with price sticker |
| **Weight-prepacked** | Labelled from scale system, price on label | Deli meat packed on CAS scale |

---

## Three Prices on Every Line

Each line on the receipt has three possible prices. The system always uses the first one available:

| Priority | Name | What it is | Who sets it | Can it change? |
|----------|------|-----------|-------------|----------------|
| 1st | **Adjusted** | Manual override by operator | Operator | Only by operator |
| 2nd | **Discounted** | Best available discount | System | Yes — changes when member level changes |
| 3rd | **Original** | The default retail price (Level 0) | System | No — fixed when item is added |

**The price the customer pays = the first non-empty price in priority order.**

If there's a manual override → that's the price.
If no override but a discount exists → that's the price.
Otherwise → the original retail price.

---

## Original Price (Fixed)

The original price is always the **Level 0 retail price**. It never changes, even when the member level changes.

This is the "sticker price" — the full retail price before any discounts.

---

## Discounted Price (Changes with Level)

When a member level is set, the system finds the best available discount:

- **Member price** = the price at the customer's level
- **Promo price** = the promotional price at the customer's level

The system picks **whichever is lower**, as long as it's lower than the original price. If neither is lower, there is no discount.

**Example — Milk:**

| | Level 0 | Level 1 | Level 2 |
|---|---------|---------|---------|
| Regular prices | $4.50 | $4.00 | $3.50 |
| Promo prices | $4.20 | $3.80 | $3.20 |

- Level 0: Original = $4.50. Discounted = $4.20 (promo is lower). Customer pays **$4.20**.
- Level 1: Original = $4.50. Discounted = $3.80 (promo $3.80 < member $4.00). Customer pays **$3.80**.
- Level 2: Original = $4.50. Discounted = $3.20 (promo $3.20 < member $3.50). Customer pays **$3.20**.

If there is no promo:
- Level 0: Original = $4.50. No discount (member price = original). Customer pays **$4.50**.
- Level 1: Original = $4.50. Discounted = $4.00 (member price). Customer pays **$4.00**.

---

## How Quantity Works

| Type | Quantity is... | Example |
|------|---------------|---------|
| Normal | Number of items scanned | Scan 3 times → qty = 3 |
| Weight | Weight in kg from scale | Scale reads 1.250 kg → qty = 1.250 |
| Prepacked | Label price ÷ Level 0 price | Label $28, retail $28/ea → qty = 1.000 |
| Weight-prepacked | Label price ÷ Level 0 price per kg | Label $19.50, retail $6.50/kg → qty = 3.000 |

For prepacked and weight-prepacked, the system works backwards from the barcode label price to calculate the quantity. The label price is always based on the Level 0 retail price.

**Total = effective price × quantity**

Note: Prepacked and weight-prepacked items always show **qty = 1** on the receipt. The calculated qty (from the ratio) is kept internally for pricing only.

---

## Prepacked and Weight-Prepacked in Detail

### In-house items (we manage pricing)

These items have prices set in the system (Level 0 price > $0).

The barcode label shows a price that was calculated from: **Level 0 price × quantity**.

The system reverses this to get the quantity: **label price ÷ Level 0 price = quantity**.

From that point on, the item behaves like any other item — the original price is the Level 0 price, and member/promo discounts apply normally.

**Example — YJ Boneless Chicken (prepacked):**
- Label price: $28.00
- Level 0 price: $28.00/ea
- Quantity: $28.00 ÷ $28.00 = 1.000
- Promo prices: [27, 24, 19, ...]

| Level | Original | Discounted | Qty | Total |
|-------|----------|-----------|-----|-------|
| 0 | $28.00 | $27.00 (promo) | 1.000 | $27.00 |
| 1 | $28.00 | $24.00 (promo) | 1.000 | $24.00 |
| 2 | $28.00 | $19.00 (promo) | 1.000 | $19.00 |

**Example — Beef for Bulgogi (weight-prepacked, in-house with pricing):**
- Label price: $19.50
- Level 0 price: $6.50/kg
- Quantity: $19.50 ÷ $6.50 = 3.000 kg
- Level 1 price: $5.50/kg, Promo: $5.00/kg

| Level | Original | Discounted | Qty | Total |
|-------|----------|-----------|-----|-------|
| 0 | $6.50 | — | 3.000 | $19.50 |
| 1 | $6.50 | $5.00 (promo) | 3.000 | $15.00 |

### Supplier items (we don't manage pricing)

These items have all prices set to $0 in the system. The label price is the only price.

The system uses the label price as the original price, quantity is 1, and no discounts ever apply. Changing the member level has no effect.

**Example — Imported Wagyu (supplier prepacked):**
- Label price: $45.00
- All prices in system: $0

| Level | Original | Discounted | Qty | Total |
|-------|----------|-----------|-----|-------|
| Any | $45.00 | — | 1 | $45.00 |

---

## Tax (GST)

All prices are GST-inclusive. The tax is extracted from the total:

- **GST = Total ÷ 11**
- **Subtotal = Total − GST**

Example: Total = $19.50 → GST = $1.77, Subtotal = $17.73

Non-taxable items: GST = $0, Subtotal = Total.

---

## Summary

| | Original | Discounted | Qty | Level change affects... |
|---|----------|-----------|-----|----------------------|
| **Normal** | prices[0] | Best of member/promo | Scan count | Discounted only |
| **Weight** | prices[0] per kg | Best of member/promo | Scale weight | Discounted only |
| **Prepacked (in-house)** | prices[0] | Best of member/promo | label ÷ prices[0] | Discounted only |
| **Weight-prepacked (in-house)** | prices[0] per kg | Best of member/promo | label ÷ prices[0] | Discounted only |
| **Prepacked (supplier)** | Label price | Never | 1 | Nothing |
