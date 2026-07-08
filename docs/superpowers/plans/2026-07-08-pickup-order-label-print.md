# Pickup Order Label Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 100x100 label-printer configuration and print the pickup-order work-label canvas from the pickup order detail preview, one label per selected-line unit quantity.

**Architecture:** Keep the renderer canvas model/render path as the single source of truth. Add 100x100 as a label media size, build pickup label `LabelOutput` from an offscreen 800x800 canvas, and send it through the existing `window.electronAPI.printLabel` bridge without new IPC or server changes.

**Tech Stack:** Electron 40, React 19, TypeScript strict mode, Tailwind CSS, HTML Canvas 2D, existing `LabelOutput` ZPL/SLCS transport, existing Node test runner with `node --experimental-strip-types`.

---

This plan implements:

```text
docs/superpowers/specs/2026-07-08-pickup-order-label-print-design.md
```

Repository rule for this plan: do not stage or commit unless the user explicitly asks during execution. The verification checkpoints below are build/test checkpoints, not git commit checkpoints.

## File Structure

- Modify `retail_pos_app/src/main/types.ts`
  - Extend the app config `MediaSize` union with `"100100"`.
- Modify `retail_pos_app/src/preload/index.d.ts`
  - Keep renderer-visible config types aligned with main-process types.
- Modify `retail_pos_app/src/renderer/src/hooks/useZplPrinters.ts`
  - Extend `MediaSize` and keep media size on returned printers.
- Modify `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`
  - Add `100x100` to serial and network label printer media-size selects.
- Create `retail_pos_app/src/renderer/src/libs/pickup-work-label/print.ts`
  - Pure helper for 100x100 printer filtering and scaled quantity to print count.
- Create `retail_pos_app/src/renderer/src/libs/pickup-work-label/output.ts`
  - Render a pickup label model to an offscreen canvas and convert it to ZPL or
    SLCS graphic `LabelOutput`.
- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`
  - Accept optional print-action props and expose button semantics only when
    printing is available.
- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Load configured printers, confirm on preview tap, print `qty` copies, and
    show compact print status.
- Create `retail_pos_app/scripts/tests/pickup-work-label-print.test.ts`
  - Test pure print helpers.
- Create `retail_pos_app/scripts/tests/pickup-work-label-output.test.ts`
  - Test pure ZPL/SLCS graphic output builders with fake raster data.

## Task 1: Add 100x100 Media Size To Config And UI

**Files:**

- Modify: `retail_pos_app/src/main/types.ts`
- Modify: `retail_pos_app/src/preload/index.d.ts`
- Modify: `retail_pos_app/src/renderer/src/hooks/useZplPrinters.ts`
- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`

- [ ] **Step 1: Extend main-process media-size type**

In `retail_pos_app/src/main/types.ts`, change:

```ts
export type MediaSize = "7030" | "7090";
```

to:

```ts
export type MediaSize = "7030" | "7090" | "100100";
```

- [ ] **Step 2: Extend preload declaration media-size type**

In `retail_pos_app/src/preload/index.d.ts`, change:

```ts
export type MediaSize = '7030' | '7090'
```

to:

```ts
export type MediaSize = '7030' | '7090' | '100100'
```

- [ ] **Step 3: Extend renderer printer hook media-size type**

In `retail_pos_app/src/renderer/src/hooks/useZplPrinters.ts`, change:

```ts
type MediaSize = '7030' | '7090'
```

to:

```ts
type MediaSize = '7030' | '7090' | '100100'
```

- [ ] **Step 4: Extend Interface Settings local media-size type**

In `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`, change:

```ts
type MediaSize = "7030" | "7090";
```

to:

```ts
type MediaSize = "7030" | "7090" | "100100";
```

- [ ] **Step 5: Add 100x100 to serial media-size select**

In the serial label-printer media-size `<select>` in
`InterfaceSettingsScreen.tsx`, change:

```tsx
<option value="">None</option>
<option value="7030">70×30</option>
<option value="7090">70×90</option>
```

to:

```tsx
<option value="">None</option>
<option value="7030">70×30</option>
<option value="7090">70×90</option>
<option value="100100">100x100</option>
```

- [ ] **Step 6: Add 100x100 to network media-size select**

In the network label-printer media-size `<select>` in
`InterfaceSettingsScreen.tsx`, change:

```tsx
<option value="">None</option>
<option value="7030">70×30</option>
<option value="7090">70×90</option>
```

to:

