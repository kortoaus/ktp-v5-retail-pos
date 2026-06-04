# Customer Display Readable Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active customer cart display readable on a 12-inch 1366x768 screen while leaving the idle/post display and cashier sale screen behavior unchanged.

**Architecture:** Keep the cashier and customer displays on shared renderer components, but add explicit `"cashier"` / `"customer"` display variants for sizing. `CustomerScreen` owns the customer-specific page size and shows the latest 7 lines independently from the cashier's 10-line offset.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand sale store, Electron renderer `BroadcastChannel`.

---

## File Structure

- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/LineViewer.tsx`
  - Owns cart-line table rendering.
  - Add `displayMode` and `pageSize` props.
  - Use explicit class maps for cashier/customer typography and column sizes.

- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`
  - Owns the bottom cart summary / due bar.
  - Add `displayMode` prop.
  - Preserve cashier sizing and add a larger customer summary bar.
  - Replace dynamic `col-span-${colSpan}` generation with explicit class mapping.

- Modify: `retail_pos_app/src/renderer/src/components/CustomerScreen.tsx`
  - Owns customer-display route composition.
  - Stop importing the cashier `LINE_PAGE_SIZE`.
  - Add `CUSTOMER_LINE_PAGE_SIZE = 7`.
  - Use latest-line customer offset rather than broadcast cashier offset.
  - Pass customer display variants into shared components.

No server, Electron main/preload, IPC, payment, sale math, or idle/post-screen files should change.

---

### Task 1: Add Customer Variant To `LineViewer`

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/LineViewer.tsx`

- [ ] **Step 1: Add display-mode types and explicit class maps**

At the top of `LineViewer.tsx`, after the format helpers, add these types and class maps:

```tsx
type LineViewerDisplayMode = "cashier" | "customer";

type LineViewerClassSet = {
  header: string;
  noColumn: string;
  unitPriceColumn: string;
  qtyColumn: string;
  totalColumn: string;
  discountColumn: string;
  lineRoot: string;
  itemCell: string;
  noText: string;
  nameKo: string;
  nameEn: string;
  weightText: string;
  moneyText: string;
  originalPriceText: string;
  qtyText: string;
  totalText: string;
  discountText: string;
};

