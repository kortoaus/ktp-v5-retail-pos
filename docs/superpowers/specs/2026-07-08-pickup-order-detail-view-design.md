# Pickup Order Detail View Redesign

## Context

The current pickup order detail modal is visually noisy: order metadata,
status actions, label preview, line selection, item details, options, and notes
all compete for attention. The production POS target is a 1366 x 768
touchscreen, so the view must keep the important work areas stable and make
touch actions large enough for finger use.

The approved visual direction is based on
`.superpowers/brainstorm/pickup-order-detail/layout-a-v3.html`.

## Goals

- Make the label preview the main visual anchor.
- Show order metadata in an inline strip above the Lines and Label Preview
  columns.
- Keep status actions in a fixed bottom action bar.
- Keep the modal itself from scrolling as one large page.
- Support orders with one line or many lines without pushing fixed areas out of
  view.
- Use English-only visible UI copy in this view.
- Remove duplicated current-line information that is already visible in the
  label preview and line list.

## Layout

The modal keeps a fixed header and fixed footer:

- Header: document id, current status badge, close control.
- Footer: status action bar.

The body uses a three-column work grid:

```text
| Order information strip        | Line instructions |
| Lines           | Label preview    | Line instructions |
```

The order information strip spans the Lines and Label Preview columns. The
Line Instructions panel occupies the right column across both body rows.

Column behavior:

- Lines column: fixed width suitable for large line rows, roughly 340-380 px at
  the 1366 px production viewport.
- Label Preview column: fixed or minmax width that preserves the existing
  100 mm canvas preview scale, roughly 450-500 px at the production viewport.
- Line Instructions column: flexible remaining width.

## Fixed And Scroll Areas

Fixed areas:

- Modal header.
- Order information strip.
- Label preview area.
- Status action bar.

Scrollable areas:

- Lines list only, within the left Lines column.
- Line Instructions content only, within the right panel.

The modal container must not scroll as a single page under normal 1366 x 768
production conditions.

## Order Information Strip

The order strip displays:

- Pickup
- Created
- Member
- Phone
- Subtotal
- Total

It must support both one-row and two-row layouts:

- At wider available widths, all fields may fit in one row.
- If the available width is too narrow for readable fields, the strip wraps to
  two rows.
- The implementation may use CSS grid with `auto-fit` / `minmax(...)` or an
  explicit responsive class, but each field must keep a readable minimum width.
- A two-row strip must increase only the strip/body row height; it must not
  overlap Lines, Label Preview, or Line Instructions.
- Each field must have a stable minimum height and fixed internal spacing so the
  grid does not jump when phone state changes.
- Field values may truncate with ellipsis when long, especially Pickup and
  Created dates.

Phone is a single toggle-style field:

- Default state shows the masked last 4 digits, for example `**** 0783`.
- Revealed state replaces the value in the same field with the full phone
  number.
- Loading and error states also appear inside the same field.
- Do not render a separate `Show Full Phone` button next to another Phone
  field.

## Lines

The Lines column shows selectable line cards.

Line card content:

- Primary line name.
- Secondary line name or fallback identifier.
- Quantity and UOM.
- Compact cues for line index, selected option count, and customer note
  presence.

Behavior:

- When there is one line, it still renders as a selectable card for consistency.
- When there are multiple lines, only the Lines list scrolls.
- The selected line is visually prominent.
- Line row touch targets must be at least 56 px high; the approved mockup uses
  larger rows around 94 px.

## Label Preview

Keep the current canvas preview behavior and visual scale. The canvas is already
useful and must remain the central work surface.

The label preview must not scroll with the Lines list or Line Instructions
panel. Selecting a different line updates the label preview for that line.

## Line Instructions

Replace the current repeated line detail panel with an instruction-focused
panel.

Visible content:

- Selected options.
- Customer note.

Do not repeat:

- Product name.
- Quantity.
- Barcode.
- Code.
- Member level.
- Line total.
- Option total, unless it is needed inside the option rows already shown.

Rationale: the selected line card and label preview already identify the item.
The right panel must answer the operator's immediate preparation question:
what options or customer note must be followed?

If the selected line has no options, show a compact empty state. If it has no
note, show `No customer note`.

## Status Action Bar

Status CTAs live in a single fixed bottom action bar.

Requirements:

- Minimum touch target height: 56 px.
- Buttons are English-only.
- Current status context is visible in the bar.
- Current status action is disabled or visually inactive.
- Destructive cancel action remains visually distinct.
- Avoid placing status CTAs inside the order metadata, line list, label preview,
  or instructions panel.

## Copy

All visible labels and empty states in this modal must be English-only.

Approved labels include:

- `Pickup`
- `Created`
- `Member`
- `Phone`
- `Subtotal`
- `Total`
- `Lines`
- `Line instructions`
- `Selected options`
- `Customer note`
- `No selected options`
- `No customer note`

## Component Boundary

This is a renderer-only UI change. It primarily affects:

- `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

The existing label preview component remains responsible for canvas
rendering:

- `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`

No Electron main/preload IPC changes are expected.

## Verification

Verify at 1366 x 768:

- The modal fits without whole-modal scrolling.
- Header, order strip, label preview, and action bar remain visible.
- Lines scroll independently when there are more line cards than fit.
- Line Instructions scroll independently when options or notes are long.
- Order strip can render in both one-row and two-row configurations without
  overlap.
- Status CTAs are at least 56 px tall.
- Phone toggles in-place from last 4 to full phone.
- All visible modal copy is English-only.
- The label preview still renders the selected line correctly.

Run `cd retail_pos_app && npm run build` after implementation.
