# Sale Point Earning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add member-only point earning for completed `SALE` invoices, store the earned point snapshot, store row point eligibility, and show earned points on receipts and invoice previews.

**Architecture:** Item point exclusion is captured at scan time and carried through cart lines into the sale payload. The renderer calculates a preview inside the existing payment calculation hub, while the server calculates the canonical `pointsEarned` during sale creation and persists it on `SaleInvoice`. Receipt rendering and invoice preview display the persisted invoice value for normal `SALE` documents only.

**Tech Stack:** Electron 40, React 19, TypeScript, Express 5, Prisma 7, PostgreSQL, existing canvas ESC/POS receipt renderer.

---

## File Structure

- `retail_pos_server/prisma/schema.prisma`
  - Add `SaleInvoice.pointsEarned`.
  - Add `SaleInvoiceRow.isPointExcluded`.
- `retail_pos_app/src/renderer/src/types/sales.ts`
  - Add the point-exclusion snapshot to `SaleLineItem`.
- `retail_pos_app/src/renderer/src/libs/item-utils.ts`
  - Copy `Item.isPointExcluded` into each scanned sale-line snapshot.
- `retail_pos_app/src/renderer/src/libs/sale/payload.types.ts`
  - Add `isPointExcluded` to sale row payloads.
- `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
  - Include row `isPointExcluded` in `buildRow`.
- `retail_pos_app/src/renderer/src/service/sale.service.ts`
  - Add `pointsEarned` and `isPointExcluded` to invoice API types.
- `retail_pos_app/src/renderer/src/libs/sale/points.ts`
  - New pure helper for point calculation shared by renderer hook logic.
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
  - Expose `eligiblePointBase` and `pointsEarned`.
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - Pass member/rate inputs into `usePaymentCal`.
  - Show earned points in the payment summary when positive.
- `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`
  - Pass point inputs that keep repay point earning disabled in this phase.
- `retail_pos_server/src/v1/sale/sale.types.ts`
  - Mirror `SaleRowPayload.isPointExcluded`.
- `retail_pos_server/src/v1/sale/sale.points.ts`
  - New canonical server-side point calculation helper.
- `retail_pos_server/src/v1/sale/sale.create.service.ts`
  - Compute and persist `pointsEarned`.
  - Persist row `isPointExcluded`.
- `retail_pos_server/src/v1/sale/sale.refund.service.ts`
  - Set refund invoice `pointsEarned` to `0`.
  - Copy `isPointExcluded` onto refund rows only as a row snapshot.
- `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
  - Print `Points Earned` for `SALE` invoices where `pointsEarned > 0`.
- `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`
  - Display the same `Points Earned` row in the receipt preview.

## Task 1: Persist Point Fields In Prisma

**Files:**
- Modify: `retail_pos_server/prisma/schema.prisma`

- [ ] **Step 1: Add invoice-level point snapshot**

In `model SaleInvoice`, add `pointsEarned` in the receipt/operational group so it sits near other invoice-level persisted outcomes:

```prisma
  // ── Receipt / operational ────────────────────────────────
  receiptCount Int     @default(0) // 영수증 재출력 횟수 (감사)
  pointsEarned Int     @default(0) // SALE member point snapshot. REFUND/SPEND stay 0.
  note         String?
```

- [ ] **Step 2: Add row-level point exclusion snapshot**

In `model SaleInvoiceRow`, add `isPointExcluded` with the item snapshot fields:

```prisma
  // ── Item snapshot (flat columns — 마스터 변경 무관하게 재출력 가능) ──
  itemId          Int
  name_en         String
  name_ko         String
  barcode         String
  uom             String
  taxable         Boolean
  isPointExcluded Boolean @default(false)
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
cd retail_pos_server
npx prisma generate
```

Expected: Prisma generates `src/generated/prisma` without schema errors.

- [ ] **Step 4: Build the server to expose missing code updates**

Run:

```bash
cd retail_pos_server
npm run build
```

Expected at this point: TypeScript fails where create/refund code does not yet provide `pointsEarned` or `isPointExcluded`, or passes if Prisma create input accepts defaults. Continue either way.

- [ ] **Step 5: Commit schema checkpoint**

```bash
git add retail_pos_server/prisma/schema.prisma retail_pos_server/src/generated/prisma
git commit -m "feat: add point snapshots to sale schema"
```

## Task 2: Propagate Item Exclusion Through Client Payload Types

**Files:**
- Modify: `retail_pos_app/src/renderer/src/types/sales.ts`
- Modify: `retail_pos_app/src/renderer/src/libs/item-utils.ts`
- Modify: `retail_pos_app/src/renderer/src/libs/sale/payload.types.ts`
- Modify: `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
- Modify: `retail_pos_app/src/renderer/src/service/sale.service.ts`
- Modify: `retail_pos_server/src/v1/sale/sale.types.ts`

- [ ] **Step 1: Add `isPointExcluded` to the cart line snapshot type**

In `SaleLineItem` after `taxable`, add:

```ts
  /**
   * Point eligibility flag snapshotted at scan time. When true, this line's
   * total does not contribute to member point earning.
   */
  isPointExcluded: boolean;
