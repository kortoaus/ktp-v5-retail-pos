# Pickup Label Preview Canvas Design

Date: 2026-07-07

## Goal

Replace the pickup order detail label preview with a canvas-rendered 100x100mm
work label preview.

This slice only completes the preview canvas. It prepares the model and draw
order needed for future QR/ZPL printing, but it does not add a print button,
send label commands to a printer, track print history, or implement ZPL output.

## Context

Pickup order detail currently shows a DOM-based 100x100mm work label preview.
The final printed label should later be generated from the same visual source,
so the preview should move to a canvas renderer now. A canvas-first design keeps
the preview and future raster/ZPL label output from drifting apart.

The preview appears in the pickup order viewer for the selected line. The left
side of the viewer shows order and line details. The right detail panel already
shows `OPTION TOTAL`, and that value is the per-unit selected-option total.

## Scope

In scope:

- A canvas-based pickup work label preview component in the renderer.
- A label model built from `PickupOrderDetail` and one `PickupOrderLine`.
- 100x100mm layout rules at a fixed canvas dot size.
- Canvas text wrapping and clipping rules.
- QR preview positioning and draw-order rules.
- PP-compatible QR payload construction rules for preview data.
- Unit price arrays adjusted with per-unit option total.

Out of scope:

- Printing actions.
- ZPL or SLCS output.
- IPC/preload/main-process changes.
- Label printer selection.
- Print history or print status.
- Order status mutation.
- Changing pickup order sync data shape.

## Layout

The label is 100x100mm. The canvas renderer should use a fixed square dot grid
and scale it in the UI with CSS. The first implementation should use an 800x800
canvas unless printer testing later proves a different dot density is needed.

The label has no outer border. Direct thermal print speed matters, so the design
avoids large filled black regions. Section dividers are thin dashed lines.

Top-to-bottom content order:

```text
PICKUP ${documentId}
-------------------- dashed
left:  item.barcode as text only
left:  item.name_en, max 2 measured lines
right: QR only
-------------------- dashed
options in English
-------------------- dashed
note, max 2 measured lines
-------------------- dashed
customer name / pickup date and time
```

The barcode is not rendered as a barcode graphic. It is text only.

## Text Rules

`item.barcode` is a smaller text element than the item name. It is supporting
identification text, not the primary scan target.

`item.name_en` uses measured canvas text width:

- If it fits, render one line.
- If it does not fit, wrap to a maximum of two lines.
- If it still overflows, clip the second line with an ellipsis.

Customer notes also render to a maximum of two measured lines.

Options are the most important area. They should render in English and receive
the largest vertical block on the label. If the selected options exceed the
available option block, the renderer should stop before the divider and show a
compact overflow marker such as `+N more`.

## QR Draw Order

QR must be drawn after text and dividers.

Before drawing the QR modules, the renderer must paint a white rectangular patch
behind the QR area:

```ts
ctx.fillStyle = "white";
ctx.fillRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2);
drawQrModules(ctx, qrData, qrX, qrY, qrSize);
```

This makes the QR readable even if a long `item.name_en` or another element
would otherwise interfere with the QR area. The QR area acts like a clean white
patch laid over the label.

## QR Payload

The pickup label QR should be compatible with the existing POS PP barcode flow.
The existing PP payload shape is:

```text
00:<json>
```

The POS parser reads `"01"` through `"06"` and ignores unknown fields. For this
preview slice, the payload should use the same core fields:

```json
{
  "01": "item barcode",
  "02": [1299],
  "03": []
}
```

The payload may include `"00": 2` for version consistency with the scale app,
but POS compatibility depends on `"01"` through `"06"` staying unchanged.

## Option Pricing

`line.optionTotal` is already the per-unit selected-option total in cents. It is
the same value shown as `OPTION TOTAL` in the right detail panel.

For QR payload compatibility, options should be folded into the price arrays
before encoding:

```ts
const prices = line.prices.map((price) => price + line.optionTotal);
const promoPrices = normalizePromoPrices(line.promoPrices).map(
  (price) => price + line.optionTotal,
);
```

Do not multiply `optionTotal` by `line.qty`.

If `line.qty` is `3 EA`, the future print flow should print three labels. Each
label QR still represents one unit:

```text
unit item price + unit option total
```

The QR should not encode the line's full quantity for this pickup work-label
use case.

## Data Model

Add a renderer-only model layer for the preview, for example:

```ts
type PickupWorkLabelModel = {
  documentId: string;
  pickupStartsAt: string;
  memberName: string;
  itemBarcode: string;
  itemNameEn: string;
  optionLines: string[];
  optionTotal: number;
  note: string | null;
  qrPayload: string;
};
```

The model builder should:

- Prefer `line.barcode` for `itemBarcode`.
- Use `line.name_en` for the label item name.
- Format selected options in English from `selectedOptionsSnapshot`.
- Build QR prices from `line.prices + line.optionTotal`.
- Normalize `line.promoPrices` into a numeric array before adding
  `line.optionTotal`.
- Keep `line.qty` out of the QR unit payload.

## Component Shape

Keep the viewer component thin. The preview component should accept
`order` and `line`, build the model, and render a canvas:

```tsx
<PickupOrderWorkLabelPreview order={order} line={selectedLine} />
```

Internally, the preview should use a `canvas` ref and redraw when the model
changes. Native Electron APIs are not needed. Renderer code must remain a pure
web app.

Suggested module split:

```text
components/pickupOrders/PickupOrderWorkLabelPreview.tsx
libs/pickup-work-label/model.ts
libs/pickup-work-label/render.ts
libs/pickup-work-label/pp-payload.ts
```

The exact path can follow local conventions during implementation, but the
model/render/payload responsibilities should stay separate.

## Verification

For this preview-only slice:

- Run `cd retail_pos_app && npm run build` after implementation.
- Manually inspect the pickup order detail viewer.
- Verify short `item.name_en` stays one line.
- Verify long `item.name_en` wraps to max two lines.
- Verify QR is drawn on a white patch above any earlier text.
- Verify no outer border renders.
- Verify section dividers are dashed.
- Verify `line.optionTotal` is added once to every normal and promo price lane.

