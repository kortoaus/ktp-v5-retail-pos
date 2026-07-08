# Pickup Order Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the pickup order detail modal into the approved 1366 x 768 touchscreen layout with an inline order strip, fixed label preview, fixed status action bar, scrollable lines, and option/note-only line instructions.

**Architecture:** This is a renderer-only refactor of `PickupOrderViewer.tsx`. Keep the existing data loading, status update, phone reveal, and label canvas behavior, but replace the modal layout and supporting presentational components. Use CSS grid and Tailwind utility classes already used in the file; do not add a new styling library.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, existing pickup order service hooks and formatter helpers, existing `PickupOrderWorkLabelPreview` canvas component.

---

## File Structure

- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Keep the existing state, effects, service calls, status update flow, phone reveal flow, and selected-line flow.
  - Replace the current two-column modal body with a fixed header/body/footer grid.
  - Add `OrderInfoStrip`, `PhoneToggleField`, `LinesPanel`, `LineInstructions`, and `StatusActionBar` presentational components.
  - Remove the old repeated `LineDetail` component from the rendered flow.
- Keep `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx` unchanged.
- No server, Electron main, preload, IPC, or API changes.

## Implementation Notes

- Production viewport target is 1366 x 768.
- The outer modal must not scroll as one page under normal production conditions.
- Use `onPointerDown` consistently with the existing component.
- Keep status confirmation dialogs and sync behavior unchanged.
- Use English-only visible copy.
- Use ASCII masking for phone: `**** 0783`.
- Phone reveal replaces the value inside one field; it does not render a separate full-phone row.
- The order strip must support both one-row and two-row layout without overlapping the Lines, Label Preview, or Line Instructions areas.

### Task 1: Replace The Modal Shell With Fixed Header, Body, Footer

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Locate the current order-render branch**

Find the block that starts with:

```tsx
{order && !loading && !error && (
  <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,390px)_minmax(0,1fr)] overflow-hidden">
```

- [ ] **Step 2: Replace the order-render branch**

Replace that block with this layout. Keep the surrounding loading and error branches unchanged.

```tsx
{order && !loading && !error && (
  <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_78px] overflow-hidden">
    <section className="grid min-h-0 grid-cols-[360px_480px_minmax(300px,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-gray-50">
      <OrderInfoStrip
        order={order}
        revealedPhone={revealedPhone}
        phoneLoading={phoneLoading}
        phoneError={phoneError}
        onRevealPhone={revealPhone}
        onHidePhone={hidePhone}
      />

      <LinesPanel
        lines={order.lines}
        selectedCrmLineId={selectedLine?.crmLineId ?? null}
        onSelect={setSelectedCrmLineId}
      />

      <section className="col-start-2 row-start-2 flex min-h-0 flex-col items-center justify-center gap-3 overflow-hidden border-r border-gray-200 bg-gray-50 p-4">
        {selectedLine ? (
          <PickupOrderWorkLabelPreview order={order} line={selectedLine} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
            No pickup order lines
          </div>
        )}
      </section>

      <LineInstructions line={selectedLine} />
    </section>

    <StatusActionBar
      documentId={order.documentId}
      currentStatus={order.status}
      loading={statusActionLoading}
      error={statusActionError}
      onChangeStatus={changeStatus}
    />
  </div>
)}
```

- [ ] **Step 3: Run TypeScript build to capture expected missing components**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: FAIL with TypeScript errors for undefined `OrderInfoStrip`, `LinesPanel`, `LineInstructions`, and `StatusActionBar`.

### Task 2: Add The Inline Order Information Strip

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add `OrderInfoStrip` and `PhoneToggleField` below `OrderSummary` or replace `OrderSummary` entirely**

Add this code near the old summary helpers. This can replace `OrderSummary` because the new layout no longer calls it.

