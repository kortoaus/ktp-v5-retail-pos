# Member Level 1 Approx Total Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show non-member shoppers an approximate level 1 member cart total in the PaymentModal and customer display without changing actual sale/payment math.

**Architecture:** Add one renderer-only pure estimate helper that reuses existing cart repricing rules with `memberLevel = 1`. PaymentModal and DocumentMonitor consume that helper for display only. `usePaymentCal`, sale payload building, receipt printing, and server code remain untouched.

**Tech Stack:** Electron renderer, React 19, Zustand sales store, TypeScript strict mode, Tailwind classes, existing `SalesStore.helper.ts` pricing utilities.

---

## Scope Check

This plan touches one subsystem: renderer cart/payment display. It does not cross into Electron main/preload, local server, cloud sync, receipts, or persisted invoice data.

## File Structure

- Create `retail_pos_app/src/renderer/src/libs/sale/member-level-estimate.ts`
  - Owns the level 1 marketing estimate.
  - Pure function only, no React, no store reads, no API calls.
  - Reuses `recalculateCartLines` so level and promo price behavior matches the cart.
- Modify `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - Computes the estimate from the active cart.
  - Displays a small line immediately above the Complete button.
  - Keeps Spend mode and actual Complete button state unchanged.
- Modify `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`
  - Computes the same estimate from the active cart in the shared store.
  - Shows a larger customer-facing message only when `displayMode === "customer"`.
- Do not modify `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`.
- Do not modify `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`.

## Task 1: Add Pure Member Level 1 Estimate Helper

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/sale/member-level-estimate.ts`
- Read: `retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`

- [ ] **Step 1: Verify helper does not exist yet**

Run:

```bash
cd retail_pos_app && test ! -f src/renderer/src/libs/sale/member-level-estimate.ts
```

Expected: command exits `0`. If the file already exists, read it and adapt this task instead of overwriting user work.

- [ ] **Step 2: Write the failing compile check**

Create a temporary import in `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx` near the existing imports:

```ts
import { getMemberLevelOneEstimate } from "../../libs/sale/member-level-estimate";
```

Do not use the import yet.

- [ ] **Step 3: Run TypeScript to verify the missing helper fails**

Run:

```bash
cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json
```

Expected: FAIL with a message like:

```text
Cannot find module '../../libs/sale/member-level-estimate'
```

If the command fails for unrelated pre-existing TypeScript errors, capture those errors and stop for a human decision before implementing.

- [ ] **Step 4: Add the helper file**

Create `retail_pos_app/src/renderer/src/libs/sale/member-level-estimate.ts`:

```ts
import {
  type SaleMember,
  recalculateCartLines,
} from "../../store/SalesStore.helper";
import type { SaleLineType } from "../../types/sales";

const MEMBER_LEVEL_ONE = 1;

export interface MemberLevelOneEstimate {
  currentTotal: number;
  memberTotal: number;
  savings: number;
}

export function getMemberLevelOneEstimate({
  lines,
  member,
}: {
  lines: SaleLineType[];
  member: SaleMember | null;
}): MemberLevelOneEstimate | null {
  if (member != null || lines.length === 0) return null;

  const currentTotal = lines.reduce((sum, line) => sum + line.total, 0);
  if (currentTotal <= 0) return null;

  const estimatedCart = recalculateCartLines(
    { lines, member: null },
    MEMBER_LEVEL_ONE,
  );
  const memberTotal = estimatedCart.lines.reduce(
    (sum, line) => sum + line.total,
    0,
  );
  const savings = currentTotal - memberTotal;

  if (memberTotal <= 0 || savings <= 0) return null;

  return { currentTotal, memberTotal, savings };
}
```

- [ ] **Step 5: Run TypeScript to verify the missing-helper failure is fixed**

Run:

```bash
cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS with no output.

- [ ] **Step 6: Remove the temporary unused import**

Remove the temporary `getMemberLevelOneEstimate` import from `DocumentMonitor.tsx`. It will be re-added in Task 3 where it is actually used.

- [ ] **Step 7: Commit helper**

Run:

```bash
git add retail_pos_app/src/renderer/src/libs/sale/member-level-estimate.ts
git commit -m "feat: add member level one estimate helper"
```

Expected: commit succeeds.

## Task 2: Show Small Estimate In PaymentModal

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
- Read: `retail_pos_app/src/renderer/src/libs/constants.ts`

- [ ] **Step 1: Add helper import**

Add this import near the other `libs/sale` imports:

```ts
import { getMemberLevelOneEstimate } from "../../../libs/sale/member-level-estimate";
```

- [ ] **Step 2: Compute the estimate**

After `activeMember` is defined, add:

```ts
  const memberLevelEstimate = useMemo(
    () => getMemberLevelOneEstimate({ lines, member: activeMember }),
    [lines, activeMember],
  );
```

This keeps the estimate separate from `usePaymentCal`.

- [ ] **Step 3: Wrap the bottom action area**

Replace the existing spend/sale button block with this structure. Keep the existing `handleSpend`, `handleCompleteSale`, `completeDisabled`, and payment category logic unchanged.

```tsx
            <div className="mt-auto flex flex-col gap-2">
              {!spendMode && memberLevelEstimate && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Member total approx
                  </div>
                  <div className="font-mono text-sm font-bold text-emerald-800">
                    ${fmtMoney(memberLevelEstimate.memberTotal)}
                  </div>
                </div>
              )}

              {spendMode ? (
                <TapTarget
                  onClick={handleSpend}
                  disabled={processing || lines.length === 0}
                  className={cn(
                    "h-16 rounded-lg font-bold text-lg tracking-wide text-white flex items-center justify-center",
                    processing || lines.length === 0
                      ? "bg-orange-300 opacity-40 cursor-not-allowed"
                      : "bg-orange-500 active:bg-orange-600",
                  )}
                >
                  RECORD SPEND
                </TapTarget>
              ) : (
                <TapTarget
                  onClick={handleCompleteSale}
                  disabled={completeDisabled}
                  className={cn(
                    "h-16 rounded-lg font-bold text-sm tracking-wide transition",
                    completeDisabled
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed flex items-center justify-center"
                      : cn(
                          "flex items-center justify-center",
                          completePaymentCategory
                            ? PAYMENT_CATEGORY_CLASSES[completePaymentCategory]
                                .button
                            : PAYMENT_CATEGORY_CLASSES.cash.button,
                        ),
                  )}
                >
                  COMPLETE
                  {!completeDisabled && (
                    <span className="ml-2 text-2xl font-mono">
                      ${fmtMoney(cal.total)}
                    </span>
                  )}
                </TapTarget>
              )}
            </div>
```

The important layout change is moving `mt-auto` from the button to the wrapper so the estimate sits directly above the Complete button.

- [ ] **Step 4: Run TypeScript**

Run:

```bash
cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS with no output.

- [ ] **Step 5: Commit PaymentModal display**

Run:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx
git commit -m "feat: show member estimate in payment modal"
```

Expected: commit succeeds.

## Task 3: Show Larger Estimate On Customer Display

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`

- [ ] **Step 1: Import helper**

Add this import:

```ts
import { getMemberLevelOneEstimate } from "../../libs/sale/member-level-estimate";
```

- [ ] **Step 2: Extend the display class type**

Update `DocumentMonitorClassSet`:

```ts
type DocumentMonitorClassSet = {
  root: string;
  itemLabel: string;
  itemLabelStyle?: CSSProperties;
  itemValue: string;
  dueRoot: string;
  dueLabel: string;
  dueValue: string;
  estimateRoot: string;
  estimatePrimary: string;
  estimateSecondary: string;
};
```

- [ ] **Step 3: Add class values for cashier and customer modes**

Add these properties to the `cashier` class set:

```ts
    estimateRoot: "hidden",
    estimatePrimary: "",
    estimateSecondary: "",
```

Add these properties to the `customer` class set:

```ts
    estimateRoot: "mt-2 text-right leading-tight",
    estimatePrimary: "text-emerald-200 text-xl font-bold",
    estimateSecondary: "text-white/80 text-base font-semibold",
```

- [ ] **Step 4: Read active cart member with lines**

Replace the current `lines` store selector:

```ts
  const lines = useSalesStore((s) => s.carts[s.activeCartIndex]?.lines ?? []);
```

with:

```ts
  const activeCart = useSalesStore((s) => s.carts[s.activeCartIndex]);
  const lines = activeCart?.lines ?? [];
  const member = activeCart?.member ?? null;
```

- [ ] **Step 5: Compute customer estimate**

After the totals `useMemo`, add:

```ts
  const memberLevelEstimate = useMemo(
    () => getMemberLevelOneEstimate({ lines, member }),
    [lines, member],
  );
  const showCustomerEstimate =
    displayMode === "customer" && memberLevelEstimate != null;
```

- [ ] **Step 6: Render the estimate under the due value**

Replace the due block:

```tsx
      <div className={classes.dueRoot}>
        <div className={classes.dueLabel}>DUE</div>
        <div className={classes.dueValue}>${fmtMoney(due)}</div>
      </div>
```

with:

```tsx
      <div className={classes.dueRoot}>
        <div className={classes.dueLabel}>DUE</div>
        <div className="flex flex-col items-end">
          <div className={classes.dueValue}>${fmtMoney(due)}</div>
          {showCustomerEstimate && memberLevelEstimate && (
            <div className={classes.estimateRoot}>
              <div className={classes.estimatePrimary}>
                Member total approx: ${fmtMoney(memberLevelEstimate.memberTotal)}
              </div>
              <div className={classes.estimateSecondary}>
                Join & save ${fmtMoney(memberLevelEstimate.savings)}
              </div>
            </div>
          )}
        </div>
      </div>
```

- [ ] **Step 7: Run TypeScript**

Run:

```bash
cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS with no output.

- [ ] **Step 8: Run production build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS. Build output should complete without TypeScript or Vite errors.

- [ ] **Step 9: Manual UI verification**

Start the app:

```bash
cd retail_pos_app && npm run dev
```

Verify:

- Non-member cart with at least one item where `price.prices[1]` or `promoPrice.prices[1]` beats current price shows the estimate above Complete.
- Customer display shows `Member total approx: $X.XX` and `Join & save $Y.YY` in larger text near Due.
- Attaching any member hides both marketing messages.
- A non-member cart with no level 1 savings hides both marketing messages.
- PaymentModal `TOTAL`, `PAID`, `REMAINING`, `CHANGE`, Complete enabled/disabled behavior, cash rounding, and credit surcharge behave exactly as before.
- Spend mode does not show the member estimate above `RECORD SPEND`.

- [ ] **Step 10: Commit customer display**

Stop the dev server, then run:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx
git commit -m "feat: show member estimate on customer display"
```

Expected: commit succeeds.

## Final Verification

- [ ] **Step 1: Check final diff**

Run:

```bash
git status --short
git log --oneline -3
```

Expected:

- `git status --short` is clean.
- The latest commits are the three feature commits from this plan.

- [ ] **Step 2: Confirm forbidden files were not changed**

Run:

```bash
git diff HEAD~3 -- retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts retail_pos_app/src/renderer/src/libs/sale/build-payload.ts retail_pos_server/src/v1/sale/sale.create.service.ts
```

Expected: no diff output.

- [ ] **Step 3: Record validation result**

In the final handoff, report:

- Whether `npx tsc --noEmit -p tsconfig.web.json` passed.
- Whether `npm run build` passed.
- Whether manual UI verification was completed.
- Any pre-existing or environment-specific issues.
