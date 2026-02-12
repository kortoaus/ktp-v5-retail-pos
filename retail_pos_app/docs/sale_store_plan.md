# Sales Store Implementation Plan

File: `src/renderer/src/store/salesStore.ts`
Dependencies: `zustand`, `zustand/shallow`, `decimal.js`
Constants: `MONEY_DP = 2`, `QTY_DP = 3`

---

## 1. Store Shape

```typescript
interface SalesState {
  // Cart system: 1 active + 3 hold slots
  activeCartIndex: number; // 0-3, which cart is currently active
  carts: Cart[]; // length 4, initialized empty
  memberLevel: number; // default 0, index into prices[] array

  // Actions
  addLine: (item: SaleLineItem, prepackedPrice?: number) => void;
  removeLine: (lineKey: string) => void;
  changeLineQty: (lineKey: string, qty: number) => void;
  injectLinePrice: (lineKey: string, price: number) => void;
  setMemberLevel: (level: number) => void;
  switchCart: (index: number) => void;
  clearActiveCart: () => void;
}

interface Cart {
  lines: SaleLineType[];
}
```

- All 4 carts initialized as `{ lines: [] }`.
- `activeCartIndex` starts at `0`.
- `memberLevel` is global (shared across all carts), default `0`.

---

## 2. Cart Switching

`switchCart(index)` sets `activeCartIndex` to the target index (0-3). No data moves; the UI reads from `carts[activeCartIndex]`.

All line actions (`addLine`, `removeLine`, `changeLineQty`, `injectLinePrice`) operate on `carts[activeCartIndex].lines`.

`clearActiveCart()` resets `carts[activeCartIndex]` to `{ lines: [] }`.

---

## 3. addLine(item: SaleLineItem, prepackedPrice?: number)

Input is a `SaleLineItem` (result of barcode/item lookup).

### Step 1 — Reject invalid

If `item.type === 'invalid'`, do NOT add. No state change. The caller is responsible for alerting the user.

### Step 2 — Build the line

Generate a new `SaleLineType` from the `SaleLineItem`:

```
lineKey                   = crypto.randomUUID()
index                     = lines.length
original_receipt_id       = null
original_receipt_line_id  = null
unit_price_adjusted       = null  (unless prepacked — see Step 3)
unit_price_discounted     = resolveDiscountedPrice(item, memberLevel)
unit_price_original       = resolveOriginalPrice(item, memberLevel)
qty                       = 1
measured_weight           = null  (log field, caller sets externally if needed)
adjustments               = []
```

Then calculate `total`, `tax_amount`, `subtotal` per Section 5.

### Step 3 — Merge or append

**Prepacked** (`type === 'prepacked'`):

- If `prepackedPrice` is provided: set `unit_price_original = prepackedPrice` (barcode-embedded price IS the original price).
- `unit_price_discounted` is always `null` for prepacked.
- `unit_price_adjusted` is always `null` for prepacked.
- `qty` is always `1`.
- ALWAYS append as new line. Never merge.

**Weight** (`type === 'weight'`):

- ALWAYS append as new line. Never merge.
- `qty = 1` on creation.

**Normal** (`type === 'normal'`):

- Search active cart for an existing line where ALL conditions match:
  - `itemId` matches
  - `unit_price_adjusted === null`
  - `unit_price_discounted` matches (both null, or same value)
  - `unit_price_original` matches
  - `type === 'normal'`
- If match found: `qty += 1`, recalculate prices (Section 5), **move line to end of array**.
- If no match: append as new line.

### Line reordering on merge

Remove the merged line from its current position, push to end. Re-index all lines (`index` = array position).

---

## 4. removeLine(lineKey: string)

Find line by `lineKey` in active cart. Remove it. Re-index remaining lines.

---

## 5. Price Calculation

All math uses `Decimal` from `decimal.js`. All money results `.toDecimalPlaces(MONEY_DP)` then `.toNumber()`.

### unit_price_effective

Resolved once during `recalculateLine` and stored on the line:

```
unit_price_effective = unit_price_adjusted ?? unit_price_discounted ?? unit_price_original
```

Priority: `adjusted` (0) > `discounted` (1) > `original` (2).

### Resolving prices from item data

```
unit_price_original   = item.price?.prices[memberLevel] ?? 0
unit_price_discounted = item.promoPrice?.prices[memberLevel] || null
```

