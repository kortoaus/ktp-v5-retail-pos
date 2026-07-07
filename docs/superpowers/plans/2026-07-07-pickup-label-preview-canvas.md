# Pickup Label Preview Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pickup order detail work-label preview with a canvas-rendered 100x100mm preview that builds the same model and PP-compatible QR payload needed by future label output.

**Architecture:** Keep the existing pickup detail viewer and selected-line flow, but move label-specific logic into renderer-only `libs/pickup-work-label/*` modules. The component becomes a thin canvas host; `model.ts` builds label data from `PickupOrderDetail` and one `PickupOrderLine`, `pp-payload.ts` builds the PP QR payload with per-unit option totals, and `render.ts` owns the fixed 800x800 draw order. This slice does not add printing, ZPL/SLCS output, IPC/preload/main-process changes, printer selection, print history, status mutation, or pickup sync shape changes.

**Tech Stack:** Electron 40 renderer, React 19, TypeScript strict mode, Tailwind CSS, HTML Canvas 2D, `qrcode`, Node built-in test runner with `node --experimental-strip-types`, existing POS integer money/quantity scales.

---

## Scope

This plan implements `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-07-07-pickup-label-preview-canvas-design.md`.

In scope:

- Canvas-based pickup work label preview in the renderer.
- Renderer-only model builder from `PickupOrderDetail` and `PickupOrderLine`.
- Fixed 800x800 dot canvas scaled to 100x100mm with CSS.
- Canvas measured wrapping and ellipsis for item name and note.
- Dashed section dividers and no outer label border.
- QR payload compatible with existing POS PP barcode parsing.
- QR white patch drawn after text/dividers and before QR image.
- `line.optionTotal` added once to every normal and promo unit price lane.
- Existing `PickupOrderViewer` continues to pass `order` and `selectedLine`.

Out of scope:

- Print buttons or print actions.
- ZPL, SLCS, ESC/POS, or any printer command output.
- IPC, preload, Electron main-process, or printer configuration changes.
- Label printer selection.
- Print history, print status, or pickup order status mutation.
- Changing pickup order sync payloads or server data shape.

Repository rule: do not stage or commit unless the user explicitly asks. The checkpoint steps below are review checkpoints, not git commits.

---

## Current Code Observations

- The detail modal already renders `<PickupOrderWorkLabelPreview order={order} line={selectedLine} />` in `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`.
- `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx` is currently a DOM/Tailwind 100x100mm preview with a fake QR placeholder.
- Pickup order renderer types already include `line.prices`, `line.promoPrices`, `line.optionTotal`, `line.qty`, `line.note`, `line.barcode`, `line.name_en`, and normalized `selectedOptionsSnapshot`.
- Existing PP parser and builder live in `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pp-barcode.ts`; the parser reads `"01"` through `"06"` and ignores unknown fields.
- `qrcode` is already a renderer dependency and is used with `QRCode.toCanvas(...)` elsewhere in the app.
- Existing lightweight renderer helper tests live under `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests` and run with `node --experimental-strip-types`.

---

## File Structure

- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`
  - Normalize unknown promo price shapes into numeric arrays.
  - Build the PP-compatible `00:<json>` QR payload.
  - Add `optionTotal` once to every unit price lane.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`
  - Define `PickupWorkLabelModel`.
  - Convert `PickupOrderDetail` + `PickupOrderLine` into label-safe display fields.
  - Build English option lines and QR payload.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/render.ts`
  - Render the 800x800 canvas.
  - Own fonts, measured wrapping, dashed dividers, option overflow marker, note clipping, footer, QR white patch, and QR draw order.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`
  - Replace DOM label markup with a canvas ref and redraw effect.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-work-label-model.test.ts`
  - Cover model, option formatting, promo normalization, PP payload compatibility, and per-unit option pricing.

---

## Task 1: PP Payload And Label Model

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-work-label-model.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`