```

- [ ] **Step 2: Copy the item flag during scan conversion**

In `generateSaleLineItem`, destructure and return the flag:

```ts
export const generateSaleLineItem = (
  item: Item,
  rawBarcode: string,
): SaleLineItem => {
  const {
    id,
    taxable,
    isPointExcluded,
    uom,
    barcode,
    barcodeGTIN,
  } = item;
```

Then include it in the returned object:

```ts
    taxable,
    isPointExcluded,
    uom: type === "weight" ? "kg" : uom.toLowerCase(),
```

- [ ] **Step 3: Add `isPointExcluded` to client sale row payload type**

In `SaleRowPayload`, place it with item snapshots:

```ts
  taxable: boolean;
  isPointExcluded: boolean;
```

- [ ] **Step 4: Include `isPointExcluded` in `buildRow`**

In `buildRow`, include:

```ts
    taxable: line.taxable,
    isPointExcluded: line.isPointExcluded,
```

- [ ] **Step 5: Add invoice API response fields**

In `SaleInvoiceCreated`, add:

```ts
  pointsEarned: number;
```

In `SaleInvoiceListItem`, add near money fields:

```ts
  pointsEarned: number;
```

In `SaleInvoiceRowItem`, add with item snapshots:

```ts
  taxable: boolean;
  isPointExcluded: boolean;
```

- [ ] **Step 6: Mirror payload row type on the server**

In `retail_pos_server/src/v1/sale/sale.types.ts`, add:

```ts
  taxable: boolean;
  isPointExcluded: boolean;
```

- [ ] **Step 7: Build the app and server**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: App build succeeds after all client references compile.

Run:

```bash
cd retail_pos_server
npm run build
```

Expected at this point: Server may still fail until Task 4 persists row `isPointExcluded`. Continue to Task 4 if so.

- [ ] **Step 8: Commit payload propagation**

```bash
git add retail_pos_app/src/renderer/src/types/sales.ts \
  retail_pos_app/src/renderer/src/libs/item-utils.ts \
  retail_pos_app/src/renderer/src/libs/sale/payload.types.ts \
  retail_pos_app/src/renderer/src/libs/sale/build-payload.ts \
  retail_pos_app/src/renderer/src/service/sale.service.ts \
  retail_pos_server/src/v1/sale/sale.types.ts
git commit -m "feat: carry point exclusion through sale payload"
```

## Task 3: Add Client Point Preview Calculation

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/sale/points.ts`
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
- Modify: `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`

- [ ] **Step 1: Create the pure point helper**

Create `retail_pos_app/src/renderer/src/libs/sale/points.ts`:

```ts
export interface PointLine {
  total: number;
  isPointExcluded: boolean;
}

export interface CalculateSalePointsInput {
  lines: PointLine[];
  linesTotal: number;
  cashApplied: number;
  hasMember: boolean;
  cashPointRate: number;
  otherPointRate: number;
}

export interface SalePointsResult {
  eligiblePointBase: number;
  cashPointBase: number;
  otherPointBase: number;
  pointsEarned: number;
}

export function calculateSalePoints({
  lines,
  linesTotal,
  cashApplied,
  hasMember,
  cashPointRate,
  otherPointRate,
}: CalculateSalePointsInput): SalePointsResult {
  const eligiblePointBase = lines.reduce(
    (sum, line) => sum + (line.isPointExcluded ? 0 : line.total),
    0,
  );

  if (!hasMember || eligiblePointBase <= 0 || linesTotal <= 0) {
    return {
      eligiblePointBase,
      cashPointBase: 0,
      otherPointBase: 0,
      pointsEarned: 0,
    };
  }

  const cappedCashApplied = Math.min(Math.max(0, cashApplied), linesTotal);
  const cashPointBase = Math.round(
    (eligiblePointBase * cappedCashApplied) / linesTotal,
  );
  const otherPointBase = eligiblePointBase - cashPointBase;
  const pointsEarned =
    Math.round((cashPointBase * cashPointRate) / 1000) +
    Math.round((otherPointBase * otherPointRate) / 1000);

  return {
    eligiblePointBase,
    cashPointBase,
    otherPointBase,
    pointsEarned,
  };
}
```

- [ ] **Step 2: Wire the helper into `usePaymentCal`**

At the top of `usePaymentCal.ts`, import:

```ts
import { calculateSalePoints } from "../../../libs/sale/points";
```

Extend the hook parameters:

```ts
export function usePaymentCal({
  lines,
  credit_surcharge_rate,
  cash_point_rate,
  other_point_rate,
  hasMember,
  payments,
}: {
  lines: SaleLineType[];
  credit_surcharge_rate: number;
  cash_point_rate: number;
  other_point_rate: number;
  hasMember: boolean;
  payments: PaymentQueueItem[];
}) {
```

After `cashApplied` is calculated, add:

```ts
  const pointResult = useMemo(
    () =>
      calculateSalePoints({
        lines,
        linesTotal,
        cashApplied,
        hasMember,
        cashPointRate: cash_point_rate,
        otherPointRate: other_point_rate,
      }),
    [
      lines,
      linesTotal,
      cashApplied,
      hasMember,
      cash_point_rate,
      other_point_rate,
    ],
  );
```

Expose the values in the return object:

```ts
    eligiblePointBase: pointResult.eligiblePointBase,
    cashPointBase: pointResult.cashPointBase,
    otherPointBase: pointResult.otherPointBase,
    pointsEarned: pointResult.pointsEarned,
```

- [ ] **Step 3: Pass point inputs from the normal payment modal**

In `PaymentModal`, add:

```ts
  const cash_point_rate = storeSetting?.cash_point_rate ?? 10;
  const other_point_rate = storeSetting?.other_point_rate ?? 10;
  const activeMember = carts[activeCartIndex]?.member ?? null;
```

Update the hook call:

```ts
  const cal = usePaymentCal({
    lines,
    credit_surcharge_rate,
    cash_point_rate,
    other_point_rate,
    hasMember: activeMember != null,
    payments: combinedPayments,
  });
```

- [ ] **Step 4: Show preview points in the normal sale summary**

Find the existing summary area that renders totals and tender sums in `PaymentModal/index.tsx`. Add this row near the total/due lines so it appears before completing a member sale:

```tsx
{cal.pointsEarned > 0 && !spendMode && (
  <div className="flex items-center justify-between text-sm text-emerald-700 font-bold">
    <span>Points Earned</span>
    <span>{cal.pointsEarned.toLocaleString()}</span>
  </div>
)}
```

- [ ] **Step 5: Keep repay point preview disabled**

In `PaymentModalForRepay`, update the hook call:

```ts
  const cal = usePaymentCal({
    lines,
    credit_surcharge_rate,
    cash_point_rate: 0,
    other_point_rate: 0,
    hasMember: false,
    payments: combinedPayments,
  });
```

- [ ] **Step 6: Build the app**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: App build succeeds.

- [ ] **Step 7: Commit client point preview**

```bash
git add retail_pos_app/src/renderer/src/libs/sale/points.ts \
  retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts \
  retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx \
  retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx
git commit -m "feat: preview member points during sale payment"
```

## Task 4: Add Canonical Server Point Calculation

**Files:**
- Create: `retail_pos_server/src/v1/sale/sale.points.ts`
- Modify: `retail_pos_server/src/v1/sale/sale.create.service.ts`
- Modify: `retail_pos_server/src/v1/sale/sale.refund.service.ts`

- [ ] **Step 1: Create the server point helper**

Create `retail_pos_server/src/v1/sale/sale.points.ts`:

```ts
import { PaymentPayload, SaleRowPayload } from "./sale.types";

export interface CalculateInvoicePointsInput {
  type: "SALE" | "SPEND" | "REFUND";
  member: { id: string } | null;
  rows: Pick<SaleRowPayload, "total" | "isPointExcluded">[];
  payments: Pick<PaymentPayload, "type" | "amount">[];
  linesTotal: number;
  cashPointRate: number;
  otherPointRate: number;
}

export function calculateInvoicePoints({
  type,
  member,
  rows,
  payments,
  linesTotal,
  cashPointRate,
  otherPointRate,
}: CalculateInvoicePointsInput): number {
  if (type !== "SALE" || member == null || linesTotal <= 0) return 0;

  const eligiblePointBase = rows.reduce(
    (sum, row) => sum + (row.isPointExcluded ? 0 : row.total),
    0,
  );
  if (eligiblePointBase <= 0) return 0;

  const cashApplied = payments
    .filter((payment) => payment.type === "CASH")
    .reduce((sum, payment) => sum + payment.amount, 0);

  const cappedCashApplied = Math.min(Math.max(0, cashApplied), linesTotal);
  const cashPointBase = Math.round(
    (eligiblePointBase * cappedCashApplied) / linesTotal,
  );
  const otherPointBase = eligiblePointBase - cashPointBase;

  return (
    Math.round((cashPointBase * cashPointRate) / 1000) +
    Math.round((otherPointBase * otherPointRate) / 1000)
  );
}
```

- [ ] **Step 2: Use the helper in sale creation**

In `sale.create.service.ts`, import:

```ts
import { calculateInvoicePoints } from "./sale.points";
```

Inside `buildSaleInTx`, before `tx.saleInvoice.create`, add:

```ts
  const pointsEarned = calculateInvoicePoints({
    type: payload.type,
    member: payload.member,
    rows: payload.rows,
    payments: payload.payments,
    linesTotal: payload.linesTotal,
    cashPointRate: storeSetting.cash_point_rate,
    otherPointRate: storeSetting.other_point_rate,
  });
```

In the invoice create data, add:

```ts
      pointsEarned,
```

In nested row create data, add:

```ts
          isPointExcluded: r.isPointExcluded,
```

- [ ] **Step 3: Set refund invoices to earn zero and copy row flag**

In `sale.refund.service.ts`, inside the `saleInvoice.create` data for refunds, add:

```ts
      pointsEarned: 0,
```

Inside refund row create data, add:

```ts
          isPointExcluded: c.origRow.isPointExcluded,
```

- [ ] **Step 4: Build the server**

Run:

```bash
cd retail_pos_server
npm run build
```

Expected: Server build succeeds.

- [ ] **Step 5: Commit server point calculation**

```bash
git add retail_pos_server/src/v1/sale/sale.points.ts \
  retail_pos_server/src/v1/sale/sale.create.service.ts \
  retail_pos_server/src/v1/sale/sale.refund.service.ts
git commit -m "feat: calculate sale points on server"
```

## Task 5: Display Earned Points On Receipts And Invoice Preview

**Files:**
- Modify: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
- Modify: `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`

- [ ] **Step 1: Account for one extra receipt line**

In `estimateHeight`, add one estimated line for non-refund sale receipts that
will print earned points. Place this near the other `totalLines` increments:

```ts
  if (invoice.type === "SALE" && invoice.pointsEarned > 0) totalLines += 1;
```

- [ ] **Step 2: Print points in the canvas receipt**

In `renderSaleInvoiceReceipt`, after the `You Saved` row, add:

```ts
    if (!isRefund && invoice.type === "SALE" && invoice.pointsEarned > 0) {
      row(ctx, "Points Earned", invoice.pointsEarned.toLocaleString(), y);
      y += LH;
    }
```

- [ ] **Step 3: Display points in the React invoice viewer**

In `Receipt` inside `SaleInvoiceViewer.tsx`, after the `You Saved` row, add:

```tsx
            {!isRefund && invoice.type === "SALE" && invoice.pointsEarned > 0 && (
              <div className="flex justify-between">
                <span>Points Earned</span>
                <span>{invoice.pointsEarned.toLocaleString()}</span>
              </div>
            )}
```

- [ ] **Step 4: Build the app**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: App build succeeds.

- [ ] **Step 5: Commit receipt and viewer display**

```bash
git add retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts \
  retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx
git commit -m "feat: show earned points on sale receipts"
```

## Task 6: Final Verification

**Files:**
- Verify working tree only.

- [ ] **Step 1: Run server build**

```bash
cd retail_pos_server
npm run build
```

Expected: `tsc` exits with code `0`.

- [ ] **Step 2: Run app build**

```bash
cd retail_pos_app
npm run build
```

Expected: `electron-vite build` exits with code `0`.

- [ ] **Step 3: Inspect point-related diff**

Run:

```bash
git diff --stat HEAD
git diff -- retail_pos_app/src/renderer/src/libs/sale/points.ts \
  retail_pos_server/src/v1/sale/sale.points.ts \
  retail_pos_server/prisma/schema.prisma
```

Expected: Only point-earning implementation changes appear.

- [ ] **Step 4: Manual sale scenarios**

Run these in the app against a local server with the schema applied:

```text
1. No member, eligible item, cash payment: receipt/viewer hides Points Earned.
2. Member, eligible item, cash payment: Points Earned uses cash_point_rate.
3. Member, eligible item, credit payment: Points Earned uses other_point_rate.
4. Member, eligible item, mixed cash and credit: Points Earned splits by cashApplied.
5. Member, excluded item only: receipt/viewer hides Points Earned.
6. Member, eligible and excluded items: points are based only on eligible line totals.
7. Member, cash received above total: change does not earn points.
```

Expected: Completed `SALE` invoices persist `pointsEarned`, rows persist `isPointExcluded`, and printed/copy receipts match the invoice viewer.

- [ ] **Step 5: Commit verification notes if docs changed**

If the implementation updates the design or plan after verification, commit the docs:

```bash
git add docs/superpowers/specs/2026-05-06-sale-point-earning-design.md \
  docs/superpowers/plans/2026-05-06-sale-point-earning.md
git commit -m "docs: update sale point earning plan"
```

If docs did not change, skip this commit and leave the working tree clean.
