# NewPaymentModal Implementation Plan

> All values are Int. Money = cents (×100), Qty = ×1000, Percent = permille (×1000).

---

## ⚠️ Critical Naming Traps

1. **`subtotal` has TWO different meanings:**
   - `SaleInvoice.subtotal` = Σ(row.total) - promotionDiscount → "after promo, before manual discount"
   - `SaleInvoiceRow.subtotal` = row.total - row.tax → "tax-excluded row amount"
   - In this plan, `subTotal` always means the INVOICE level.

2. **`SaleInvoice.total` — what the customer ACTUALLY pays (includes surcharge):**
   - `total = subTotal - documentDiscount + rounding + creditSurchargeAmount`
   - `= Σ(payment.amount + payment.surcharge)`
   - Display `total` directly — no need to add surcharge

3. **Tax is INCLUDED in all prices (Australian GST):**
   - `unit_price_*` are tax-inclusive
   - `line.total` is tax-inclusive
   - `tax_amount_included` is EXTRACTED from total (total/11), not added on top
   - Tax fields exist for reporting/display only — they don't change what's charged

4. **`cashPaid` is NET of change:**
   - Customer gives $50 for $30 order → cashPaid = 3000, cashChange = 2000
   - `appliedPaymentLines` already has change subtracted

---

## Inputs (from NewSaleScreen)

```typescript
lines: SaleLineType[]           // from newSalesStore (Int cents/×1000)
discounts: SaleStoreDiscount[]  // from useCartDiscounts (promo discounts, cents)
memberId: string | null         // from store.member
memberLevel: number | null      // from store.member
```

---

## Stage 1 — Sale Totals (FROZEN when modal opens)

**File**: `libs/sale/calc-sale-totals.ts`

```typescript
function calcSaleTotals(lines: SaleLineType[], discounts: SaleStoreDiscount[]): SaleTotals
```

| Output | Type | Calculation | Note |
|--------|------|-------------|------|
| `lineTotal` | cents | `Σ(line.total)` | sum of all line totals (tax-incl) |
| `promotionDiscountAmount` | cents | `Σ(discounts.amount)` | auto-computed promo discounts |
| `subTotal` | cents | `lineTotal - promotionDiscountAmount` | ⚠️ INVOICE-level subtotal |
| `lineDiscountAmount` | cents | `Σ(original × qty / QTY_SCALE) - subTotal` | "You Saved" on receipt |

**FROZEN = these never change while modal is open. Cart is locked.**

---

## Stage 2 — Document Adjustments (reactive)

**File**: same `libs/sale/calc-sale-totals.ts`

```typescript
function calcDocumentAdjustments(subTotal: Int, method: "percent" | "amount", value: number): DocumentAdjustments
```

| Output | Type | Calculation | Note |
|--------|------|-------------|------|
| `documentDiscountAmount` | cents | percent: `Math.round(subTotal * value / 100)`, amount: `value` | `value` from numpad = cents for amount, whole number for percent |
| `exactDue` | cents | `subTotal - documentDiscountAmount` | before rounding, before surcharge |
| `roundedDue` | cents | `Math.round(exactDue / 5) * 5` | 5c cash rounding |
| `rounding` | cents | `roundedDue - exactDue` | can be negative |
| `totalDiscountAmount` | cents | `lineDiscountAmount + documentDiscountAmount` | receipt "You Saved" total |

**Numpad note**: MoneyNumpad returns raw cents. User types "1050" → 1050 = $10.50.
For percent method: user types plain number (e.g. "10" = 10%), NOT permille.

---

## Stage 3 — Payments (reactive)

**File**: `libs/sale/calc-payments.ts`

```typescript
function calcPayments(totals: DocumentAdjustments, payments: Payment[], surchargeRate: Int): PaymentCalcResult
```

`surchargeRate` = permille from DB StoreSetting (e.g. 15 = 1.5%).
`Payment.amount` = cents.