If `promoPrice` exists but `prices[memberLevel]` is `0` or `undefined`, treat as `null` (no promo).

### Line totals

```
total           = Decimal(unit_price_effective).mul(qty).toDecimalPlaces(MONEY_DP).toNumber()
tax_amount      = taxable ? Decimal(total).div(11).toDecimalPlaces(MONEY_DP).toNumber() : 0
subtotal        = Decimal(total).sub(tax_amount).toDecimalPlaces(MONEY_DP).toNumber()
```

Tax is GST-inclusive: the price already includes tax. Dividing by 11 extracts the 1/11 GST component.

### When to recalculate

Recalculate `unit_price_effective`, `total`, `tax_amount`, `subtotal` whenever:

- `qty` changes (via `changeLineQty` or merge in `addLine`)
- `unit_price_adjusted` changes (via `injectLinePrice`)
- `memberLevel` changes (via `setMemberLevel` — recalculate ALL lines in ALL carts)

---

## 6. changeLineQty(lineKey: string, qty: number)

- Only allowed if `line.type === 'normal'`. Ignore for weight/prepacked.
- Set `line.qty` to the new value.
- If `qty <= 0`: remove the line (same as `removeLine`).
- Recalculate prices.
- Move line to end of array.
- Re-index all lines.

---

## 7. injectLinePrice(lineKey: string, price: number)

- Set `line.unit_price_adjusted = price`.
- Push `'PRICE_OVERRIDE'` to `line.adjustments` (audit trail).
- Recalculate prices.

---

## 8. setMemberLevel(level: number)

- Set `memberLevel = level`.
- For EVERY line in EVERY cart:
  - Recalculate `unit_price_original` from `line.price.prices[level]`.
  - Recalculate `unit_price_discounted` from `line.promoPrice?.prices[level]` (null if absent/zero).
  - Recalculate `total`, `tax_amount`, `subtotal`.
- `unit_price_adjusted` is NOT affected (it's a manual override).
- **Prepacked/weight-prepacked lines**: `barcode_price` (persisted on the line at creation) is used to reverse-calculate the implicit qty/weight ratio, then apply to the new level's price:
  - `new_unit_price_original = barcode_price / prices[0] * prices[newLevel]`
  - For prepacked: ratio ≈ 1, so result ≈ `prices[newLevel]`
  - For weight-prepacked: ratio = weight in kg, so result = `prices[newLevel] * kg`
  - If `prices[0]` is 0 (edge case), keeps `barcode_price` unchanged.
  - `unit_price_discounted` stays `null` for prepacked types.
- Lines carry `price` and `promoPrice` objects via `SaleLineItem` inheritance, so the original data is always available.

---

## 9. lineKey Generation

Each line gets a unique `lineKey` via `crypto.randomUUID()`. This is the stable identifier for all line operations. The `index` field is positional (recalculated on every reorder/remove).

---

## 10. Shared Helper

Extract `recalculateLine` used by all mutating actions:

```typescript
function recalculateLine(line: SaleLineType): SaleLineType {
  const unit_price_effective =
    line.unit_price_adjusted ??
    line.unit_price_discounted ??
    line.unit_price_original;
  const total = new Decimal(unit_price_effective)
    .mul(line.qty)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
  const taxAmount = line.taxable
    ? new Decimal(total).div(11).toDecimalPlaces(MONEY_DP).toNumber()
    : 0;
  const subtotal = new Decimal(total)
    .sub(taxAmount)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
  return { ...line, unit_price_effective, total, tax_amount: taxAmount, subtotal };
}
```

Also extract `reindexLines` to normalize `index` after any array mutation:

```typescript
function reindexLines(lines: SaleLineType[]): SaleLineType[] {
  return lines.map((line, i) => ({ ...line, index: i }));
}
```

---

## 11. Scope Boundaries — What This Store Does NOT Handle

- Sale totals / item counts / payment — computed via `useShallow` selectors externally
- Receipt creation / server submission
- Return/refund logic (fields exist but always `null`)
- Barcode parsing (caller parses PLU, passes `prepackedPrice`)
- Weight reading from scale (caller sets `measured_weight` externally if needed)
- User alerts on invalid items (caller responsibility)

---

## 12. Type Inheritance

`SaleLineType` extends `SaleLineItem`, so every line carries `price`, `promoPrice`, `taxable`, `type`, `itemId`, `name_en`, `name_ko`, `uom`, `barcode`. No separate lookups needed for recalculation.
