# Barcode Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Home Tools utility that previews an entered string as DataMatrix, QR Code, or Code128 and prints it through ESC/POS barcode commands only.

**Architecture:** Keep the native boundary unchanged: renderer builds ESC/POS bytes and calls the existing `printESCPOS()` helper. Add one pure command builder for receipt-printer barcode slips, one renderer screen for input/preview/print, and route/Home wiring. The preview may use browser rendering libraries, but the print payload must not use raster canvas conversion.

**Tech Stack:** React 19, HashRouter, Tailwind CSS, `bwip-js/browser`, `qrcode`, existing ESC/POS helpers in `retail_pos_app/src/renderer/src/libs/printer`.

---

## File Structure

- Create `retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts`
  - Owns barcode type definitions and ESC/POS command generation.
  - Exports `BARCODE_TYPES`, `BarcodeSlipType`, `buildBarcodeSlipEscpos()`, and helper validation.
- Create `retail_pos_app/src/renderer/src/screens/BarcodePrintScreen.tsx`
  - Owns the screen state, browser preview, print button state, and call to `printESCPOS()`.
- Modify `retail_pos_app/src/renderer/src/App.tsx`
  - Imports the new screen and registers `/barcode-print`.
- Modify `retail_pos_app/src/renderer/src/screens/HomeScreen.tsx`
  - Adds the Home Tools button next to `Price Tag`.

---

### Task 1: Add ESC/POS Barcode Slip Builder

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts`

- [ ] **Step 1: Create the builder file**

Add this file:

```ts
import { cutCommand, initPrinterCommand } from "./escpos";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const BARCODE_TYPES = ["datamatrix", "qrcode", "code128"] as const;

export type BarcodeSlipType = (typeof BARCODE_TYPES)[number];

export interface BuildBarcodeSlipEscposOptions {
  type: BarcodeSlipType;
  value: string;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer;
}

function asciiReplace(text: string): Uint8Array {
  const output: number[] = [];
  for (const char of text) {
    if (char === "\n") {
      output.push(LF);
      continue;
    }

    const code = char.charCodeAt(0);
    output.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(output);
}

function commandLengthBytes(length: number): [number, number] {
  return [length & 0xff, (length >> 8) & 0xff];
}

function qrCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  const [pL, pH] = commandLengthBytes(data.length + 3);

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

function code128Command(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  if (data.length === 0) throw new Error("Barcode value is empty");
  if (data.length > 255) throw new Error("Code128 value is too long");

  return concatBytes([
    bytes([GS, 0x68, 0x70]),
    bytes([GS, 0x77, 0x03]),
    bytes([GS, 0x48, 0x02]),
    bytes([GS, 0x6b, 0x49, data.length + 2, 0x7b, 0x42]),
    data,
  ]);
}

function dataMatrixCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  if (data.length === 0) throw new Error("Barcode value is empty");

  const [pL, pH] = commandLengthBytes(data.length + 3);

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x32, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x32, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x32, 0x51, 0x30]),
  ]);
}

function barcodeCommand(type: BarcodeSlipType, value: string): Uint8Array {
  if (type === "qrcode") return qrCommand(value);
  if (type === "code128") return code128Command(value);
  return dataMatrixCommand(value);
}

export function normalizeBarcodeValue(value: string): string {
  return value.trim();
}