- [ ] **Step 1: Write the failing model and payload tests**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-work-label-model.test.ts`:

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

const { buildPickupWorkLabelModel } = await import(
  "../../src/renderer/src/libs/pickup-work-label/model.ts"
);
const { buildPickupWorkLabelQrPayload, normalizePromoPrices } = await import(
  "../../src/renderer/src/libs/pickup-work-label/pp-payload.ts"
);

const baseOrder = {
  crmOrderId: 9001,
  documentId: "PU-20260707-0001",
  status: "READY",
  memberId: "member-1",
  memberName: "Ari Kim",
  memberLevel: 2,
  memberPhoneLast4: "6789",
  pickupStartsAt: "2026-07-07T03:30:00.000Z",
  linesTotal: 4200,
  total: 4200,
  crmCreatedAt: "2026-07-06T23:00:00.000Z",
  crmUpdatedAt: "2026-07-06T23:10:00.000Z",
  syncedAt: "2026-07-06T23:12:00.000Z",
  lines: [],
};

const baseLine = {
  crmLineId: 7001,
  index: 1,
  itemId: 55,
  name_en: "Premium Salmon Bowl With Fresh Avocado",
  name_ko: "연어볼",
  barcode: "9300000000011",
  code: "SALMON-BOWL",
  uom: "EA",
  prices: [1299, 1199],
  promoPrices: [1099, 999],
  memberLevel: 2,
  optionTotal: 250,
  qty: 3000,
  total: 4647,
  note: "Please keep sauce separate",
  selectedOptionsSnapshot: [
    {
      optionGroupId: 1,
      key: "base",
      name_en: "Base",
      name_ko: "베이스",
      type: "SINGLE",
      selectedOptions: [
        {
          key: "brown-rice",
          name_en: "Brown Rice",
          name_ko: "현미",
          qty: 1000,
          priceDelta: 0,
        },
      ],
    },
    {
      optionGroupId: 2,
      key: "protein",
      name_en: "",
      name_ko: "단백질",
      type: "QUANTITY",
      selectedOptions: [
        {
          key: "salmon",
          name_en: "Extra Salmon",
          name_ko: "연어 추가",
          qty: 2000,
          priceDelta: 250,
        },
      ],
    },
  ],
};

function decodePayload(payload: string): Record<string, unknown> {
  assert.equal(payload.startsWith("00:"), true);
  return JSON.parse(payload.slice(3));
}

test("normalizePromoPrices accepts numeric arrays and price records", () => {
  assert.deepEqual(normalizePromoPrices([1099, "bad", 999, null]), [1099, 999]);
  assert.deepEqual(normalizePromoPrices({ prices: [899, undefined, 799] }), [
    899,
    799,
  ]);
  assert.deepEqual(normalizePromoPrices(null), []);
});

test("buildPickupWorkLabelQrPayload adds option total once per unit lane", () => {
  const payload = buildPickupWorkLabelQrPayload({
    barcode: "9300000000011",
    prices: [1299, 1199],
    promoPrices: [1099, 999],
    optionTotal: 250,
  });
  const decoded = decodePayload(payload);

  assert.equal(decoded["00"], 2);
  assert.equal(decoded["01"], "9300000000011");
  assert.deepEqual(decoded["02"], [1549, 1449]);
  assert.deepEqual(decoded["03"], [1349, 1249]);
  assert.equal(decoded["04"], undefined);
});

test("buildPickupWorkLabelModel uses English label fields and keeps qty out of QR", () => {
  const model = buildPickupWorkLabelModel(baseOrder, baseLine);
  const decoded = decodePayload(model.qrPayload);

  assert.equal(model.documentId, "PU-20260707-0001");
  assert.equal(model.memberName, "Ari Kim");
  assert.equal(model.itemBarcode, "9300000000011");
  assert.equal(model.itemNameEn, "Premium Salmon Bowl With Fresh Avocado");
  assert.deepEqual(model.optionLines, [
    "Base: Brown Rice x1",
    "protein: Extra Salmon x2",
  ]);
  assert.equal(model.optionTotal, 250);
  assert.equal(model.note, "Please keep sauce separate");
  assert.deepEqual(decoded["02"], [1549, 1449]);
  assert.deepEqual(decoded["03"], [1349, 1249]);
  assert.equal(decoded["04"], undefined);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: FAIL with `Cannot find module .../libs/pickup-work-label/model.ts` or `.../pp-payload.ts`.

- [ ] **Step 3: Add the PP payload helper**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`:

```ts
const PP_PREFIX = "00:";
const PICKUP_WORK_LABEL_PP_VERSION = 2;

type PickupWorkLabelQrPayloadInput = {
  barcode: string;
  prices: number[];
  promoPrices: unknown;
  optionTotal: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isFiniteNumber);
}

export function normalizePromoPrices(value: unknown): number[] {
  if (Array.isArray(value)) return numericArray(value);
  if (typeof value === "object" && value !== null && "prices" in value) {
    return numericArray(value.prices);
  }
  return [];
}

function addOptionTotal(prices: number[], optionTotal: number): number[] {
  return prices
    .filter(isFiniteNumber)
    .map((price) => Math.max(0, Math.round(price + optionTotal)));
}

export function buildPickupWorkLabelQrPayload({
  barcode,
  prices,
  promoPrices,
  optionTotal,
}: PickupWorkLabelQrPayloadInput): string {
  const payload = {
    "00": PICKUP_WORK_LABEL_PP_VERSION,
    "01": barcode,
    "02": addOptionTotal(prices, optionTotal),
    "03": addOptionTotal(normalizePromoPrices(promoPrices), optionTotal),
  };

  return `${PP_PREFIX}${JSON.stringify(payload)}`;
}
```

- [ ] **Step 4: Add the renderer-only label model builder**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`:

```ts
import { QTY_SCALE } from "../constants";
import type {
  PickupOrderDetail,
  PickupOrderLine,
  PickupOrderSelectedOption,
  PickupOrderSelectedOptionGroup,
} from "../../components/pickupOrders/pickup-order-types";
import { buildPickupWorkLabelQrPayload } from "./pp-payload";