```tsx
function OrderInfoStrip({
  order,
  revealedPhone,
  phoneLoading,
  phoneError,
  onRevealPhone,
  onHidePhone,
}: {
  order: PickupOrderDetail;
  revealedPhone: string;
  phoneLoading: boolean;
  phoneError: string;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  return (
    <section className="col-span-2 row-start-1 grid auto-rows-[72px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 border-b border-r border-gray-200 bg-white p-3">
      <OrderStripField label="Pickup" value={formatPickupTime(order.pickupStartsAt)} />
      <OrderStripField label="Created" value={formatPickupTime(order.crmCreatedAt)} />
      <OrderStripField label="Member" value={order.memberName || "-"} />
      <PhoneToggleField
        last4={order.memberPhoneLast4}
        revealedPhone={revealedPhone}
        phoneLoading={phoneLoading}
        phoneError={phoneError}
        onRevealPhone={onRevealPhone}
        onHidePhone={onHidePhone}
      />
      <OrderStripField label="Subtotal" value={formatPickupMoney(order.linesTotal)} />
      <OrderStripField label="Total" value={formatPickupMoney(order.total)} />
    </section>
  );
}

function OrderStripField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="mt-1 truncate text-base font-black text-gray-900">
        {value}
      </div>
    </div>
  );
}

function PhoneToggleField({
  last4,
  revealedPhone,
  phoneLoading,
  phoneError,
  onRevealPhone,
  onHidePhone,
}: {
  last4: string | null;
  revealedPhone: string;
  phoneLoading: boolean;
  phoneError: string;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  const value = phoneLoading
    ? "Loading..."
    : revealedPhone || phoneError || (last4 ? `**** ${last4}` : "-");
  const action = revealedPhone ? onHidePhone : onRevealPhone;

  return (
    <button
      type="button"
      onPointerDown={action}
      disabled={phoneLoading}
      className={cn(
        "min-w-0 rounded-lg border-2 bg-white px-3 py-2 text-left",
        "disabled:cursor-not-allowed disabled:opacity-70",
        phoneError
          ? "border-red-200 text-red-600 active:bg-red-50"
          : "border-blue-200 text-blue-700 active:bg-blue-50",
      )}
    >
      <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
        Phone
      </div>
      <div className="mt-1 truncate font-mono text-base font-black">
        {value}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Remove old phone duplicate from active render path**

Confirm `PhoneRevealControl` is no longer referenced by JSX. Delete it during Task 6 cleanup.

- [ ] **Step 3: Run build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: FAIL only for components still not added in later tasks. The output does not mention `OrderInfoStrip`, `OrderStripField`, or `PhoneToggleField`.

### Task 3: Replace Line Selector With Scrollable Lines Panel

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add `LinesPanel`**

Add this code near the existing line row helpers. It can replace `LineSelector` and `LineSummaryRow`.

```tsx
function LinesPanel({
  lines,
  selectedCrmLineId,
  onSelect,
}: {
  lines: PickupOrderLine[];
  selectedCrmLineId: number | null;
  onSelect: (crmLineId: number) => void;
}) {
  return (
    <aside className="col-start-1 row-start-2 min-h-0 overflow-hidden border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-400">
        Lines
      </div>
      <div className="h-full min-h-0 overflow-y-auto p-3 pb-16">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
            No pickup order lines
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <button
                key={line.crmLineId}
                type="button"
                onPointerDown={() => onSelect(line.crmLineId)}
                className={cn(
                  "block min-h-24 w-full rounded-lg border-2 p-3 text-left active:bg-blue-50",
                  selectedCrmLineId === line.crmLineId
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white",
                )}
              >
                <LineRowContent line={line} />
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Keep `LineRowContent` and `Cue` but check visible copy**

Update cue labels to English-only and compact lowercase-insensitive text:

```tsx
{line.note && <Cue label="NOTE" className="bg-amber-100 text-amber-700" />}
{optionCount > 0 && (
  <Cue
    label={`${optionCount} OPTIONS`}
    className="bg-indigo-100 text-indigo-700"
  />
)}
```

- [ ] **Step 3: Run build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: FAIL only for components still not added in later tasks. The output does not mention `LinesPanel`.

### Task 4: Replace Repeated Line Detail With Option/Note Instructions

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add `LineInstructions`**

Replace the old `LineDetail` usage with this component. The component must not render product name, quantity, barcode, code, member level, line total, or a separate option total.

```tsx
function LineInstructions({ line }: { line: PickupOrderLine | null }) {
  return (
    <aside className="col-start-3 row-span-2 row-start-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
      <div className="border-b border-gray-200 px-4 py-4">
        <div className="text-xl font-black text-gray-900">
          Line instructions
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-500">
          Options and customer note
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-4">
        {line ? (
          <>
            <InstructionOptionGroups groups={line.selectedOptionsSnapshot} />
            <InstructionCustomerNote note={line.note} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
            No pickup order lines
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add instruction-specific options rendering**

Use a separate renderer so the old detail-oriented `OptionGroups` can be deleted later without affecting the new layout.

```tsx
function InstructionOptionGroups({
  groups,
}: {
  groups: PickupOrderSelectedOptionGroup[];
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-black uppercase tracking-wide text-gray-400">
        Selected options
      </div>
      {groups.length === 0 ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-medium text-gray-500">
          No selected options
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <InstructionOptionGroup key={group.optionGroupId} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

function InstructionOptionGroup({
  group,
}: {
  group: PickupOrderSelectedOptionGroup;
}) {
  const groupLabel = group.name_en || group.name_ko || group.key;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 break-words text-base font-black text-gray-900">
          {groupLabel}
        </div>
        <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[10px] font-black uppercase text-gray-500">
          {group.type}
        </span>
      </div>
      <div className="mt-2 divide-y divide-gray-100">
        {group.selectedOptions.map((option) => {
          const optionLabel = option.name_en || option.name_ko || option.key;
          return (
            <div
              key={option.key}
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 text-base font-bold"
            >
              <span className="min-w-0 break-words text-gray-900">
                {optionLabel}
              </span>
              <span className="font-mono text-gray-500">
                {formatPickupQty(option.qty, "")}
              </span>
              <span className="font-mono text-gray-700">
                {formatPickupMoney(option.priceDelta)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add instruction customer note**

```tsx
function InstructionCustomerNote({ note }: { note: string | null }) {
  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-black uppercase tracking-wide text-gray-400">
        Customer note
      </div>
      <div className="mt-3 min-h-24 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-base font-semibold text-gray-800">
        {note || "No customer note"}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: FAIL only for `StatusActionBar` if Task 5 has not been done. The output does not mention `LineInstructions` or instruction option components.

### Task 5: Move Status CTAs Into Fixed Bottom Action Bar

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add `StatusActionBar`**

Replace the old in-summary `StatusActions` render path with this footer component.

```tsx
function StatusActionBar({
  documentId,
  currentStatus,
  loading,
  error,
  onChangeStatus,
}: {
  documentId: string;
  currentStatus: PickupOrderStatus;
  loading: boolean;
  error: string;
  onChangeStatus: (status: PosPickupOrderStatus) => void;
}) {
  return (
    <footer className="grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(118px,150px))] items-center gap-2 border-t border-gray-200 bg-white px-4 py-2">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
          Set status for {documentId}
        </div>
        <div className="mt-1 truncate text-sm font-black text-gray-900">
          Current: {statusLabel(currentStatus)}
        </div>
        {error && (
          <div className="mt-1 truncate text-xs font-bold text-red-600">
            {error}
          </div>
        )}
      </div>

      {POS_PICKUP_ORDER_STATUS_TARGETS.map((status) => {
        const isCurrent = status === currentStatus;
        const isCancel = status === "CANCELLED_BY_STORE";
        return (
          <button
            key={status}
            type="button"
            onPointerDown={() => onChangeStatus(status)}
            disabled={loading || isCurrent}
            className={cn(
              "h-14 min-w-0 rounded-lg border-2 px-2 text-[12px] font-black uppercase leading-tight",
              "active:bg-blue-50 disabled:cursor-not-allowed",
              isCurrent
                ? "border-gray-300 bg-gray-50 text-gray-400"
                : isCancel
                  ? "border-red-200 bg-white text-red-600 active:bg-red-50"
                  : "border-blue-200 bg-white text-blue-700",
              loading && !isCurrent && "opacity-50",
            )}
          >
            {statusLabel(status)}
          </button>
        );
      })}
    </footer>
  );
}
```

- [ ] **Step 2: Confirm touch target size**

Check that the class `h-14` remains on status buttons. Tailwind `h-14` is 56 px.

- [ ] **Step 3: Run build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS, or unrelated pre-existing TypeScript/build errors. If it fails because old unused components reference missing names, complete Task 6 cleanup.

### Task 6: Delete Old Detail/Summary Components And Unused Helpers

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Remove components that are no longer referenced**

Delete these components if `rg` confirms they are not referenced in the file:

```text
OrderSummary
StatusActions
PhoneRevealControl
SummaryField
LineSelector
LineSummaryRow
LineDetail
DetailField
OptionGroups
OptionGroup
```

Keep these components because the new layout still uses them:

```text
LineRowContent
Cue
StatusBadge
statusClass
```

- [ ] **Step 2: Verify no removed component names remain**

Run:

```bash
rg -n "OrderSummary|StatusActions|PhoneRevealControl|SummaryField|LineSelector|LineSummaryRow|LineDetail|DetailField|OptionGroups|function OptionGroup" retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
```

Expected: no output.

- [ ] **Step 3: Verify no English-copy regressions**

Run:

```bash
rg -n "전체|상태|전화|옵션|고객|주문|상품|준비|완료|취소" retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
```

Expected: no output.

- [ ] **Step 4: Run build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS.

### Task 7: Manual 1366 x 768 Layout Verification

**Files:**
- Modify only if verification finds a layout bug: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Start the Electron app**

Run:

```bash
cd retail_pos_app && npm run dev
```

Expected: Electron dev app starts.

- [ ] **Step 2: Navigate to pickup orders**

In the app, navigate to:

```text
/manager/pickup-orders
```

Open a pickup order detail modal.

- [ ] **Step 3: Verify production viewport behavior**

At a 1366 x 768 app window, confirm:

```text
Header remains visible.
Order information strip remains visible.
Label preview remains visible.
Status action bar remains visible.
Whole modal does not scroll as one large page.
Lines list scrolls independently when enough lines exist.
Line instructions scroll independently when options or note content is long.
```

- [ ] **Step 4: Verify order strip two-row behavior**

Temporarily narrow the app window or use devtools responsive sizing so the order strip cannot fit six readable fields in one row.

Expected:

```text
Order fields wrap to two rows.
Fields keep stable height.
Pickup and Created values truncate with ellipsis.
No overlap occurs with Lines, Label Preview, or Line Instructions.
```

- [ ] **Step 5: Verify phone toggle**

Click the Phone field.

Expected:

```text
The same Phone field changes from masked last 4 to full phone.
No separate Show Full Phone row or button appears.
Loading and error states stay inside the same field.
```

- [ ] **Step 6: Stop the dev server**

Stop the dev command with `Ctrl-C`.

### Task 8: Final Verification And Commit

**Files:**
- Modify: only files touched by implementation.

- [ ] **Step 1: Run final build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff -- retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
```

Expected:

```text
Only pickup order detail UI/layout changes are present.
No service, API, Electron main, preload, or server changes are present.
```

- [ ] **Step 3: Commit**

Run:

```bash
git add retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
git commit -m "feat: redesign pickup order detail view"
```

Expected: commit succeeds.

## Self-Review Checklist

- Spec coverage: layout, fixed/scroll areas, two-row order strip, phone toggle,
  lines overflow, label preview, instruction-only right panel, fixed status CTA
  bar, English-only copy, and 1366 x 768 verification are each covered.
- Placeholder scan: all task steps include concrete files, code, commands, and
  expected outcomes.
- Type consistency: new component props use existing `PickupOrderDetail`,
  `PickupOrderLine`, `PickupOrderSelectedOptionGroup`, `PickupOrderStatus`, and
  `PosPickupOrderStatus` types already imported by `PickupOrderViewer.tsx`.