```tsx
<option value="">None</option>
<option value="7030">70×30</option>
<option value="7090">70×90</option>
<option value="100100">100x100</option>
```

- [ ] **Step 7: Run type check through app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build reaches TypeScript compilation. If it fails here, fix only
media-size type mismatches from this task before continuing.

## Task 2: Add Pickup Label Print Helper Tests

**Files:**

- Create: `retail_pos_app/scripts/tests/pickup-work-label-print.test.ts`
- Create: `retail_pos_app/src/renderer/src/libs/pickup-work-label/print.ts`

- [ ] **Step 1: Write failing tests for printer filtering and print count**

Create `retail_pos_app/scripts/tests/pickup-work-label-print.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);

      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }

      return nextResolve(specifier, context);
    }
  `)}`,
);

const {
  PICKUP_WORK_LABEL_MEDIA_SIZE,
  getPickupWorkLabelPrintCount,
  getPickupWorkLabelPrinters,
} = await import("../../src/renderer/src/libs/pickup-work-label/print.ts");

test("PICKUP_WORK_LABEL_MEDIA_SIZE is the Interface Settings 100x100 value", () => {
  assert.equal(PICKUP_WORK_LABEL_MEDIA_SIZE, "100100");
});

test("getPickupWorkLabelPrinters returns only configured 100x100 printers in order", () => {
  const printers = [
    {
      type: "serial",
      name: "70x90 serial",
      language: "slcs",
      mediaSize: "7090",
      path: "/dev/tty.usbserial-a",
    },
    {
      type: "serial",
      name: "Pickup serial",
      language: "slcs",
      mediaSize: "100100",
      path: "/dev/tty.usbserial-b",
    },
    {
      type: "net",
      name: "No media",
      language: "zpl",
      host: "192.168.1.51",
      port: 9100,
    },
    {
      type: "net",
      name: "Pickup network",
      language: "zpl",
      mediaSize: "100100",
      host: "192.168.1.52",
      port: 9100,
    },
  ];

  assert.deepEqual(
    getPickupWorkLabelPrinters(printers).map((printer) => printer.name),
    ["Pickup serial", "Pickup network"],
  );
});

test("getPickupWorkLabelPrintCount rounds scaled pickup quantities up to at least one", () => {
  assert.equal(getPickupWorkLabelPrintCount(0), 1);
  assert.equal(getPickupWorkLabelPrintCount(1), 1);
  assert.equal(getPickupWorkLabelPrintCount(999), 1);
  assert.equal(getPickupWorkLabelPrintCount(1000), 1);
  assert.equal(getPickupWorkLabelPrintCount(1001), 2);
  assert.equal(getPickupWorkLabelPrintCount(3000), 3);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-print.test.ts
```

Expected: FAIL with a module-not-found error for
`libs/pickup-work-label/print.ts`.

- [ ] **Step 3: Implement the helper**

Create `retail_pos_app/src/renderer/src/libs/pickup-work-label/print.ts`:

```ts
import { QTY_SCALE } from "../constants";
import type { LabelPrinter } from "../../hooks/useZplPrinters";

export const PICKUP_WORK_LABEL_MEDIA_SIZE = "100100" as const;

export type PickupWorkLabelPrinter = LabelPrinter & {
  mediaSize: typeof PICKUP_WORK_LABEL_MEDIA_SIZE;
};

export function getPickupWorkLabelPrinters(
  printers: LabelPrinter[],
): PickupWorkLabelPrinter[] {
  return printers.filter(
    (printer): printer is PickupWorkLabelPrinter =>
      printer.mediaSize === PICKUP_WORK_LABEL_MEDIA_SIZE,
  );
}

export function getPickupWorkLabelPrintCount(qty: number): number {
  return Math.max(1, Math.ceil(qty / QTY_SCALE));
}
```

- [ ] **Step 4: Run the helper test again**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-print.test.ts
```

Expected: PASS.

## Task 3: Add Pickup Label Graphic Output Builder

**Files:**

- Create: `retail_pos_app/scripts/tests/pickup-work-label-output.test.ts`
- Create: `retail_pos_app/src/renderer/src/libs/pickup-work-label/output.ts`

- [ ] **Step 1: Write failing tests for ZPL and SLCS 800x800 headers**

Create `retail_pos_app/scripts/tests/pickup-work-label-output.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);

      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }

      return nextResolve(specifier, context);
    }
  `)}`,
);

const {
  PICKUP_WORK_LABEL_BLACK_THRESHOLD,
  PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT,
  buildPickupWorkLabelSlcsGraphicLabel,
  buildPickupWorkLabelZplGraphicLabel,
} = await import("../../src/renderer/src/libs/pickup-work-label/output.ts");

