# Pickup Order Client Design

Date: 2026-07-07

## Goal

Build the Electron client slice for cached pickup orders in the retail POS app.

The cashier or manager should be able to search synced pickup orders, filter
them, open a read-only viewer modal, and inspect each order line as a future
100x100mm work-order label preview.

This slice does not implement order notifications, badges, toast messages,
sound, status mutation, print actions, print history, or Socket.IO refresh
behavior.

## User Context

Pickup orders are created in Dream Market through the customer app flow:

1. Customer opens `/catalog/order/[id]`.
2. Customer selects item quantity.
3. Customer selects option groups. Groups can be `SINGLE`, `MULTIPLE`, or
   `QUANTITY`, with required/min/max rules.
4. Customer selects a pickup slot.
5. Customer enters an optional store note, up to 500 characters.
6. Customer reviews and submits the order.

The CRM server snapshots each line with item fields, selected options, quantity,
note, and price totals. The POS client should treat this snapshot as the order
source for display. It should not recalculate pickup order totals.

The current CRM MVP accepts exactly one line per pickup order, but the POS UI
must be designed for future multi-line orders. If `lines.length === 1`, the
viewer selects `lines[0]` automatically. If there are multiple lines later, the
left column becomes a line selector and the right column updates to the selected
line.

## Scope

In scope:

- `retail_pos_app` route and screen for pickup order search.
- Renderer service/types for POS local pickup order APIs.
- Server API adjustment needed by the client, especially `memberId` list filter.
- Search filters: keyword, pickup date range, status, member.
- Read-only viewer modal.
- Two-column viewer layout.
- Selected-line detail presented as a 100x100mm work-order label preview.
- Compact handling for many selected options, especially sashimi platter style
  prep options.

Out of scope:

- New-order socket handling.
- Badge, toast, sound, or notification UX.
- Automatic polling in the renderer.
- Status action buttons.
- Label print button or ZPL generation.
- Print history.
- Offline mutation outbox.

## Route

Add:

```text
/manager/pickup-orders
```

The route should use the existing `ManagerLayout`, so entering it requires code
login through `UserProvider` and `AuthGateway`.

Add one home navigation tile under the Sales section:

```text
Pickup Orders
```

This is a search/read-only operational screen, similar to Invoice Search. It
does not require an open shift.

## Permission

Use the existing `sale` scope for pickup order read access in this slice.

Reasons:

- Pickup order visibility is sale-operation related.
- The existing scope set has no dedicated `pickup-order` scope.
- Adding a new scope would require user management and migration decisions that
  are larger than this UI slice.

Client screens should follow existing patterns:

- The route is under `ManagerLayout`.
- The screen checks `hasScope(user.scope, ["sale"])`.
- Unauthorized users see `BlockScreen`.

Server routes should also be protected with:

```ts
userMiddleware
scopeMiddleware("sale")
```

This should be applied to pickup order list, detail, and the existing manual
sync route under `/api/pickup-order/sync`.

## Local API Contract

The POS local server already has these routes:

```text
GET /api/pickup-order
GET /api/pickup-order/:id
POST /api/pickup-order/sync
```

For this client slice, list search needs this query shape:

```ts
type PickupOrderListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  from?: string;     // ISO datetime
  to?: string;       // ISO datetime
  status?: PickupOrderStatus;
  memberId?: string;
};
```

Add `memberId` filtering to `GET /api/pickup-order`. The filter should match
`PickupOrderCache.memberId`.

List response should be normalized for the existing renderer API patterns:

```ts
{
  ok: true;
  msg: "Pickup orders loaded";
  result: PickupOrderListItem[];
  paging: {
    hasPrev: boolean;
    hasNext: boolean;
    currentPage: number;
    totalPages: number;
  };
}
```

If the server keeps returning `result: { items }`, the renderer service may
unwrap it. Prefer changing the server response to match existing list APIs so
future list components can be reused without adapters.

Detail response:

```ts
{
  ok: true;
  msg: "Pickup order loaded";
  result: PickupOrderDetail;
  paging: null;
}
```

`GET /api/pickup-order/:id` uses CRM order id (`crmOrderId`) as the path id.
The renderer should name this clearly as `crmOrderId` to avoid confusing it with
the local cache row id.

## Data Shape

Renderer types should mirror the cached server data:

```ts
type PickupOrderStatus =
  | "PENDING"
  | "ORDER_CONFIRMED"
  | "READY"
  | "COMPLETED"
  | "CANCELLED_BY_STORE"
  | "CANCELLED_BY_CUSTOMER";

type PickupOrderSelectedOption = {
  key: string;
  name_en: string;
  name_ko: string;
  qty: number;        // QTY_SCALE
  priceDelta: number; // cents
};

type PickupOrderSelectedOptionGroup = {
  optionGroupId: number;
  key: string;
  name_en: string;
  name_ko: string;
  type: "SINGLE" | "MULTIPLE" | "QUANTITY";
  selectedOptions: PickupOrderSelectedOption[];
};

type PickupOrderLine = {
  crmLineId: number;
  index: number;
  itemId: number;
  name_en: string;
  name_ko: string;
  barcode: string;
  code: string | null;
  uom: string;
  prices: number[];
  promoPrices: unknown;
  memberLevel: number;
  optionTotal: number;
  qty: number;
  total: number;
  note: string | null;
  selectedOptionsSnapshot: PickupOrderSelectedOptionGroup[];
};

type PickupOrderListItem = {
  crmOrderId: number;
  documentId: string;
  status: PickupOrderStatus;
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  crmCreatedAt: string;
  crmUpdatedAt: string;
  syncedAt: string;
  lines: PickupOrderLine[]; // list may include first line only
};

type PickupOrderDetail = PickupOrderListItem & {
  lines: PickupOrderLine[];
};
```