| Output | Type | Calculation | Note |
|--------|------|-------------|------|
| `totalCash` | cents | `Σ(cash.amount)` | staging + committed |
| `totalCredit` | cents | `Σ(credit.amount)` | staging + committed |
| `totalVoucher` | cents | `Σ(voucher.amount)` | committed only |
| `totalSurcharge` | cents | `Math.round(totalCredit * surchargeRate / PCT_SCALE)` | credit surcharge |
| `totalEftpos` | cents | `totalCredit + totalSurcharge` | actual EFTPOS charge |
| `hasCash` | bool | `totalCash > 0` | determines rounding |
| `effectiveDue` | cents | `hasCash ? roundedDue : exactDue` | ⚠️ excludes surcharge |
| `effectiveRounding` | cents | `hasCash ? rounding : 0` | |
| `remaining` | cents | `effectiveDue - totalCash - totalCredit - totalVoucher` | negative = overpaid |
| `changeAmount` | cents | `remaining < 0 ? -remaining : 0` | cash change |
| `canPay` | bool | `remaining <= 0` | |
| `appliedPaymentLines` | PaymentLine[] | change subtracted from last cash lines | for server payload |

---

## Stage 4 — Finalization (one-shot, on Pay click)

### Step 4a: Calc Tax

**File**: `libs/sale/finalize-lines.ts`

```typescript
function calcTax(exactDue: Int, lineTotal: Int, lines: SaleLineType[], totalSurcharge: Int): TaxCalcResult
```

| Output | Calculation | Note |
|--------|-------------|------|
| `taxableRatio` | `Σ(taxable line.total) / lineTotal` | fraction, use careful int math |
| `goodsTaxAmount` | `Math.round(exactDue * taxableRatio / 11)` | GST on goods |
| `surchargeTaxAmount` | `Math.round(totalSurcharge / 11)` | GST on surcharge |
| `taxAmount` | `goodsTaxAmount + surchargeTaxAmount` | total GST for invoice |

### Step 4b: Allocate Discounts to Lines

```typescript
function allocateDiscountsToLines(
  lines: SaleLineType[],
  discounts: SaleStoreDiscount[],
  documentDiscountAmount: Int,
): FinalizedLine[]
```

1. Promotion discounts → target lines only (`discount.targetItemIds`), proportional by `line.total / target_total`
2. Manual document discount → ALL lines, proportional by `line.total / lineTotal`
3. Per-line sum → `line.discount_amount`
4. **Largest-remainder rounding** to guarantee `Σ(discount_amount) === totalDiscount` exactly

### Step 4c: Allocate Tax per Line

```typescript
function allocateTaxToLines(lines: FinalizedLine[], goodsTaxAmount: Int): FinalizedLine[]
```

- Taxable lines only, proportional by `line.total / taxable_total`
- **Largest-remainder rounding** to guarantee `Σ(tax_amount_included) === goodsTaxAmount` exactly
- Sets `line.tax_amount_included`
- Non-taxable lines → `tax_amount_included = 0`

### Step 4d: Build Payload

**File**: `libs/sale/build-payload.ts`

```typescript
function buildPayload(
  finalizedLines: FinalizedLine[],
  saleTotals: SaleTotals,
  docAdj: DocumentAdjustments,
  paymentCalc: PaymentCalcResult,
  taxCalc: TaxCalcResult,
  member: { id: string; level: number } | null,
  discounts: SaleStoreDiscount[],
): CreateSaleInvoicePayload
```

Maps to server API shape. Key mappings:
- `subtotal` → `saleTotals.subTotal`
- `documentDiscountAmount` → `docAdj.documentDiscountAmount`
- `creditSurchargeAmount` → `paymentCalc.totalSurcharge`
- `rounding` → `paymentCalc.effectiveRounding`
- `total` → `paymentCalc.effectiveDue + paymentCalc.totalSurcharge` (actual customer total)
- `taxAmount` → `taxCalc.taxAmount`
- `cashPaid` → from appliedPaymentLines (net of change)
- `cashChange` → `paymentCalc.changeAmount`
- `creditPaid` → `paymentCalc.totalCredit`
- `voucherPaid` → `paymentCalc.totalVoucher`
- `totalDiscountAmount` → `docAdj.totalDiscountAmount`
- `rows` → `finalizedLines.map(sanitizeRow)` — includes `discount_amount`
- `payments` → `paymentCalc.appliedPaymentLines`
- `discounts` → promo `SaleStoreDiscount[]` mapped to server shape