export type PickupWorkLabelModel = {
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

function displayQty(qty: number): string {
  return (qty / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
}

function optionGroupLabel(group: PickupOrderSelectedOptionGroup): string {
  return group.name_en.trim() || group.key;
}

function optionLabel(option: PickupOrderSelectedOption): string {
  return option.name_en.trim() || option.key;
}

function optionLine(
  group: PickupOrderSelectedOptionGroup,
  option: PickupOrderSelectedOption,
): string {
  return `${optionGroupLabel(group)}: ${optionLabel(option)} x${displayQty(
    option.qty,
  )}`;
}

function buildOptionLines(groups: PickupOrderSelectedOptionGroup[]): string[] {
  return groups.flatMap((group) =>
    group.selectedOptions.map((option) => optionLine(group, option)),
  );
}

export function buildPickupWorkLabelModel(
  order: PickupOrderDetail,
  line: PickupOrderLine,
): PickupWorkLabelModel {
  const itemBarcode = line.barcode.trim();

  return {
    documentId: order.documentId,
    pickupStartsAt: order.pickupStartsAt,
    memberName: order.memberName.trim() || "-",
    itemBarcode,
    itemNameEn: line.name_en.trim() || line.code || itemBarcode,
    optionLines: buildOptionLines(line.selectedOptionsSnapshot),
    optionTotal: line.optionTotal,
    note: line.note?.trim() || null,
    qrPayload: buildPickupWorkLabelQrPayload({
      barcode: itemBarcode,
      prices: line.prices,
      promoPrices: line.promoPrices,
      optionTotal: line.optionTotal,
    }),
  };
}
```

- [ ] **Step 5: Run the model tests and verify they pass**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: PASS with Node test output showing the three `pickup-work-label` tests passing.

- [ ] **Step 6: Type-check the renderer modules**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS. If TypeScript reports import path or strict-mode errors, fix only the new pickup work-label modules.

---

## Task 2: Canvas Renderer

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/render.ts`

- [ ] **Step 1: Add the canvas render module**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/render.ts`:

```ts
import QRCode from "qrcode";
import dayjsAU from "../dayjsAU";
import type { PickupWorkLabelModel } from "./model";

export const PICKUP_WORK_LABEL_CANVAS_SIZE = 800;

const W = PICKUP_WORK_LABEL_CANVAS_SIZE;
const H = PICKUP_WORK_LABEL_CANVAS_SIZE;
const PAD = 36;
const QR_SIZE = 218;
const QR_PAD = 14;
const QR_X = W - PAD - QR_SIZE;
const QR_Y = 134;
const LEFT_MAX = QR_X - PAD - 22;

type FontFamily = "mono" | "sans";

function font(size: number, weight = 700, family: FontFamily = "mono"): string {
  const mono = `"SFMono-Regular", Consolas, "Liberation Mono", monospace`;
  const sans = `Arial, Helvetica, sans-serif`;
  return `${weight} ${size}px ${family === "mono" ? mono : sans}`;
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x1 = PAD,
  x2 = W - PAD,
): void {
  ctx.save();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (ctx.measureText(value).width <= maxWidth) return value;

  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";

  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  let best = ellipsis;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function wrapMeasuredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (maxLines <= 0) return [];
  const source = text.trim();
  if (!source) return [];

  const parts = source.includes(" ")
    ? source.split(/\s+/).filter(Boolean)
    : Array.from(source);
  const useSpaces = source.includes(" ");
  const lines: string[] = [];
  let current = "";

  for (let index = 0; index < parts.length; ) {
    const part = parts[index];
    const separator = useSpaces && current ? " " : "";
    const candidate = `${current}${separator}${part}`;

    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      index += 1;
      continue;
    }

    if (!current) {
      const clipped = ellipsize(ctx, part, maxWidth);
      if (lines.length === maxLines - 1) return [...lines, clipped];
      lines.push(clipped);
      index += 1;
      continue;
    }

    if (lines.length === maxLines - 1) {
      const rest = parts.slice(index).join(useSpaces ? " " : "");
      return [...lines, ellipsize(ctx, `${current}${separator}${rest}`, maxWidth)];
    }

    lines.push(ellipsize(ctx, current, maxWidth));
    current = "";
  }

  if (current && lines.length < maxLines) {
    lines.push(ellipsize(ctx, current, maxWidth));
  }

  return lines;
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  maxWidth: number,
): number {
  let nextY = y;
  for (const line of lines) {
    ctx.fillText(line, x, nextY, maxWidth);
    nextY += lineHeight;
  }
  return nextY;
}

function drawOptionBlock(
  ctx: CanvasRenderingContext2D,
  optionLines: string[],
  x: number,
  y: number,
  maxWidth: number,
  bottomY: number,
): void {
  ctx.font = font(28, 800);
  ctx.fillStyle = "#111";

  if (optionLines.length === 0) {
    ctx.fillText("NO OPTIONS", x, y, maxWidth);
    return;
  }

  const lineHeight = 34;
  let currentY = y;
  let drawn = 0;

  for (let index = 0; index < optionLines.length; index += 1) {
    const remainingAfterThis = optionLines.length - index - 1;
    if (currentY + lineHeight > bottomY) {
      break;
    }

    if (remainingAfterThis > 0 && currentY + lineHeight * 2 > bottomY) {
      break;
    }

    ctx.fillText(ellipsize(ctx, optionLines[index], maxWidth), x, currentY, maxWidth);
    currentY += lineHeight;
    drawn += 1;
  }

  const hidden = optionLines.length - drawn;
  if (hidden > 0) {
    ctx.font = font(24, 900);
    ctx.fillText(`+${hidden} more`, x, Math.min(currentY, bottomY), maxWidth);
  }
}

async function drawQrModules(
  ctx: CanvasRenderingContext2D,
  payload: string,
  x: number,
  y: number,
  size: number,
): Promise<void> {
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, payload, {
    width: size,
    margin: 0,
    color: { dark: "#000000", light: "#ffffff" },
  });
  ctx.drawImage(qrCanvas, x, y, size, size);
}