If Prisma JSON values arrive as `unknown`, the renderer should normalize
`selectedOptionsSnapshot` defensively into an empty array when the shape is not
valid. Do not use `as any`.

## Search Screen

Create a screen with the same mental model as `SaleInvoiceSearchScreen` and
`SaleInvoiceSearchPanel`.

Filters:

- Keyword text input:
  - `documentId`
  - member name
  - line Korean/English names
  - barcode
  - code
- Date range selector:
  - filters by `pickupStartsAt`, not created date.
- Member selector:
  - reuse `MemberSearchModal`.
  - selected member sets `memberId`.
  - selected chip can be cleared.
- Status segmented control:
  - `ALL`
  - `PENDING`
  - `ORDER_CONFIRMED`
  - `READY`
  - `COMPLETED`
  - cancelled statuses can be included but visually de-emphasized.

Actions:

- `Search`
- `Reset`

No automatic polling. No socket listener.

Manual sync is not part of the first UI. The existing server endpoint can remain
available for operational/testing use, but the client screen should not show a
`Sync` button in this slice.

List row fields:

- Document id.
- Pickup date/time.
- Status badge.
- Member name and phone last4.
- First line name.
- Line count.
- Total.
- Small visual cues for note/options on the first line.

Row click opens the viewer modal. Preserve list filters and pagination behind
the modal.

## Viewer Modal

The viewer modal is read-only.

Use a two-column layout:

- Left column:
  - order summary,
  - line selector.
- Main/right area:
  - selected line detail as a 100x100mm work-order label preview,
  - compact helper metadata for the selected line.

Behavior:

- On open, select `order.lines[0]`.
- If there is one line, hide unnecessary line-navigation noise but still show
  the line summary.
- If there are multiple lines, clicking a line updates the preview.
- If a line has `note`, show a strong `NOTE` cue in the line row.
- If a line has selected options, show an `OPTIONS` cue with the number of
  selected option rows or groups.

## Work-Order Label Preview

The detail preview should assume a future 100x100mm ZPL label.

The first implementation is only an HTML/CSS preview in the modal. It should
not generate ZPL or print. The visual hierarchy should still be close enough
that future ZPL work can copy the information architecture.

The label should look like a work instruction sheet, not a product price label.

Primary content:

- `PICKUP WORK ORDER`
- Pickup time.
- Document id.
- Line index and status.
- Customer name and phone last4.
- Item Korean name.
- Item English name or short code.
- Quantity and UOM.
- Compact selected options grouped by option group.
- Customer note, visually prominent.
- Prep checkboxes.
- QR/DataMatrix placeholder for future `pickup-order-line` scan payload.

For sashimi platter style lines, selected options can be numerous. The preview
should use compact groups, for example:

```text
BUILD
Salmon x8
Tuna x6
Kingfish x6
Scallop x4

PACK / SAUCE
Soy x4
Wasabi none
Ginger extra
Tray black round
```

Option rendering rules:

- Use Korean labels first when available.
- Include English labels when helpful and space allows.
- Prefer compact quantities.
- Show positive price deltas only when operationally useful; this label is for
  prep, not customer pricing.
- If options overflow the 100x100 preview, keep all options available in the
  side metadata panel and show the densest safe preview possible.

Customer note rules:

- Notes are operationally important and must stay prominent.
- Use a strong bordered block.
- If too long, show a clipped preview on the label and the full note in the side
  metadata panel.

Prep checkbox candidates:

```text
□ Built
□ Checked
□ Sauces
□ Cold pack
□ Member
□ Handoff
```

These are visual preview elements only in this slice. They do not persist state.

## Formatting Rules

- Money is cents; display via existing money formatting conventions.
- Quantity is `QTY_SCALE = 1000`; display `1000` as `1`, with UOM.
- Dates should use renderer `dayjsAU` conventions.
- Use Korean and English names where available.
- Keep renderer pure web: no Electron or Node imports.

## Components

Suggested files:

```text
retail_pos_app/src/renderer/src/service/pickup-order.service.ts
retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx
retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-types.ts
```

Keep `PickupOrderWorkLabelPreview` separate from the modal so future label
printing work can reuse its mapping logic when ZPL generation is added.

## Error And Empty States

Search screen:

- Initial load fetches page 1.
- Empty list shows `No pickup orders`.
- API failure shows an inline message and keeps the screen usable.

Viewer modal:

- Opening shows loading while detail fetches.
- Missing order shows a compact error state with close action.
- Invalid `selectedOptionsSnapshot` should not crash the viewer; show no options
  and log a defensive console error if useful.

## Verification

When implemented, verify with:

```bash
cd retail_pos_app
npm run build
```

If server API changes are made:

```bash
cd retail_pos_server
npm run build
```

Manual QA checklist:

- Search by keyword.
- Search by member.
- Filter by pickup date.
- Filter by status.
- Open an order with one line and confirm the first line is selected.
- Open a mocked or seeded multi-line order and switch selected lines.
- Confirm many options remain readable in the work-order preview.
- Confirm long customer notes are prominent and do not break layout.
- Confirm unauthorized non-sale user is blocked.

## Deferred Decisions

- Actual ZPL generation and printer DPI handling are future label-printing slice
  work. The client preview assumes the target layout is 100x100mm.
- The first option compaction strategy is grouped rows by option group, with the
  full option list available in the side metadata panel when the label preview
  must clip.
