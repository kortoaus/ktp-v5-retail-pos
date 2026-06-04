# Customer Display Readable Cart Design

## Goal

Make the non-idle customer display readable on a 12-inch 1366x768 screen without changing the post/idle waiting screen. The customer should be able to confirm item names, quantity, price, and the due amount at a glance from the opposite side of the counter.

## Scope

In scope:

- Active customer cart screen at `#/customer-display` when the cart has lines.
- Shared cart line list component sizing for a customer-display variant.
- Shared document monitor sizing for a customer-display variant.
- Customer-specific visible row count and line offset calculation.

Out of scope:

- `CustomerIdleScreen`, cloud post rotation, store information idle view.
- Cashier sale-screen layout.
- Payment math, sale payloads, discounts, tax, rounding, or invoice behavior.
- Electron main/preload changes or new IPC.

## Recommended Approach

Keep `LineViewer` and `DocumentMonitor` shared, but give each component an explicit display variant instead of duplicating the layout in `CustomerScreen`.

Use:

```ts
displayMode?: "cashier" | "customer"
```

The default should be `"cashier"` so existing cashier screens do not need broad edits. `CustomerScreen` passes `"customer"`.

This is clearer than a generic `side` prop because the change is not about physical side of the counter only; it is a display-density contract.

## Customer Layout Targets

For a 12-inch 1366x768 screen:

- Show 7 cart rows instead of 10.
- Header text around 16px.
- Primary item names around 18-20px.
- Secondary item name / weight helper text around 14-16px.
- Price, quantity, and line total around 20-22px.
- Bottom monitor height around 110-120px.
- Due amount around 40-44px.

This is the approved B+ direction: balanced readable rows with a due bar closer to the maximum-readability mockup.

## Component Changes

### `LineViewer`

Add optional props:

```ts
displayMode?: "cashier" | "customer";
pageSize?: number;
```

Behavior:

- Default `displayMode` to `"cashier"`.
- Default `pageSize` to existing `LINE_PAGE_SIZE`.
- Slice visible lines by the provided `pageSize`.
- Use display-mode-specific Tailwind classes for row/header/font/column sizing.
- Keep the existing selected-line behavior for cashier use.
- For customer mode, `selectedLineKey` remains nullable and no interactive selection is expected.

Customer mode should keep both Korean and English item names visible where possible. Long names should continue to clamp/truncate rather than resizing the layout.

### `DocumentMonitor`

Add optional prop:

```ts
displayMode?: "cashier" | "customer";
```

Behavior:

- Default to `"cashier"`.
- Preserve the current cashier grid and sizing.
- In customer mode, use a taller, more readable monitor bar.
- Emphasize `DUE` and the due amount.
- Keep useful summary values such as items, lines/qty, net, and tax when they fit cleanly.

No calculation changes are needed; the component already derives totals from `useSalesStore`.

### `CustomerScreen`

Add:

```ts
const CUSTOMER_LINE_PAGE_SIZE = 7;
```

Behavior:

- Keep idle/post behavior unchanged when `lines.length === 0`.
- Render `LineViewer` with `displayMode="customer"` and `pageSize={CUSTOMER_LINE_PAGE_SIZE}`.
- Render `DocumentMonitor` with `displayMode="customer"`.
- Do not reuse the cashier `lineOffset` directly for customer paging.
- Derive a customer offset that shows the latest 7 lines:

```ts
const customerLineOffset = Math.max(0, lines.length - CUSTOMER_LINE_PAGE_SIZE);
```

This avoids showing a strange middle slice when the cashier page size is 10 and the customer page size is 7.

## Data Flow

The existing `BroadcastChannel` flow stays the same:

- Main POS renderer broadcasts cart state on `pos-cart`.
- Customer display receives carts and active cart index.
- Customer display reads the active cart lines from `useSalesStore`.

Only presentation differs. No payload shape or channel name changes are required.

## Error Handling

No new error-handling path is required.

If broadcast data is missing or the active cart has no lines, the current idle behavior remains the fallback. If line names or amounts are long, the customer variant should use truncation/clamping and fixed column widths so the display does not overlap.

## Verification

Run:

```bash
cd retail_pos_app
npm run build
```

Manual QA:

- Open or simulate `#/customer-display` with cart lines.
- Confirm idle/post screen is unchanged with zero lines.
- Confirm 1-7 lines are readable on 1366x768.
- Confirm 8+ lines show the newest 7 lines.
- Confirm cashier `LineViewer` and `DocumentMonitor` still match the current sale screen.
- Confirm long Korean and English item names do not overlap price/qty/total columns.

## Risks

- Tailwind dynamic class names can be missed by compilation if built with template strings. Use explicit class maps rather than generated class strings for display variants.
- Reducing customer rows to 7 means the customer display does not mirror the exact cashier page slice. This is intentional; the customer screen optimizes for readability and should show the latest scanned items.