export async function renderPickupWorkLabel(
  ctx: CanvasRenderingContext2D,
  model: PickupWorkLabelModel,
): Promise<void> {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#111";
  ctx.font = font(42, 900);
  ctx.fillText(`PICKUP ${model.documentId}`, PAD, 70, W - PAD * 2);
  drawDashedLine(ctx, 98);

  ctx.font = font(22, 700);
  ctx.fillText(model.itemBarcode || "-", PAD, 140, LEFT_MAX);

  ctx.font = font(34, 900, "sans");
  const itemNameLines = wrapMeasuredText(ctx, model.itemNameEn, LEFT_MAX, 2);
  drawTextLines(ctx, itemNameLines, PAD, 186, 40, LEFT_MAX);
  drawDashedLine(ctx, 372);

  drawOptionBlock(ctx, model.optionLines, PAD, 420, W - PAD * 2, 575);
  drawDashedLine(ctx, 600);

  ctx.font = font(28, 900, "sans");
  const noteLines = wrapMeasuredText(
    ctx,
    model.note || "NO CUSTOMER NOTE",
    W - PAD * 2,
    2,
  );
  drawTextLines(ctx, noteLines, PAD, 650, 36, W - PAD * 2);
  drawDashedLine(ctx, 710);

  ctx.font = font(24, 800);
  const pickupText = dayjsAU(model.pickupStartsAt).format("ddd DD MMM hh:mm A");
  ctx.fillText(model.memberName || "-", PAD, 754, 330);
  ctx.textAlign = "right";
  ctx.fillText(pickupText, W - PAD, 754, 370);
  ctx.textAlign = "left";

  ctx.fillStyle = "#fff";
  ctx.fillRect(
    QR_X - QR_PAD,
    QR_Y - QR_PAD,
    QR_SIZE + QR_PAD * 2,
    QR_SIZE + QR_PAD * 2,
  );
  await drawQrModules(ctx, model.qrPayload, QR_X, QR_Y, QR_SIZE);
}
```

- [ ] **Step 2: Type-check the renderer**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npx tsc --noEmit -p tsconfig.web.json
```

Expected: PASS. If TypeScript reports a `qrcode` import issue, match the existing app pattern with `import QRCode from "qrcode";`.

- [ ] **Step 3: Search for out-of-scope printer work**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "ipcRenderer|electronAPI|zpl|printHistory|printLabel|label:|preload|main/ipc" retail_pos_app/src/renderer/src/libs/pickup-work-label retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx
```

Expected: no matches except a possible lowercase word inside comments if one was added. Do not add comments mentioning future printing in these files.

---

## Task 3: Canvas Preview Component

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`

- [ ] **Step 1: Replace the DOM preview with the canvas host**

Replace `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx` with:

```tsx
import { useEffect, useMemo, useRef } from "react";
import {
  buildPickupWorkLabelModel,
  type PickupWorkLabelModel,
} from "../../libs/pickup-work-label/model";
import {
  PICKUP_WORK_LABEL_CANVAS_SIZE,
  renderPickupWorkLabel,
} from "../../libs/pickup-work-label/render";
import type {
  PickupOrderDetail,
  PickupOrderLine,
} from "./pickup-order-types";

type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
};

export default function PickupOrderWorkLabelPreview({ order, line }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const model = useMemo<PickupWorkLabelModel>(
    () => buildPickupWorkLabelModel(order, line),
    [order, line],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    void renderPickupWorkLabel(ctx, model).catch(() => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111";
      ctx.font = "700 28px Arial, Helvetica, sans-serif";
      ctx.fillText("Label preview unavailable", 36, 72, canvas.width - 72);
    });

    return () => {
      cancelled = true;
    };
  }, [model]);

  return (
    <canvas
      ref={canvasRef}
      width={PICKUP_WORK_LABEL_CANVAS_SIZE}
      height={PICKUP_WORK_LABEL_CANVAS_SIZE}
      aria-label={`Pickup work label preview for ${model.documentId}`}
      className="block max-w-full bg-white shadow-sm"
      style={{ width: "100mm", height: "100mm" }}
    />
  );
}
```