function fakeRaster() {
  return {
    width: 800,
    height: 800,
    widthBytes: 100,
    data: new Uint8Array(100 * 800),
  };
}

test("pickup output constants match the current 800x800 canvas plan", () => {
  assert.equal(PICKUP_WORK_LABEL_BLACK_THRESHOLD, 220);
  assert.equal(PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT, 256);
});

test("buildPickupWorkLabelZplGraphicLabel emits 800x800 ZPL graphic image", () => {
  const zpl = buildPickupWorkLabelZplGraphicLabel(fakeRaster());

  assert.equal(zpl.startsWith("^XA^PW800^LL800^FO0,0^GFA,"), true);
  assert.equal(zpl.endsWith("^FS^XZ"), true);
  assert.match(zpl, /\^GFA,80000,80000,100,/);
});

test("buildPickupWorkLabelSlcsGraphicLabel emits 800x800 SLCS graphic image slices", () => {
  const parts = buildPickupWorkLabelSlcsGraphicLabel(fakeRaster());

  assert.deepEqual(parts[0], {
    type: "raw",
    data: "@\r\nCB\r\nSW800\r\nSL800\r\n",
  });
  assert.deepEqual(parts.at(-1), { type: "raw", data: "P1\r\n" });

  const byteParts = parts.filter((part) => part.type === "bytes");
  assert.equal(byteParts.length, 4);
  assert.equal(byteParts[0].data[0], 0x4c);
  assert.equal(byteParts[0].data[1], 0x44);
});
```

- [ ] **Step 2: Run the failing output test**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-output.test.ts
```

Expected: FAIL with a module-not-found error for
`libs/pickup-work-label/output.ts`.

- [ ] **Step 3: Implement the pickup output builder**

Create `retail_pos_app/src/renderer/src/libs/pickup-work-label/output.ts`:

```ts
import type { LabelLanguage, LabelOutput, SLCSPart } from "../label-builder";
import { type PickupWorkLabelModel } from "./model";
import {
  PICKUP_WORK_LABEL_CANVAS_SIZE,
  renderPickupWorkLabel,
} from "./render";

export const PICKUP_WORK_LABEL_BLACK_THRESHOLD = 220;
export const PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT = 256;

export interface PickupWorkLabelMonoRaster {
  width: number;
  height: number;
  widthBytes: number;
  data: Uint8Array;
}

export function canvasToPickupWorkLabelMonoRaster(
  canvas: HTMLCanvasElement,
): PickupWorkLabelMonoRaster {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3] / 255;
      const red = pixels[idx] * alpha + 255 * (1 - alpha);
      const green = pixels[idx + 1] * alpha + 255 * (1 - alpha);
      const blue = pixels[idx + 2] * alpha + 255 * (1 - alpha);
      const gray = 0.299 * red + 0.587 * green + 0.114 * blue;

      if (gray < PICKUP_WORK_LABEL_BLACK_THRESHOLD) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        data[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return { width, height, widthBytes, data };
}

export function buildPickupWorkLabelZplGraphicLabel(
  raster: PickupWorkLabelMonoRaster,
): string {
  const totalBytes = raster.data.length;
  let hex = "";
  for (const byte of raster.data) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }

  return `^XA^PW${raster.width}^LL${raster.height}^FO0,0^GFA,${totalBytes},${totalBytes},${raster.widthBytes},${hex}^FS^XZ`;
}

export function buildPickupWorkLabelSlcsGraphicLabel(
  raster: PickupWorkLabelMonoRaster,
): SLCSPart[] {
  const parts: SLCSPart[] = [
    {
      type: "raw",
      data: `@\r\nCB\r\nSW${raster.width}\r\nSL${raster.height}\r\n`,
    },
  ];

  for (
    let sliceTop = 0;
    sliceTop < raster.height;
    sliceTop += PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT
  ) {
    const sliceHeight = Math.min(
      PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT,
      raster.height - sliceTop,
    );
    const sliceStart = sliceTop * raster.widthBytes;
    const sliceEnd = sliceStart + sliceHeight * raster.widthBytes;
    const header = [
      0x4c,
      0x44,
      0,
      0,
      sliceTop & 0xff,
      (sliceTop >> 8) & 0xff,
      raster.widthBytes & 0xff,
      (raster.widthBytes >> 8) & 0xff,
      sliceHeight & 0xff,
      (sliceHeight >> 8) & 0xff,
    ];

    parts.push({
      type: "bytes",
      data: [...header, ...Array.from(raster.data.slice(sliceStart, sliceEnd))],
    });
  }

  parts.push({ type: "raw", data: "P1\r\n" });
  return parts;
}

export async function buildPickupWorkLabelOutput(
  labelLanguage: LabelLanguage,
  model: PickupWorkLabelModel,
): Promise<LabelOutput> {
  const canvas = document.createElement("canvas");
  canvas.width = PICKUP_WORK_LABEL_CANVAS_SIZE;
  canvas.height = PICKUP_WORK_LABEL_CANVAS_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  await renderPickupWorkLabel(ctx, model);
  const raster = canvasToPickupWorkLabelMonoRaster(canvas);

  if (labelLanguage === "zpl") {
    return {
      language: "zpl",
      data: buildPickupWorkLabelZplGraphicLabel(raster),
    };
  }

  return {
    language: "slcs",
    parts: buildPickupWorkLabelSlcsGraphicLabel(raster),
  };
}
```