export function buildBarcodeSlipEscpos(
  options: BuildBarcodeSlipEscposOptions,
): Uint8Array {
  const value = normalizeBarcodeValue(options.value);
  if (!value) throw new Error("Barcode value is empty");

  const humanText = asciiReplace(`${value}\n`);

  return concatBytes([
    initPrinterCommand(),
    bytes([ESC, 0x61, 0x01]),
    barcodeCommand(options.type, value),
    bytes([ESC, 0x64, 0x01]),
    humanText,
    bytes([ESC, 0x64, 0x03]),
    cutCommand(3),
  ]);
}
```

- [ ] **Step 2: Run TypeScript build to catch command-builder errors**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build may still fail because the screen and route are not added yet only if imports are changed elsewhere; after this isolated file it should pass.

---

### Task 2: Add Barcode Print Screen

**Files:**
- Create: `retail_pos_app/src/renderer/src/screens/BarcodePrintScreen.tsx`

- [ ] **Step 1: Create the screen**

Add this file:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import bwipjs from "bwip-js/browser";
import QRCode from "qrcode";
import { cn } from "../libs/cn";
import {
  BARCODE_TYPES,
  BarcodeSlipType,
  buildBarcodeSlipEscpos,
  normalizeBarcodeValue,
} from "../libs/printer/barcode-slip-escpos";
import { printESCPOS } from "../libs/printer/print.service";

const TYPE_LABEL: Record<BarcodeSlipType, string> = {
  datamatrix: "DataMatrix",
  qrcode: "QR Code",
  code128: "Code128",
};

const TYPE_HELP: Record<BarcodeSlipType, string> = {
  datamatrix: "Printer support depends on receipt-printer firmware.",
  qrcode: "Best for long text and receipt lookup payloads.",
  code128: "Best for short ASCII item or reference codes.",
};

export default function BarcodePrintScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [value, setValue] = useState("");
  const [type, setType] = useState<BarcodeSlipType>("qrcode");
  const [previewError, setPreviewError] = useState("");
  const [printing, setPrinting] = useState(false);

  const normalizedValue = useMemo(() => normalizeBarcodeValue(value), [value]);
  const canPrint = normalizedValue.length > 0 && !previewError && !printing;

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setPreviewError("");

      if (!normalizedValue) {
        ctx.fillStyle = "#9ca3af";
        ctx.font = "18px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Enter text to preview", canvas.width / 2, canvas.height / 2);
        return;
      }

      try {
        if (type === "qrcode") {
          await QRCode.toCanvas(canvas, normalizedValue, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 260,
            color: { dark: "#000000", light: "#ffffff" },
          });
        } else {
          await bwipjs.toCanvas(canvas, {
            bcid: type === "datamatrix" ? "datamatrix" : "code128",
            text: normalizedValue,
            scale: type === "datamatrix" ? 5 : 3,
            height: type === "code128" ? 26 : 18,
            includetext: false,
            paddingwidth: 8,
            paddingheight: 8,
            backgroundcolor: "FFFFFF",
          });
        }

        if (!cancelled) setPreviewError("");
      } catch (err) {
        if (!cancelled) {
          setPreviewError(
            err instanceof Error ? err.message : "Failed to render preview",
          );
        }
      }
    }

    renderPreview();

    return () => {
      cancelled = true;
    };
  }, [normalizedValue, type]);

  const handlePrint = async () => {
    if (!canPrint) return;

    setPrinting(true);
    try {
      const data = buildBarcodeSlipEscpos({ type, value: normalizedValue });
      await printESCPOS(data);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to print barcode");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="h-full w-full bg-gray-100 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Barcode Print</h1>
      </div>

      <div className="flex-1 grid grid-cols-[minmax(320px,420px)_1fr] gap-4 p-4">
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Text
            </span>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-36 rounded-lg border border-gray-300 px-3 py-2 text-lg text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
              autoFocus
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Barcode Type
            </span>
            <div className="grid grid-cols-3 gap-2">
              {BARCODE_TYPES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onPointerDown={() => setType(item)}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-semibold transition-colors",
                    type === item
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {TYPE_LABEL[item]}
                </button>
              ))}
            </div>
            <p className="min-h-5 text-xs text-gray-500">{TYPE_HELP[type]}</p>
          </div>

          <button
            type="button"
            disabled={!canPrint}
            onPointerDown={handlePrint}
            className={cn(
              "mt-auto h-14 rounded-lg text-base font-bold transition-colors",
              canPrint
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-400",
            )}
          >
            {printing ? "Printing..." : "Print"}
          </button>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Preview
            </span>
            <span className="text-sm font-medium text-gray-500">
              {TYPE_LABEL[type]}
            </span>
          </div>

          <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center p-6">
            <div className="bg-white border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-5">
              <canvas
                ref={canvasRef}
                width={320}
                height={260}
                className="max-w-full h-auto"
              />
              <div className="w-80 max-w-full text-center text-base font-medium text-gray-900 break-words">
                {normalizedValue || "-"}
              </div>
            </div>
          </div>

          {previewError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {previewError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript build to catch screen errors**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build fails only because the new screen is not routed yet if the bundler does not include it; otherwise it passes.

---

### Task 3: Wire Route and Home Button

**Files:**
- Modify: `retail_pos_app/src/renderer/src/App.tsx`
- Modify: `retail_pos_app/src/renderer/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Add route import and route**

In `retail_pos_app/src/renderer/src/App.tsx`, add:

```ts
import BarcodePrintScreen from "./screens/BarcodePrintScreen";
```

Then add this route near `/price-tag`:

```tsx
<Route path="/barcode-print" element={<BarcodePrintScreen />} />
```

- [ ] **Step 2: Add Home Tools button**

In `retail_pos_app/src/renderer/src/screens/HomeScreen.tsx`, add `IoBarcodeOutline` to the `react-icons/io5` import:

```ts
IoBarcodeOutline,
```

Then add this button immediately after the `Price Tag` button:

```tsx
<NavBtn
  to="/barcode-print"
  icon={<IoBarcodeOutline size={24} />}
  className="bg-amber-50 text-amber-800 hover:bg-amber-100"
>
  Barcode Print
</NavBtn>
```

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS.

---

### Task 4: Manual Verification

**Files:**
- Verify: `retail_pos_app/src/renderer/src/screens/BarcodePrintScreen.tsx`
- Verify: `retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts`

- [ ] **Step 1: Confirm build output**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS with renderer, main, and preload bundles built.

- [ ] **Step 2: Inspect print path for raster avoidance**

Run:

```bash
rg -n "buildPrintBuffer|canvasToEscposRaster|buildPrintBufferNoCut|buildMultiReceiptBuffer" retail_pos_app/src/renderer/src/screens/BarcodePrintScreen.tsx retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts
```

Expected: no matches.

- [ ] **Step 3: Inspect route and Home wiring**

Run:

```bash
rg -n "barcode-print|BarcodePrint" retail_pos_app/src/renderer/src/App.tsx retail_pos_app/src/renderer/src/screens/HomeScreen.tsx
```

Expected: shows the route, import, and Home button.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts retail_pos_app/src/renderer/src/screens/BarcodePrintScreen.tsx retail_pos_app/src/renderer/src/App.tsx retail_pos_app/src/renderer/src/screens/HomeScreen.tsx
git commit -m "Add barcode print screen"
```

Expected: commit succeeds with only the barcode print implementation files.

---

## Self-Review

- Spec coverage: the plan covers Home Tools entry, `/barcode-print`, text input, preview, type selector, print button, ESC/POS-only print payload, human-readable text below the symbol, existing `printESCPOS()` reuse, and build/manual verification.
- Placeholder scan: no placeholder steps remain; every code task includes the concrete code or exact edits.
- Type consistency: `BarcodeSlipType`, `BARCODE_TYPES`, `normalizeBarcodeValue()`, and `buildBarcodeSlipEscpos()` are defined in Task 1 and used with the same names in Task 2.