---

## File Structure

```
libs/sale/
  types.ts                ← SaleTotals, DocumentAdjustments, PaymentCalcResult, TaxCalcResult, FinalizedLine, Payment, PaymentLine
  calc-sale-totals.ts     ← calcSaleTotals (Stage 1) + calcDocumentAdjustments (Stage 2)
  calc-payments.ts        ← calcPayments (Stage 3)
  finalize-lines.ts       ← calcTax + allocateDiscountsToLines + allocateTaxToLines (Stage 4)
  build-payload.ts        ← buildPayload (Stage 4d)

screens/NewSaleScreen/
  NewPaymentModal.tsx     ← UI + local state (thin)
  useNewPaymentCalc.ts    ← useMemo wrapper calling calcDocumentAdjustments + calcPayments
```

---

## useNewPaymentCalc (thin reactive wrapper)

```typescript
function useNewPaymentCalc(inputs: {
  saleTotals: SaleTotals,                    // frozen Stage 1
  documentDiscountMethod: "percent" | "amount",
  documentDiscountValue: number,             // percent: whole number, amount: cents
  committedPayments: Payment[],
  stagingCash: number,                       // cents
  stagingCredit: number,                     // cents
  surchargeRate: number,                     // permille
})
```

Returns: Stage 2 outputs + Stage 3 outputs + tax calc.
Each is a `useMemo`. No Decimal.

---

## NewPaymentModal handlePayment

```
1. Validate
   - documentDiscountAmount <= subTotal
   - totalCredit <= effectiveDue
   - remaining <= 0
2. const taxCalc = calcTax(exactDue, lineTotal, lines, totalSurcharge)
3. const finalized = allocateDiscountsToLines(lines, discounts, documentDiscountAmount)
4. const withTax = allocateTaxToLines(finalized, taxCalc.goodsTaxAmount)
5. const payload = buildPayload(withTax, saleTotals, docAdj, paymentCalc, taxCalc, member, discounts)
6. const result = await createSaleInvoice(payload)
7. if cashPaid > 0 → kickDrawer()
8. Print receipt
9. changeAmount > 0 → show change screen, else complete
```

---

## Display Conversion

All internal values = Int cents. UI display:
- `fmtMoney(cents) = (cents / MONEY_SCALE).toFixed(MONEY_DP)` → "$10.50"
- MoneyNumpad: already returns cents
- Note buttons: `[100, 50, 20, 10, 5, 2, 1, 0.5]` dollars → `[10000, 5000, 2000, 1000, 500, 200, 100, 50]` cents
- EFTPOS display: `fmtMoney(credit + surcharge)`
- Surcharge rate display: `(surchargeRate / PCT_SCALE * 100).toFixed(2)%` → "1.50%"

---

## sanitizeRow Update

```typescript
type InvoiceRowPayload = {
  ...existing fields,
  discount_amount: number,  // NEW — cents, allocated at Stage 4b
}

function sanitizeRow(line: FinalizedLine): InvoiceRowPayload {
  ...existing,
  tax_amount_included: line.tax_amount_included,  // from Stage 4c, NOT from cart
  discount_amount: line.discount_amount,           // from Stage 4b
}
```

---

## Implementation Order

1. `libs/sale/types.ts` — define all types first
2. `libs/sale/calc-sale-totals.ts` — Stage 1+2 pure functions
3. `libs/sale/calc-payments.ts` — Stage 3 pure function
4. `libs/sale/finalize-lines.ts` — Stage 4a+4b+4c (discount/tax allocation)
5. `libs/sale/build-payload.ts` — Stage 4d
6. `useNewPaymentCalc.ts` — thin reactive hook
7. `NewPaymentModal.tsx` — UI
8. `sale.service.ts` — update sanitizeRow + InvoiceRowPayload
9. Wire into NewSaleScreen