- [ ] **Step 4: Run the output test again**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-output.test.ts
```

Expected: PASS.

## Task 4: Add Print Action To Pickup Label Preview

**Files:**

- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`

- [ ] **Step 1: Extend preview props**

In `PickupOrderWorkLabelPreview.tsx`, change:

```ts
type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
};
```

to:

```ts
type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
  canPrint?: boolean;
  printing?: boolean;
  onPrint?: () => void;
};
```

- [ ] **Step 2: Update the function signature**

Change:

```tsx
export default function PickupOrderWorkLabelPreview({ order, line }: Props) {
```

to:

```tsx
export default function PickupOrderWorkLabelPreview({
  order,
  line,
  canPrint = false,
  printing = false,
  onPrint,
}: Props) {
```

- [ ] **Step 3: Wrap the canvas with button semantics only when printing is available**

Replace the current `return (...)` block with:

```tsx
  const canvas = (
    <canvas
      ref={canvasRef}
      width={PICKUP_WORK_LABEL_CANVAS_SIZE}
      height={PICKUP_WORK_LABEL_CANVAS_SIZE}
      aria-label={`Pickup work label preview for ${model.documentId}`}
      className="block max-w-full bg-white shadow-sm"
      style={{ width: "100mm", height: "100mm" }}
    />
  );

  if (!canPrint || !onPrint) {
    return canvas;
  }

  return (
    <button
      type="button"
      onClick={onPrint}
      disabled={printing}
      aria-label={`Print pickup work label for ${model.documentId}`}
      className="group relative block max-w-full disabled:cursor-wait"
    >
      {canvas}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-100">
        {printing ? "Printing..." : "Tap to print"}
      </span>
    </button>
  );
```

- [ ] **Step 4: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS. If TypeScript complains about nested interactive elements, keep
the wrapper as a `<div role="button" tabIndex={0}>` with `onKeyDown` for Enter
and Space. Do not use Electron or Node imports in this component.

## Task 5: Connect Pickup Viewer To Configured 100x100 Printer

**Files:**

- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add imports**

At the top of `PickupOrderViewer.tsx`, add:

```ts
import { useZplPrinters } from "../../hooks/useZplPrinters";
import { buildPickupWorkLabelModel } from "../../libs/pickup-work-label/model";
import { buildPickupWorkLabelOutput } from "../../libs/pickup-work-label/output";
import {
  getPickupWorkLabelPrintCount,
  getPickupWorkLabelPrinters,
} from "../../libs/pickup-work-label/print";
```

- [ ] **Step 2: Load printers and add print state**

Inside `PickupOrderViewer`, after existing `useState` declarations, add:

```ts
  const { printers, printLabel } = useZplPrinters();
  const pickupLabelPrinters = getPickupWorkLabelPrinters(printers);
  const pickupLabelPrinter = pickupLabelPrinters[0] ?? null;
  const [labelPrintLoading, setLabelPrintLoading] = useState(false);
  const [labelPrintMessage, setLabelPrintMessage] = useState("");
```

- [ ] **Step 3: Clear print message when selected line or order changes**

Add this effect after the existing load effects:

```ts
  useEffect(() => {
    setLabelPrintMessage("");
  }, [order?.crmOrderId, selectedCrmLineId]);
```

- [ ] **Step 4: Add the print handler after `selectedLine` is defined**

Find the existing selected-line calculation:

```ts
  const selectedLine =
    order?.lines.find((line) => line.crmLineId === selectedCrmLineId) ??
    order?.lines[0] ??
    null;
```

Add this callback immediately after that block and before
`if (crmOrderId == null) return null;`:

```ts
  const printSelectedLabel = useCallback(async () => {
    if (!order || !selectedLine || labelPrintLoading) return;

    if (!pickupLabelPrinter) {
      setLabelPrintMessage("No 100x100 label printer configured.");
      return;
    }

    const printCount = getPickupWorkLabelPrintCount(selectedLine.qty);
    const confirmed = window.confirm(
      `Print ${printCount} pickup label${printCount === 1 ? "" : "s"} to ${pickupLabelPrinter.name}?`,
    );
    if (!confirmed) {
      setLabelPrintMessage("Print cancelled.");
      return;
    }

    setLabelPrintLoading(true);
    setLabelPrintMessage("");

    try {
      const model = buildPickupWorkLabelModel(order, selectedLine);
      const label = await buildPickupWorkLabelOutput(
        pickupLabelPrinter.language,
        model,
      );

      for (let copy = 0; copy < printCount; copy += 1) {
        const result = await printLabel(pickupLabelPrinter, label);
        if (!result.ok) {
          setLabelPrintMessage(result.message || "Failed to print label.");
          return;
        }
      }

      setLabelPrintMessage(
        `Printed ${printCount} label${printCount === 1 ? "" : "s"} to ${pickupLabelPrinter.name}.`,
      );
    } catch (err) {
      setLabelPrintMessage(
        err instanceof Error ? err.message : "Failed to print label.",
      );
    } finally {
      setLabelPrintLoading(false);
    }
  }, [
    labelPrintLoading,
    order,
    pickupLabelPrinter,
    printLabel,
    selectedLine,
  ]);
```

- [ ] **Step 5: Pass print props to the preview**

Change:

```tsx
<PickupOrderWorkLabelPreview order={order} line={selectedLine} />
```

to:

```tsx
<PickupOrderWorkLabelPreview
  order={order}
  line={selectedLine}
  canPrint={pickupLabelPrinter !== null}
  printing={labelPrintLoading}
  onPrint={printSelectedLabel}
/>
```

- [ ] **Step 6: Show compact print status under the preview**

Immediately after the preview component, add:

```tsx
{labelPrintMessage && (
  <p className="max-w-[420px] text-center text-xs font-semibold text-gray-600">
    {labelPrintMessage}
  </p>
)}
```

Expected layout: the status message appears in the existing preview column gap
under the canvas and does not move the modal header or footer.

- [ ] **Step 7: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

## Task 6: Run Focused Tests And Final Build

**Files:**

- Verify only.

- [ ] **Step 1: Run existing pickup work-label model tests**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run new print helper tests**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-print.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run new output helper tests**

Run:

```bash
cd retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-output.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff -- retail_pos_app/src/main/types.ts retail_pos_app/src/preload/index.d.ts retail_pos_app/src/renderer/src/hooks/useZplPrinters.ts retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx retail_pos_app/src/renderer/src/libs/pickup-work-label retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx retail_pos_app/scripts/tests
```

Expected:

- `MediaSize` includes `"100100"` in main, preload, hook, and Interface Settings.
- Serial and network media-size selects show `100x100`.
- Pickup work-label print helpers are renderer-only.
- No changes to `retail_pos_app/src/main/ipc/label.ts`.
- No server or Prisma changes.

## Manual QA

After implementation and build pass:

- Add a serial or network label printer in Interface Settings.
- Set its media size to `100x100`.
- Save settings and let the app restart as Interface Settings already does.
- Open `/manager/pickup-orders`.
- Open a pickup order with `qty = 1`.
- Tap the label preview and cancel; verify no printer activity and the UI shows
  `Print cancelled.`.
- Tap the label preview and confirm; verify one label prints.
- Open or seed a pickup order with `qty = 3`; verify three identical labels
  print.
- Change the printer media size to `70x90` or `None`; verify the label preview
  no longer shows the print affordance.
- Scan the printed QR through the existing POS PP item flow.

## Self-Review Notes

- Spec coverage: this plan covers 100x100 settings, configured-printer
  filtering, offscreen canvas raster output, confirmation, qty-based copies,
  success/failure state, and build/test verification.
- Scope check: no new Electron IPC, server API, Prisma model, print history, or
  status mutation is included.
- Type consistency: the media-size value is consistently `"100100"` in config
  types and helper code; the visible label is consistently `100x100`.
