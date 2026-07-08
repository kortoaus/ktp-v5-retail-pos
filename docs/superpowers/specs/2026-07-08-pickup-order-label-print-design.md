# Pickup Order Label Print Design

Date: 2026-07-08

## Goal

Add 100x100 label-printer support to Interface Settings and let operators print
the selected pickup-order work-label canvas from the pickup order detail view.

When a configured 100x100 printer exists, tapping the label preview asks for
confirmation. On confirmation, the POS prints one label per unit of the selected
line quantity.

## Context

Pickup orders already have a canvas-rendered 100x100mm work-label preview. The
preview builds a renderer-only model from `PickupOrderDetail` and
`PickupOrderLine`, draws an 800x800 canvas, and creates the PP-compatible QR
payload used by the POS item scan flow.

Existing label printer transport already supports:

- configured serial and network label printers,
- ZPL and SLCS languages,
- a `mediaSize` field for 70x30 and 70x90 selection,
- `LabelOutput` payloads sent through `window.electronAPI.printLabel`.

This slice should connect those existing pieces without adding new Electron IPC
channels, server APIs, print history, or pickup-order status mutation.

## Existing Documents

This design follows these earlier decisions:

- `docs/superpowers/specs/2026-07-07-pickup-order-client-design.md`
  introduced the pickup detail work-label preview and deferred printing.
- `docs/superpowers/specs/2026-07-07-pickup-label-preview-canvas-design.md`
  moved the preview to canvas and stated that future printing should use the
  same visual source.
- `docs/superpowers/specs/2026-07-08-pickup-order-detail-view-design.md`
  keeps the canvas preview as the central work surface in the detail modal.
- `docs/superpowers/plans/2026-05-06-70x90-price-tag-v2.md` established the
  canvas-to-monochrome-raster-to-ZPL/SLCS pattern for graphic labels.

`docs/superpowers/specs/2026-07-07-pickup-order-sync-design.md` previously said
quantity would not multiply labels in a future default flow. This design
supersedes that default for the pickup detail preview action: the explicit
operator action prints `line.qty` labels.

## Scope

In scope:

- Add `100x100` as a label printer media-size option for serial and network
  label printers.
- Expose configured 100x100 label printers through the existing renderer printer
  hook.
- Add a pickup work-label print builder that renders the existing pickup label
  model into an offscreen 800x800 canvas and converts it to `LabelOutput`.
- Support both ZPL graphic image output and SLCS graphic image output.
- Make the pickup-order label preview clickable only when at least one 100x100
  label printer is configured.
- Ask for confirmation before printing.
- Print one label per selected-line unit quantity.
- Show clear success, unavailable-printer, cancelled, and failure states in the
  pickup detail view.

Out of scope:

- New Electron IPC channels.
- Server or Prisma changes.
- Print history.
- Automatic printing.
- Pickup-order status mutation.
- Printer DPI calibration beyond the current 800x800 canvas.
- Reworking the visible canvas layout.
- Changing PP QR payload rules.

## Recommended Approach

Use the existing pickup work-label model and renderer as the single source of
truth. The print builder should create an offscreen 800x800 canvas, call
`renderPickupWorkLabel()`, convert that canvas to monochrome raster bytes, then
return the existing `LabelOutput` union.

Compared with printing the visible preview canvas, this keeps the print path
independent from React timing and CSS scaling. Compared with writing a separate
ZPL command label, it avoids a second layout implementation that can drift from
the preview.

## Interface Settings

Extend `MediaSize` from:

```ts
type MediaSize = "7030" | "7090";
```

to:

```ts
type MediaSize = "7030" | "7090" | "100100";
```

The visible select label should be:

```text
100x100
```

This applies consistently to:

- Electron main config types,
- preload type declarations,
- renderer `InterfaceSettingsScreen` local types,
- `useZplPrinters`,
- serial label printer settings,
- network label printer settings.

No config migration is required. Existing configs without `mediaSize` or with
`7030` / `7090` remain valid.

## Raster Output

The pickup label canvas is 800x800 dots. The raster helper must not reuse the
70x90 SLCS hard-coded `SW560` / `SL720` header for pickup labels.

For 100x100 pickup labels:

- ZPL output should use `^PW800` and `^LL800`.
- SLCS output should use `SW800` and `SL800`.
- Monochrome conversion should use the same threshold behavior as the existing
  graphic label path unless physical QA later proves otherwise.
- SLCS graphic data may be sliced into bounded chunks, as the 70x90 graphic
  helper does.

The implementation may either create a generic raster helper shared by 70x90
and pickup labels, or create a pickup-specific raster helper. The safer first
implementation is pickup-specific or generic-with-tests, so existing 70x90
production output does not change without verification.

## Pickup Detail Behavior

The label preview remains visually the same. It becomes an action surface when
a 100x100 label printer exists.

Behavior:

- If no 100x100 printer is configured, the preview is not clickable and no print
  affordance is shown.
- If one or more 100x100 printers are configured, tapping the preview opens a
  browser confirmation dialog.
- The confirmation text should include the printer name and label count.
- On confirm, print to the first configured 100x100 printer. Serial printers are
  listed before network printers because the existing printer hook preserves
  that order.
- During printing, prevent duplicate taps.
- On success, show a compact success message near the preview.
- On failure, show the printer error message near the preview.

## Quantity Rule

Print count is derived from the selected pickup-order line quantity:

```ts
printCount = Math.max(1, Math.ceil(line.qty / QTY_SCALE));
```

Rationale:

- POS quantities use `QTY_SCALE = 1000`.
- Pickup order quantities are expected to be whole-unit operational quantities.
- If a future fractional quantity appears, rounding up is safer for work labels
  than printing zero or truncating.

Each printed label is identical and represents one unit. The QR payload remains
the existing per-unit PP-compatible payload and must not encode the full line
quantity.

## Component Boundaries

`PickupOrderWorkLabelPreview` should remain responsible for rendering the
canvas preview. It can expose click state through props, or the parent viewer
can wrap it in a button-like container. The renderer must remain a pure web app:
no Electron, `fs`, `path`, or Node imports.

Recommended modules:

```text
retail_pos_app/src/renderer/src/libs/pickup-work-label/output.ts
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx
retail_pos_app/src/renderer/src/hooks/useZplPrinters.ts
retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx
retail_pos_app/src/main/types.ts
retail_pos_app/src/preload/index.d.ts
```

No changes are needed in `retail_pos_app/src/main/ipc/label.ts` or
`retail_pos_app/src/preload/index.ts` because the existing `printLabel` bridge
already transports `LabelOutput`.

## Error Handling

The print action should handle:

- no configured 100x100 printer,
- user cancels confirmation,
- label render failure,
- `window.electronAPI.printLabel` returning `{ ok: false }`,
- thrown exceptions from rendering or IPC.

Failures should not mutate pickup order status or clear the selected line.

## Verification

Automated verification:

```bash
cd retail_pos_app
npm run build
```

Focused tests should cover pure helpers where practical:

- media-size filtering finds only `100100` printers,
- pickup print count converts scaled quantities to label copies,
- pickup label output uses `^PW800` / `^LL800` for ZPL,
- pickup label output uses `SW800` / `SL800` for SLCS.

Manual QA:

- Add a serial or network label printer with media size `100x100`.
- Open a pickup order detail.
- Confirm the label preview is clickable.
- Tap the preview and cancel; nothing prints.
- Tap the preview and confirm; `qty` labels print.
- Remove or change the printer media size away from `100x100`; the preview no
  longer offers printing.
- Verify the printed QR scans through the existing PP item flow.