const LINE_VIEWER_CLASSES: Record<LineViewerDisplayMode, LineViewerClassSet> = {
  cashier: {
    header:
      "text-sm bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center",
    noColumn: "w-8",
    unitPriceColumn: "w-20",
    qtyColumn: "w-20",
    totalColumn: "w-20",
    discountColumn: "w-14",
    lineRoot: "flex h-full divide-x divide-gray-200",
    itemCell: "flex-1 p-1 flex flex-col justify-center min-w-0",
    noText: "w-8 flex items-center justify-center text-xs",
    nameKo: "line-clamp-1 text-xs font-medium",
    nameEn: "line-clamp-1 text-gray-500 text-xs",
    weightText: "text-xs text-gray-400",
    moneyText: "text-sm font-medium",
    originalPriceText: "text-red-500 text-sm line-through",
    qtyText: "text-sm font-medium",
    totalText: "text-sm font-medium",
    discountText: "text-sm font-medium",
  },
  customer: {
    header:
      "text-base bg-gray-100 border-b border-b-gray-200 h-10 divide-x divide-gray-200 flex font-semibold *:flex *:justify-center *:items-center",
    noColumn: "w-12",
    unitPriceColumn: "w-28",
    qtyColumn: "w-28",
    totalColumn: "w-32",
    discountColumn: "w-16",
    lineRoot: "flex h-full divide-x divide-gray-200",
    itemCell: "flex-1 px-3 py-2 flex flex-col justify-center min-w-0",
    noText: "w-12 flex items-center justify-center text-lg font-semibold",
    nameKo: "line-clamp-1 text-xl font-semibold leading-tight",
    nameEn: "line-clamp-1 text-gray-500 text-base leading-tight",
    weightText: "text-sm text-gray-400 leading-tight",
    moneyText: "text-xl font-semibold",
    originalPriceText: "text-red-500 text-base line-through",
    qtyText: "text-xl font-semibold",
    totalText: "text-xl font-semibold",
    discountText: "text-lg font-semibold",
  },
};
```

- [ ] **Step 2: Update `LineViewer` props and page-size slicing**

Replace the current `LineViewer` function signature and `visibleLines` memo with:

```tsx
export default function LineViewer({
  lines,
  lineOffset,
  selectedLineKey,
  setSelectedLineKey,
  displayMode = "cashier",
  pageSize = LINE_PAGE_SIZE,
}: {
  lines: SaleLineType[];
  lineOffset: number;
  selectedLineKey: string | null;
  setSelectedLineKey: (lineKey: string | null) => void;
  displayMode?: LineViewerDisplayMode;
  pageSize?: number;
}) {
  const classes = LINE_VIEWER_CLASSES[displayMode];
  const visibleLines = useMemo(
    () => lines.slice(lineOffset, lineOffset + pageSize),
    [lines, lineOffset, pageSize],
  );
```

- [ ] **Step 3: Update the header and grid row count**

Inside `LineViewer`, replace the existing `return` block with:

```tsx
  return (
    <div className="w-full h-full flex flex-col">
      <div className={classes.header}>
        <div className={classes.noColumn}>No.</div>
        <div className="flex-1 min-w-0">Item</div>
        <div className={classes.unitPriceColumn}>U. Price</div>
        <div className={classes.qtyColumn}>Qty</div>
        <div className={classes.totalColumn}>Total</div>
        <div className={classes.discountColumn}>DC</div>
      </div>
      <div
        className="flex-1 h-full overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${pageSize}, 1fr)`,
        }}
      >
        {Array.from({ length: pageSize }).map((_, index) => {
          const line = visibleLines[index];
          const isSelected = line && selectedLineKey === line.lineKey;
          return (
            <div key={index} className="min-h-0">
              {line && (
                <LineCaption
                  line={line}
                  isSelected={isSelected}
                  classes={classes}
                  onClick={() =>
                    setSelectedLineKey(isSelected ? null : line.lineKey)
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass class set into `LineCaption`**

Replace the `LineCaption` function signature with:

```tsx
function LineCaption({
  line,
  isSelected,
  classes,
  onClick,
}: {
  line: SaleLineType;
  onClick: () => void;
  isSelected: boolean;
  classes: LineViewerClassSet;
}) {
```

- [ ] **Step 5: Apply variant classes inside `LineCaption`**

In `LineCaption`, replace the JSX returned at the end of the function with:

```tsx
  return (
    <div
      onClick={onClick}
      className={cn(classes.lineRoot, isSelected && "bg-blue-50")}
    >
      <div className={classes.noText}>{index + 1}</div>

      <div className={classes.itemCell}>
        <div className={classes.nameKo}>{name_ko}</div>
        <div className={classes.nameEn}>{name_en}</div>
        {measured_weight != null && measured_weight > 0 && (
          <div className={classes.weightText}>
            {fmtQty(measured_weight)}kg x{" "}
            {fmtMoney(line.unit_price_discounted ?? unit_price_original)}/kg
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1",
          classes.unitPriceColumn,
        )}
      >
        <div className={classes.moneyText}>
          {unit_price_adjusted && <span className="text-red-500">*</span>}
          {fmtMoney(displayPrice)}
        </div>
        {priceNotMatched && (
          <div className={classes.originalPriceText}>
            {fmtMoney(unit_price_original)}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1",
          classes.qtyColumn,
        )}
      >
        <div className={classes.qtyText}>{fmtQty(displayQty)}</div>
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1",
          classes.totalColumn,
        )}
      >
        <div className={classes.totalText}>
          {taxable && <span className="text-red-500">*</span>}
          {fmtMoney(total)}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col items-end justify-center p-1",
          classes.discountColumn,
        )}
      >
        <div className={classes.discountText}>
          {discountText && <span className="text-red-500">{discountText}</span>}
        </div>
      </div>
    </div>
  );
```

The `x` is intentionally ASCII to keep file encoding simple.

- [ ] **Step 6: Run app build to catch TypeScript or Tailwind class mistakes**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build succeeds. If it fails, fix only issues introduced in `LineViewer.tsx`.

- [ ] **Step 7: Commit task 1**

Run:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/LineViewer.tsx
git commit -m "feat: add customer line viewer density"
```

Expected: commit succeeds with only `LineViewer.tsx` staged.

---

### Task 2: Add Customer Variant To `DocumentMonitor`

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`

- [ ] **Step 1: Add display-mode types and class maps**

Replace the React import:

```tsx
import { useMemo } from "react";
```

with:

```tsx
import { type CSSProperties, useMemo } from "react";
```

After `fmtMoney`, add:

```tsx
type DocumentMonitorDisplayMode = "cashier" | "customer";

type DocumentMonitorClassSet = {
  root: string;
  itemLabel: string;
  itemLabelStyle?: CSSProperties;
  itemValue: string;
  dueRoot: string;
  dueLabel: string;
  dueValue: string;
};

const DOCUMENT_MONITOR_CLASSES: Record<
  DocumentMonitorDisplayMode,
  DocumentMonitorClassSet
> = {
  cashier: {
    root: "grid grid-cols-12 grid-rows-1 bg-zinc-900 h-full px-4 py-2 gap-x-2",
    itemLabel: "text-gray-400 font-medium",
    itemLabelStyle: { fontSize: 10 },
    itemValue: "text-white font-semibold text-base",
    dueRoot: "col-span-5 row-span-2 flex items-center justify-between gap-4",
    dueLabel: "text-base text-white font-medium",
    dueValue: "text-green-400 text-2xl font-bold",
  },
  customer: {
    root: "grid grid-cols-12 bg-zinc-900 h-full px-6 py-4 gap-x-5",
    itemLabel: "text-gray-400 font-semibold text-sm",
    itemLabelStyle: undefined,
    itemValue: "text-white font-bold text-2xl leading-tight",
    dueRoot: "col-span-5 flex items-center justify-between gap-5",
    dueLabel: "text-2xl text-white font-semibold",
    dueValue: "text-green-400 text-5xl font-bold leading-none",
  },
};

const MONITOR_COL_SPAN_CLASS: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
};
```

- [ ] **Step 2: Add `displayMode` prop to `DocumentMonitor`**

Replace:

```tsx
export default function DocumentMonitor({}: {}) {
```

with:

```tsx
export default function DocumentMonitor({
  displayMode = "cashier",
}: {
  displayMode?: DocumentMonitorDisplayMode;
}) {
  const classes = DOCUMENT_MONITOR_CLASSES[displayMode];
```

- [ ] **Step 3: Apply variant classes in the monitor JSX**

Replace the monitor `return` block with:

```tsx
  return (
    <div className={classes.root}>
      <DocumentMonitorItem
        label="ITEMS"
        value={itemCount.toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="LINES"
        value={lineCount.toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="QTY"
        value={Math.round(qtyCount).toString()}
        classes={classes}
      />
      <DocumentMonitorItem
        label="NET"
        value={fmtMoney(net)}
        colSpan={2}
        classes={classes}
      />
      <DocumentMonitorItem
        label="TAX"
        value={fmtMoney(tax_amount)}
        colSpan={2}
        classes={classes}
      />

      <div className={classes.dueRoot}>
        <div className={classes.dueLabel}>DUE</div>
        <div className={classes.dueValue}>${fmtMoney(due)}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `DocumentMonitorItem` to use explicit classes**

Replace the `DocumentMonitorItem` signature and return block with:

```tsx
function DocumentMonitorItem({
  label,
  value,
  classes,
  colSpan = 1,
}: {
  label: string;
  value: string;
  classes: DocumentMonitorClassSet;
  colSpan?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center min-w-0",
        MONITOR_COL_SPAN_CLASS[colSpan],
      )}
    >
      <div style={classes.itemLabelStyle} className={classes.itemLabel}>
        {label}
      </div>
      <div className={classes.itemValue}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 5: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build succeeds. If it fails, fix only issues introduced in `DocumentMonitor.tsx`.

- [ ] **Step 6: Commit task 2**

Run:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx
git commit -m "feat: add customer document monitor density"
```

Expected: commit succeeds with only `DocumentMonitor.tsx` staged.

---

### Task 3: Wire Customer Display To Customer Density

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/CustomerScreen.tsx`

- [ ] **Step 1: Remove unused cashier page-size imports and constants**

Replace:

```tsx
import { useSalesStore, LINE_PAGE_SIZE } from "../store/SalesStore";
```

with:

```tsx
import { useSalesStore } from "../store/SalesStore";
```

Remove this unused import:

```tsx
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";
```

Add below `REFRESH_INTERVAL_MS`:

```tsx
const CUSTOMER_LINE_PAGE_SIZE = 7;
```

- [ ] **Step 2: Stop reading cashier `lineOffset` from the customer store selector**

Replace:

```tsx
  const { carts, activeCartIndex, lineOffset } = useSalesStore();
```

with:

```tsx
  const { carts, activeCartIndex } = useSalesStore();
```

- [ ] **Step 3: Derive the customer line offset**

Replace:

```tsx
  const maxOffset = Math.max(0, lines.length - LINE_PAGE_SIZE);
```

with:

```tsx
  const customerLineOffset = Math.max(
    0,
    lines.length - CUSTOMER_LINE_PAGE_SIZE,
  );
```

- [ ] **Step 4: Pass customer display props to shared components**

Replace the active-cart return block with:

```tsx
  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-white">
          <LineViewer
            lines={lines}
            lineOffset={customerLineOffset}
            selectedLineKey={null}
            setSelectedLineKey={() => {}}
            displayMode="customer"
            pageSize={CUSTOMER_LINE_PAGE_SIZE}
          />
        </div>
      </div>
      <div className="h-[116px] shrink-0">
        <DocumentMonitor displayMode="customer" />
      </div>
    </div>
  );
```

- [ ] **Step 5: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit task 3**

Run:

```bash
git add retail_pos_app/src/renderer/src/components/CustomerScreen.tsx
git commit -m "feat: use readable customer display density"
```

Expected: commit succeeds with only `CustomerScreen.tsx` staged.

---

### Task 4: Final Verification And Manual QA

**Files:**
- Verify: `retail_pos_app/src/renderer/src/components/CustomerScreen.tsx`
- Verify: `retail_pos_app/src/renderer/src/screens/SaleScreen/LineViewer.tsx`
- Verify: `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`

- [ ] **Step 1: Run production build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Start the app for manual visual QA**

Run:

```bash
cd retail_pos_app
npm run dev
```

Expected: Electron/Vite dev server starts. Keep this process running while checking the UI.

- [ ] **Step 3: Check cashier sale screen still uses standard density**

Open the cashier sale screen and confirm:

- Line table still shows 10 rows.
- Header height and row text look like the pre-change cashier screen.
- Bottom document monitor is still `h-24` through the existing sale-screen layout and has the same compact sizing.

- [ ] **Step 4: Check customer display active cart at 1366x768**

Open `#/customer-display` in the customer window or browser and set the viewport/window to 1366x768.

Confirm:

- With 0 lines, idle/post screen is unchanged.
- With 1-7 lines, all active lines are visible.
- With 8+ lines, the newest 7 lines are visible.
- Item name, price, qty, line total, and discount columns do not overlap.
- Due amount is visually dominant and easy to read.
- Korean and English item names remain visible unless a long name is clipped by the existing one-line clamp.

- [ ] **Step 5: Stop dev server**

Stop the running `npm run dev` process with `Ctrl+C`.

- [ ] **Step 6: Review final git state**

Run:

```bash
git status --short
git log --oneline -4
```

Expected:

- `git status --short` is clean.
- Recent commits include:
  - `feat: add customer line viewer density`
  - `feat: add customer document monitor density`
  - `feat: use readable customer display density`

If manual QA required a small follow-up adjustment, commit that adjustment with:

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/LineViewer.tsx retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx retail_pos_app/src/renderer/src/components/CustomerScreen.tsx
git commit -m "fix: tune customer display readability"
```
