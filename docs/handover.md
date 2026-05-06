# Handover: 70x90 Price Tag V2 QA And Detail Tuning

Date: 2026-05-06

## Current Status

70x90 price tag v2 has been implemented, merged into `main`, physically QA'd,
and detail-tuned against printed 70x90 output.

Latest relevant commit:

```text
232f375 feat: add 70x90 price tag v2
```

Branch state at handover:

```text
main == codex/70x90-price-tag-v2 at 232f375
origin/main is older at 0900bb8
```

Build verification already done after merge:

```bash
cd retail_pos_app
npm run build
```

Result: passed.

The QA tuning pass after `232f375` reshaped the v2 label into a
banner-and-centered-price design and added manual print controls for normal vs
current 70x90 output.

## Important Untracked Files

These files are currently untracked and were intentionally not included in the
label v2 merge:

- `docs/handover.md`
- `docs/superpowers/plans/2026-05-06-70x90-price-tag-v2.md`
- `docs/superpowers/plans/2026-05-06-sale-point-refund-reversal.md`

The refund reversal plan is unrelated to 70x90 labels. Do not assume it belongs
to this label work.

## What Was Implemented

### New 70x90 v2 graphic builder

New folder:

```text
retail_pos_app/src/renderer/src/libs/label-7090-v2/
```

Files:

- `types.ts`
  - 560x720 canvas constants.
  - `DATAMATRIX_SIZE_PX = 60`.
  - v2 model types.
- `price-model.ts`
  - Converts `Item` into the four label cases.
  - Uses `itemNameParser(item)` so brand prefixes are preserved.
  - Normal member price is only shown when `price[1] > 0 && price[1] < price[0]`.
  - Promo member price is only shown when `promoPrice.prices[1] > 0` and is
    lower than the displayed promo guest price.
  - `priceMode: "normal"` lets callers ignore `promoPrice` and print a normal
    70x90 tag for promo items.
  - Save values are calculated from normal guest price:
    - promo guest: `price[0] - promoPrice[0]`
    - promo member: `price[0] - promoPrice[1]`
- `datamatrix.ts`
  - Uses `bwip-js/browser`.
  - Renders real Data Matrix into canvas, not the old fake layout pattern.
- `render.ts`
  - Draws the 70x90 label to HTML canvas.
  - Data Matrix is `60x60` at `x=475, y=628`.
  - Uses a banner headline and centered primary price.
  - Long promo headings shrink and then ellipsize instead of clipping.
  - Split-price drawing uses `measureText()` and shrinks for high prices.
  - Product names wrap to max lines and ellipsize overlong final lines.
- `canvas-raster.ts`
  - Converts canvas to monochrome raster.
  - Composites transparent pixels against white before thresholding.
  - Builds ZPL `^GFA`.
  - Builds SLCS `LD` chunks at 256px height.
- `index.ts`
  - Public `buildPriceTag7090V2(labelLanguage, item, options): Promise<LabelOutput>`.
  - Options include `priceMode` and `storeName`.

### Dependency

Added:

```json
"bwip-js": "^4.10.1"
```

in `retail_pos_app/package.json` and lockfile.

### Existing builder preserved

The old command-based builder still exists:

```text
retail_pos_app/src/renderer/src/libs/label-templates.ts
export function buildPriceTag7090(...)
```

Keep it for rollback and comparison while QA is ongoing.

### Production callers switched to v2

Manual price-tag printing:

```text
retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTag.tsx
```

Item Sheet printing:

```text
retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx
```

Both now call:

```ts
buildPriceTag7090V2(printer.language, item, options)
```

Since v2 is async, both use `await Promise.all(...)` before
`mergeLabelOutputs(...)`.

70x30 output remains on `buildPriceTag7030()` and is unchanged.

Manual 70x90 printing now splits printer buttons when promo items are queued:

- `Current` prints the current effective label, including promo when present.
- `Normal` ignores promo and prints the normal 70x90 label.

Item Sheet printing routes rows to 70x90 when either:

- the item has `promoPrice`, or
- a 70x90 printer is selected and `price[1] > 0 && price[1] < price[0]`.

This lets non-promo member-discount items print the `Member Price` 70x90
template from sheets.

### Diagnostic buttons

Interface Settings now has three 70x90 diagnostic buttons:

```text
Print 70x90 Samples [0]
Print Graphic ZPL+SLCS [0]
Print 70x90 V2 [0]
```

File:

```text
retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx
```

`Print 70x90 V2 [0]` prints four fixture labels:

1. normal guest only, headed by `StoreSetting.name`
2. normal guest/member, headed by `Member Price`
3. promo guest only, headed by promo name
4. promo guest/member, headed by promo name with member price as the main price

The diagnostic print buttons share a lock so multiple diagnostic jobs cannot
run at the same time.

### Transport changes

SLCS binary raster transport support exists in:

- `retail_pos_app/src/renderer/src/libs/label-builder.ts`
- `retail_pos_app/src/main/types.ts`
- `retail_pos_app/src/preload/index.d.ts`
- `retail_pos_app/src/main/ipc/label.ts`

`SLCSPart` now supports:

```ts
{ type: "bytes"; data: number[] }
```

`retail_pos_app/src/main/ipc/label.ts` also has a size-aware serial timeout for
large raster payloads:

```text
timeout = max(3000ms, estimated serial transfer time at 115200 baud + 5000ms)
```

TCP timeout remains fixed.

## Critical QA Notes

The old fake Data Matrix in the experiment was only a visual pattern and could
not scan. V2 now renders a real Data Matrix via `bwip-js`.

Current Data Matrix footprint:

```text
60 x 60 px
x = 475
y = 628
```

The old fake Data Matrix in the experiment did not scan because it was fake, not
because it was too small. During physical QA the real Data Matrix was increased
from `54x54` to `60x60`.

## First QA Steps

1. Run the app from `main`.

```bash
cd retail_pos_app
npm run dev
```

2. Go to:

```text
Home -> Interface Settings -> Label Printer Test
```

3. Press:

```text
Print 70x90 V2 [0]
```

4. Check all four labels:

- Does each label print fully?
- Does the Data Matrix scan?
- Are Korean and English names readable?
- Do prices/cents look tight enough?
- Does high price formatting fit?
- Is member/promo/save placement visually acceptable?
- Is the Data Matrix cut off or too close to the edge?
- Does serial printing complete without timeout?

5. If v2 diagnostic passes, test production flows:

- `/price-tag` manual item queue, 70x90 printer.
- Item Sheet flow with promo items and member-discount normal items routed to 70x90.
- Confirm 70x30 still looks unchanged.

## Final QA/Tuning Notes

- Do not remove the old `buildPriceTag7090()` yet; it remains the rollback path.
- Do not change 70x30 labels while tuning 70x90.
- Store name is passed into v2 from Store Settings and used as the normal
  single-price headline.
- Promo/member labels use member price as the main price.
- Promo/member `SAVE` compares normal guest `price[0]` with promo member
  `promoPrice.prices[1]`.
- Promo dotted divider and product names were spaced based on physical print QA.

If more tuning is needed, likely areas are:

- primary price y positions
- promo heading size and position
- Korean/English product name wrapping and font sizes
- `Was` / date / save line placement
- barcode text placement
- Data Matrix exact position if physical print cuts it off
- SLCS/ZPL raster darkness threshold if print is too light/heavy

Useful constants and functions:

```text
retail_pos_app/src/renderer/src/libs/label-7090-v2/types.ts
retail_pos_app/src/renderer/src/libs/label-7090-v2/render.ts
retail_pos_app/src/renderer/src/libs/label-7090-v2/canvas-raster.ts
```

## Rules To Preserve

- Do not remove the old `buildPriceTag7090()` yet.
- Do not change 70x30 labels while tuning 70x90.
- Keep renderer pure web: no Electron/Node imports in renderer v2 files.
- Keep Data Matrix image-rendered in the graphic path.
- Do not treat missing member price as `$0.00`.
- Member price exists only from positive member-tier candidates.
- Price display should follow lowest-of semantics.
- Save is always based on normal guest price.

## Suggested First Message For Next Session

```text
Read docs/handover.md and continue 70x90 price tag v2 QA/detail tuning. We are on main after commit 232f375. Start by inspecting the v2 files and current git status, then help me tune the physical 70x90 output. Do not remove the old buildPriceTag7090 rollback path, do not touch 70x30 labels, and keep the Data Matrix at 54x54 unless I explicitly say otherwise. Reply in Korean.
```
