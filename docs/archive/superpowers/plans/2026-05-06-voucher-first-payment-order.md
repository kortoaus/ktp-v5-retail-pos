# Voucher-First Payment Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voucher the first payment stage, allow cash after voucher, and prevent voucher/cash re-entry once exact tenders have been committed.

**Architecture:** Keep the existing `PaymentModal` state model and extend its ordering guards from cash-first to voucher-first / cash-second / exact-last. `usePaymentCal` keeps all settlement math centralized, but rounding changes from "cash-only invoice" to "cash-settled remainder when no exact tender is present." Customer Voucher is UI placeholder only and is mutually exclusive with User Voucher via `activeMember ? CUSTOMER_VOUCHER : USER_VOUCHER`.

**Tech Stack:** React 19 renderer, TypeScript strict mode, Electron Vite build, existing `PaymentQueueItem` union and `usePaymentCal` hook.

---

## File Structure

- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - Build the payment button list dynamically.
  - Move voucher slot to the top.
  - Add lock helpers for voucher-first and cash-second ordering.
  - Keep Customer Voucher as a non-committable placeholder.
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
  - Split voucher tender from exact non-cash tender for rounding.
  - Apply 5-cent rounding to the cash-settled remainder after voucher when no credit/giftcard is involved.
- No schema/API changes.
- No point-earning changes in this plan.

---

### Task 1: Dynamic Voucher-First Button Order

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Replace the static `PAYMENT_TYPE` list with exact tender constants**

Replace:

```ts
const PAYMENT_TYPE: TenderSlot[] = [
  "CASH",
  "CREDIT",
  "USER_VOUCHER",
  "GIFTCARD",
]; // todo: CUSTOMER_VOUCHER
```

with:

```ts
const EXACT_TENDER_SLOTS: TenderSlot[] = ["CREDIT", "GIFTCARD"];
```

- [ ] **Step 2: Add dynamic payment type ordering inside `PaymentModal` after `activeMember`**

Add:

```ts
  const voucherSlot: TenderSlot = activeMember
    ? "CUSTOMER_VOUCHER"
    : "USER_VOUCHER";
  const paymentTypes: TenderSlot[] = [voucherSlot, "CASH", ...EXACT_TENDER_SLOTS];
```

Expected UI order:

```text
No member:      User Voucher, Cash, Credit, Gift Card
Member present: Customer Voucher, Cash, Credit, Gift Card
```

This implements the rule that User Voucher and Customer Voucher are mutually exclusive.

- [ ] **Step 3: Update the button renderer to use `paymentTypes`**

Replace:

```tsx
            {PAYMENT_TYPE.map((pt, idx) => {
```

with:

```tsx
            {paymentTypes.map((pt, idx) => {
```

- [ ] **Step 4: Build the app to catch type mistakes**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

---

### Task 2: Voucher-First And Cash-Second Lock Rules

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Add tender classification helpers near `slotOf`**

Add:

```ts
function isVoucherSlot(slot: TenderSlot): boolean {
  return slot === "USER_VOUCHER" || slot === "CUSTOMER_VOUCHER";
}

function isExactTenderPayment(p: PaymentQueueItem): boolean {
  return p.tender === "CREDIT" || p.tender === "GIFTCARD";
}
```

- [ ] **Step 2: Replace `cashLocked` with explicit order locks**

Replace the current block:

```ts
  const cashLocked = payments.some((p) => p.tender !== "CASH");
```

with:

```ts
  const voucherLocked = payments.some((p) => p.tender !== "VOUCHER");
  const cashLocked = payments.some(isExactTenderPayment);
```

Meaning:

```text
Voucher can be added only before cash/credit/giftcard.
Cash can be added after voucher, but not after credit/giftcard.
Credit/giftcard remain exact-last tenders.
```

Multi-cash remains allowed until credit/giftcard is committed, matching the existing cash behavior.

- [ ] **Step 3: Update `changeSlot` guards**

Replace:

```ts
    if (slot === "CASH" && cashLocked) return;
```

with:

```ts
    if (isVoucherSlot(slot) && voucherLocked) return;
    if (slot === "CASH" && cashLocked) return;
```

- [ ] **Step 4: Update payment button disabled logic**

Replace:

```ts
              const isDisabled = spendMode || (pt === "CASH" && cashLocked);
```

with:

```ts
              const isDisabled =
                spendMode ||
                (isVoucherSlot(pt) && voucherLocked) ||
                (pt === "CASH" && cashLocked);
```

- [ ] **Step 5: Build the app**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

---

### Task 3: Customer Voucher Placeholder Behavior

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Keep Customer Voucher selection non-committable**

Leave `makeDefaultStage("CUSTOMER_VOUCHER")` as:

```ts
    case "CUSTOMER_VOUCHER":
      return {
        key: "staged",
        tender: "VOUCHER",
        amount: 0,
        entityType: "customer-voucher",
        entityId: 0,
        entityLabel: "",
      };
```

Because `entityId` stays `0` and amount stays `0`, `commitStaged()` will refuse it:

```ts
    if (stagedPayment.tender === "VOUCHER" && stagedPayment.entityId <= 0)
      return;
```

- [ ] **Step 2: Update the placeholder copy**

Replace the current Customer Voucher placeholder:

```tsx
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  CUSTOMER VOUCHER input — TODO
                </div>
```

with:

```tsx
                <div className="h-full flex items-center justify-center text-gray-400 text-sm font-medium">
                  CUSTOMER VOUCHER lookup pending
                </div>
```

- [ ] **Step 3: Manual UI check**

Run:

```bash
cd retail_pos_app && npm run dev
```

Expected:

```text
Without member: User Voucher is the top payment button.
With member: Customer Voucher is the top payment button and shows placeholder input.
User Voucher and Customer Voucher are never shown together.
```

---

### Task 4: Voucher-Aware Cash Rounding

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`

- [ ] **Step 1: Add exact non-cash bill calculation**

After `voucherBill`, add:

```ts
  const exactNonCashBill = useMemo(
    () =>
      payments.reduce((s, p) => {
        if (p.tender === "CREDIT") {
          return s + billPortionOf(p, credit_surcharge_rate);
        }
        if (p.tender === "GIFTCARD") return s + p.amount;
        return s;
      }, 0),
    [payments, credit_surcharge_rate],
  );
```

- [ ] **Step 2: Update rounding mode**

Replace:

```ts
  const cashOnlyMode = nonCashBill === 0;
  const cashTarget = Math.max(0, linesTotal - nonCashBill);
```

with:

```ts
  const cashRoundingMode = exactNonCashBill === 0;
  const cashTarget = Math.max(0, linesTotal - voucherBill - exactNonCashBill);
```

Replace:

```ts
    cashOnlyMode && cashIntent > 0 && cashIntent >= roundedCashTarget;
```

with:

```ts
    cashRoundingMode && cashIntent > 0 && cashIntent >= roundedCashTarget;
```

Expected behavior:

```text
Cash only: same as today.
Voucher + cash: cash remainder can round to nearest 5c.
Voucher only: no rounding.
Voucher + credit/giftcard: no rounding.
Voucher + cash + credit/giftcard: no rounding once exact tender is involved.
```

- [ ] **Step 3: Update `exactCashAmount` in `index.tsx`**

Replace:

```ts
  const exactCashAmount = payments.some((p) => p.tender !== "CASH")
    ? left
    : round5(left);
```

with:

```ts
  const exactCashAmount = payments.some(isExactTenderPayment)
    ? left
    : round5(left);
```

This makes voucher + cash use the rounded cash remainder when the cashier presses `EXACT`.

- [ ] **Step 4: Build the app**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

---

### Task 5: Manual Settlement Verification

**Files:**
- Verify behavior in `retail_pos_app`.

- [ ] **Step 1: Cash-only regression**

Scenario:

```text
linesTotal = $10.03
cash exact
```

Expected:

```text
rounding = +$0.02
total = $10.05
cashApplied = $10.05
remaining = $0.00
```

- [ ] **Step 2: Voucher + cash positive rounding**

Scenario:

```text
linesTotal = $10.03
voucher = $5.00
cash exact
```

Expected:

```text
rounding = +$0.02
total = $10.05
voucher = $5.00
cashApplied = $5.05
remaining = $0.00
```

- [ ] **Step 3: Voucher + cash negative rounding**

Scenario:

```text
linesTotal = $10.02
voucher = $5.00
cash exact
```

Expected:

```text
rounding = -$0.02
total = $10.00
voucher = $5.00
cashApplied = $5.00
remaining = $0.00
```

- [ ] **Step 4: Voucher + credit remains exact**

Scenario:

```text
linesTotal = $10.03
voucher = $5.00
credit = $5.03 bill portion
```

Expected:

```text
rounding = $0.00
remaining = $0.00
cash button remains disabled after credit/giftcard is committed
```

- [ ] **Step 5: Cash then voucher lock**

Scenario:

```text
cash committed first
try selecting User Voucher or Customer Voucher
```

Expected:

```text
voucher button is disabled
changeSlot ignores voucher slot
```

- [ ] **Step 6: Voucher then cash allowed**

Scenario:

```text
voucher committed first
select cash
```

Expected:

```text
cash button remains enabled
cash can be committed
```

- [ ] **Step 7: Credit/giftcard then cash lock**

Scenario:

```text
credit or giftcard committed first
try selecting cash
```

Expected:

```text
cash button is disabled
changeSlot ignores cash slot
```

---

### Task 6: Final Verification And Commit

**Files:**
- Modified app files only.

- [ ] **Step 1: Run production build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts
```

Expected:

```text
Diff only contains payment order, voucher placeholder, cash lock, and rounding changes.
No point-earning changes.
No unrelated docs or generated output included.
```

- [ ] **Step 3: Commit only implementation files**

Run:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts
git commit -m "fix: allow voucher-first cash settlement"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: Covers voucher-first order, cash-after-voucher, exact tender lock, Customer Voucher placeholder, and mutual exclusion between User Voucher and Customer Voucher.
- Placeholder scan: Customer Voucher placeholder is intentional and explicitly non-committable.
- Type consistency: Uses existing `TenderSlot`, `PaymentQueueItem`, `stagedPayment`, `payments`, `activeMember`, `slotOf`, `round5`, and `left` names.
- Scope check: Renderer-only change. No server, schema, cloud sync, receipt, or point-earning behavior is part of this plan.