- [ ] **Step 2: Run the model tests again**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: PASS. This confirms the component is still using the model/payload layer covered by tests.

- [ ] **Step 3: Run the app build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: PASS. The build should not touch Electron main/preload or server files for this slice.

- [ ] **Step 4: Search for old DOM label-only content**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "PICKUP WORK ORDER|PREP_CHECKS|QR /|DATA|CUSTOMER NOTE|border-2 border-black" retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx
```

Expected: no matches. The preview is now canvas-rendered, and the fake QR placeholder is gone.

---

## Task 4: Manual Preview QA And Final Verification

**Files:**
- Verify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
- Verify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`
- Verify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`
- Verify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/render.ts`
- Verify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`

- [ ] **Step 1: Run all slice verification commands**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Expected: all three commands pass.

- [ ] **Step 2: Confirm viewer integration stayed thin**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "PickupOrderWorkLabelPreview|buildPickupWorkLabelModel|renderPickupWorkLabel|QRCode|toCanvas" retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx
```

Expected:

```text
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx:...:import PickupOrderWorkLabelPreview from "./PickupOrderWorkLabelPreview";
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx:...:<PickupOrderWorkLabelPreview
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx:...:buildPickupWorkLabelModel
retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx:...:renderPickupWorkLabel
```

There should be no `QRCode` or `toCanvas` matches in `PickupOrderViewer.tsx`.

- [ ] **Step 3: Confirm PP payload option pricing by direct test output**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts --test-name-pattern "option total"
```

Expected: PASS. The decoded QR object contains `"02": [1549, 1449]` and `"03": [1349, 1249]` for base prices `[1299, 1199]`, promo prices `[1099, 999]`, and `optionTotal: 250`.

- [ ] **Step 4: Manually inspect the pickup order detail viewer**

Start the app with the normal dev command:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run dev
```

Manual checks in `/manager/pickup-orders`:

- Short `item.name_en` renders as one measured line.
- Long `item.name_en` wraps to no more than two measured lines with ellipsis if needed.
- `item.barcode` appears as text only, smaller than the item name.
- No outer border is drawn on the label canvas.
- Section dividers are dashed.
- Options are English and receive the largest middle block.
- Many options stop before the next divider and show `+N more`.
- Note renders to no more than two measured lines.
- QR appears on the right side over a clean white rectangular patch.
- Changing the selected line redraws the canvas.
- No print button, print status, print history, or printer selector appears.

- [ ] **Step 5: Review the final diff for scope**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git diff -- retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx retail_pos_app/src/renderer/src/libs/pickup-work-label retail_pos_app/scripts/tests/pickup-work-label-model.test.ts
```

Expected: diff only includes renderer preview/model/render/payload/test work. It should not include server files, Electron main/preload files, ZPL/IPC code, print history, or pickup status mutation.

---

## Completion Checklist

- [ ] `node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts` passes from `retail_pos_app`.
- [ ] `npx tsc --noEmit -p tsconfig.web.json` passes from `retail_pos_app`.
- [ ] `npm run build` passes from `retail_pos_app`.
- [ ] Manual preview QA confirms the canvas layout rules from the spec.
- [ ] Diff remains limited to renderer preview/model/render/payload/test files.
- [ ] No Discord notification is sent unless the user explicitly requests it.

