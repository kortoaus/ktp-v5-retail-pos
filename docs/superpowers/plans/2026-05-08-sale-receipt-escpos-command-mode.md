# Sale Receipt ESC/POS Command Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 영수증에 기존 raster 출력과 새 ESC/POS command 출력을 선택할 수 있는 설정과 출력 경로를 추가한다.

**Architecture:** 기존 raw byte transport인 `printESCPOS()`는 그대로 사용한다. App config에 receipt mode/encoding을 저장하고, sale receipt 함수에서 mode를 읽어 기존 canvas raster builder 또는 새 ESC/POS command builder로 분기한다. Renderer는 Node API를 직접 import하지 않으므로 `cp949/euc-kr` 인코딩은 Electron main IPC에서 `iconv-lite`로 처리한다.

**Tech Stack:** Electron 40, React 19, TypeScript strict, renderer `window.electronAPI`, Electron IPC, existing `iconv-lite`, existing raw ESC/POS printer transport.

---

## Scope Check

이 계획은 승인된 스펙 `docs/superpowers/specs/2026-05-08-sale-receipt-escpos-command-mode-design.md`만 구현한다.

포함:

- 판매 영수증 최초 출력, copy/reprint, refund, repay/reprint chain
- raster mode 유지
- ESC/POS command mode 추가
- QR native ESC/POS command 추가
- `ascii-replace`, `cp949`, `euc-kr` text encoding setting 추가

제외:

- shift settlement/Z-report command mode 전환
- raster 제거
- barcode 출력
- printer-specific Korean code page command UI
- sale/payment/refund 계산 변경

---

## File Structure

- Modify: `retail_pos_app/src/main/types.ts`
  - main/preload config contract의 source of truth에 `ReceiptPrintMode`, `ReceiptTextEncoding`, `TextEncodeRequest`, `DeviceConfig` 필드를 추가한다.

- Modify: `retail_pos_app/src/preload/index.d.ts`
  - renderer가 보는 타입에 같은 receipt config 필드와 `encodeText()` bridge 타입을 추가한다.

- Modify: `retail_pos_app/src/main/store.ts`
  - 기존 config migration/default 처리에 `receiptPrintMode`와 `receiptTextEncoding`을 추가한다.

- Create: `retail_pos_app/src/main/ipc/text-encoding.ts`
  - renderer에서 요청한 text를 `ascii-replace`, `cp949`, `euc-kr` bytes로 변환한다.
  - `cp949/euc-kr`는 기존 `iconv-lite` dependency를 사용한다.

- Modify: `retail_pos_app/src/main/ipc/index.ts`
  - 새 text encoding IPC handler를 등록한다.

- Modify: `retail_pos_app/src/preload/index.ts`
  - `window.electronAPI.encodeText()`를 노출한다.

- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`
  - ESC/POS Printer section에 Receipt Mode와 Text Encoding selector를 추가한다.
  - config load/save에 새 fields를 포함한다.

- Create: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`
  - sale invoice snapshot을 ESC/POS command bytes로 만든다.
  - QR native command와 final cut을 담당한다.

- Modify: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
  - config mode에 따라 기존 raster path 또는 새 command path로 분기한다.
  - reprint chain은 command mode에서 one final cut만 사용한다.

---

## Task 1: Config Types And Migration

**Files:**

- Modify: `retail_pos_app/src/main/types.ts`
- Modify: `retail_pos_app/src/preload/index.d.ts`
- Modify: `retail_pos_app/src/main/store.ts`

- [ ] **Step 1: Extend main config types**

In `retail_pos_app/src/main/types.ts`, add these exports near the existing ESC/POS type aliases:

```ts
export type ReceiptPrintMode = "raster" | "escpos";
export type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";
```

Then update `DeviceConfig`:

```ts
export interface DeviceConfig {
  scale: ScaleConfig | null;
  zplSerial: ZplSerialConfig[];
  zplNet: ZplNetConfig[];
  escposPrinter: EscposPrinterConfig | null;
  receiptPrintMode: ReceiptPrintMode;
  receiptTextEncoding: ReceiptTextEncoding;
}
```

- [ ] **Step 2: Extend preload declaration types**

In `retail_pos_app/src/preload/index.d.ts`, add the same type aliases near the existing ESC/POS type aliases:

```ts
export type ReceiptPrintMode = 'raster' | 'escpos'
export type ReceiptTextEncoding = 'ascii-replace' | 'cp949' | 'euc-kr'
```

Then update `DeviceConfig`:

```ts
export interface DeviceConfig {
  scale: ScaleConfig | null
  zplSerial: ZplSerialConfig[]
  zplNet: ZplNetConfig[]
  escposPrinter: EscposPrinterConfig | null
  receiptPrintMode: ReceiptPrintMode
  receiptTextEncoding: ReceiptTextEncoding
}
```

- [ ] **Step 3: Add defaults and parsers in store**

In `retail_pos_app/src/main/store.ts`, update the type import:

```ts
import type {
  AppConfig,
  EscposPrinterConfig,
  EscposSerialHandshaking,
  EscposSerialParity,
  EscposSerialSettings,
  ReceiptPrintMode,
  ReceiptTextEncoding,
  ZplSerialConfig,
} from './types'
```

Update `DEFAULT_CONFIG`:

```ts
const DEFAULT_CONFIG: AppConfig = {
  server: null,
  devices: {
    scale: null,
    zplSerial: [],
    zplNet: [],
    escposPrinter: null,
    receiptPrintMode: 'raster',
    receiptTextEncoding: 'ascii-replace',
  }
}
```

Add constants after `ESCPOS_HANDSHAKING`:

```ts
const RECEIPT_PRINT_MODES: ReceiptPrintMode[] = ['raster', 'escpos']
const RECEIPT_TEXT_ENCODINGS: ReceiptTextEncoding[] = [
  'ascii-replace',
  'cp949',
  'euc-kr',
]
```

Add parser helpers after `parseBoolean`:

```ts
function parseReceiptPrintMode(value: unknown): ReceiptPrintMode {
  return typeof value === 'string' &&
    RECEIPT_PRINT_MODES.includes(value as ReceiptPrintMode)
    ? (value as ReceiptPrintMode)
    : DEFAULT_CONFIG.devices.receiptPrintMode
}

function parseReceiptTextEncoding(value: unknown): ReceiptTextEncoding {
  return typeof value === 'string' &&
    RECEIPT_TEXT_ENCODINGS.includes(value as ReceiptTextEncoding)
    ? (value as ReceiptTextEncoding)
    : DEFAULT_CONFIG.devices.receiptTextEncoding
}
```

Update the `loadConfig()` return object:

```ts
return {
  server: parsed.server ?? null,
  devices: {
    scale: parsed.devices?.scale ?? null,
    zplSerial: migrateZplSerial(parsed.devices?.zplSerial),
    zplNet: parsed.devices?.zplNet ?? [],
    escposPrinter: migrateEscposPrinter(parsed.devices?.escposPrinter),
    receiptPrintMode: parseReceiptPrintMode(parsed.devices?.receiptPrintMode),
    receiptTextEncoding: parseReceiptTextEncoding(parsed.devices?.receiptTextEncoding),
  }
}
```

- [ ] **Step 4: Build to verify type contract**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build exits 0, with no error about `DeviceConfig` missing `receiptPrintMode` or `receiptTextEncoding`.

- [ ] **Step 5: Commit config contract**

```bash
git add retail_pos_app/src/main/types.ts retail_pos_app/src/preload/index.d.ts retail_pos_app/src/main/store.ts
git commit -m "feat: add receipt print config"
```

---

## Task 2: Text Encoding IPC

**Files:**

- Modify: `retail_pos_app/src/main/types.ts`
- Create: `retail_pos_app/src/main/ipc/text-encoding.ts`
- Modify: `retail_pos_app/src/main/ipc/index.ts`
- Modify: `retail_pos_app/src/preload/index.ts`
- Modify: `retail_pos_app/src/preload/index.d.ts`

- [ ] **Step 1: Add text encoding request type**

In `retail_pos_app/src/main/types.ts`, add:

```ts
export interface TextEncodeRequest {
  text: string;
  encoding: ReceiptTextEncoding;
}
```

In `retail_pos_app/src/preload/index.d.ts`, add:

```ts
export interface TextEncodeRequest {
  text: string
  encoding: ReceiptTextEncoding
}
```

- [ ] **Step 2: Create IPC handler**

Create `retail_pos_app/src/main/ipc/text-encoding.ts`:

```ts
import { ipcMain } from 'electron'
import iconv from 'iconv-lite'
import type { TextEncodeRequest } from '../types'

function encodeAsciiReplace(text: string): number[] {
  const bytes: number[] = []

  for (const char of text) {
    if (char === '\n') {
      bytes.push(0x0a)
      continue
    }
    if (char === '\r') {
      bytes.push(0x0d)
      continue
    }

    const code = char.charCodeAt(0)
    bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f)
  }

  return bytes
}

function encodeText(request: TextEncodeRequest): number[] {
  if (request.encoding === 'ascii-replace') {
    return encodeAsciiReplace(request.text)
  }

  const encoded = iconv.encode(request.text, request.encoding)
  return Array.from(encoded)
}

export function registerTextEncodingHandlers(): void {
  ipcMain.handle('text:encode', (_event, request: TextEncodeRequest) => {
    return encodeText(request)
  })
}
```

- [ ] **Step 3: Register handler**

In `retail_pos_app/src/main/ipc/index.ts`, import and register:

```ts
import { registerTextEncodingHandlers } from './text-encoding'
```

Inside `registerAllHandlers()` after `registerConfigHandlers()`:

```ts
registerTextEncodingHandlers()
```

- [ ] **Step 4: Expose bridge**

In `retail_pos_app/src/preload/index.ts`, add `TextEncodeRequest` to the type import:

```ts
import type {
  AppConfig,
  EscposControlLineMatrixRequest,
  EscposControlLineMatrixResult,
  EscposPrintRequest,
  LabelSendRequest,
  TextEncodeRequest,
  WeightResult,
} from '../main/types'
```

Add to `contextBridge.exposeInMainWorld('electronAPI', { ... })` near config helpers:

```ts
encodeText: (request: TextEncodeRequest): Promise<number[]> =>
  ipcRenderer.invoke('text:encode', request),
```

- [ ] **Step 5: Expose renderer declaration**

In `retail_pos_app/src/preload/index.d.ts`, add to `ElectronAPI`:

```ts
encodeText: (request: TextEncodeRequest) => Promise<number[]>
```

- [ ] **Step 6: Build to verify IPC types**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: no TypeScript errors from main/preload IPC additions.

- [ ] **Step 7: Commit text encoding IPC**

```bash
git add retail_pos_app/src/main/types.ts retail_pos_app/src/main/ipc/text-encoding.ts retail_pos_app/src/main/ipc/index.ts retail_pos_app/src/preload/index.ts retail_pos_app/src/preload/index.d.ts
git commit -m "feat: add receipt text encoding bridge"
```

---

## Task 3: Interface Settings Controls

**Files:**

- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`

- [ ] **Step 1: Add local types and form fields**

Near the existing `EscposSerialHandshaking` alias, add:

```ts
type ReceiptPrintMode = "raster" | "escpos";
type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";
```

Extend `EscposForm`:

```ts
interface EscposForm {
  enabled: boolean;
  type: EscposTransport;
  host: string;
  port: number;
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  parity: EscposSerialParity;
  stopBits: 1 | 2;
  handshaking: EscposSerialHandshaking;
  dtr: boolean;
  rts: boolean;
  receiptPrintMode: ReceiptPrintMode;
  receiptTextEncoding: ReceiptTextEncoding;
}
```

Update `ESCPOS_DEFAULTS`:

```ts
const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  type: "net",
  host: "",
  port: 9100,
  path: "",
  baudRate: 38400,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  handshaking: "dtr-dsr",
  dtr: true,
  rts: true,
  receiptPrintMode: "raster",
  receiptTextEncoding: "ascii-replace",
};
```

- [ ] **Step 2: Add option constants**

After `ESCPOS_HANDSHAKING`, add:

```ts
const RECEIPT_PRINT_MODES: Array<{
  value: ReceiptPrintMode;
  label: string;
}> = [
  { value: "raster", label: "Raster Image" },
  { value: "escpos", label: "ESC/POS Command" },
];

const RECEIPT_TEXT_ENCODINGS: Array<{
  value: ReceiptTextEncoding;
  label: string;
}> = [
  { value: "ascii-replace", label: "ASCII replace" },
  { value: "cp949", label: "CP949" },
  { value: "euc-kr", label: "EUC-KR" },
];
```

- [ ] **Step 3: Load config into form state**

Inside the `if (config.devices.escposPrinter) { ... }` block's `setEscpos((prev) => ({ ... }))`, add these fields at the top-level object:

```ts
receiptPrintMode: config.devices.receiptPrintMode ?? "raster",
receiptTextEncoding: config.devices.receiptTextEncoding ?? "ascii-replace",
```

Also add an `else` after the block so receipt settings load even when the printer is not configured:

```ts
} else {
  setEscpos((prev) => ({
    ...prev,
    receiptPrintMode: config.devices.receiptPrintMode ?? "raster",
    receiptTextEncoding: config.devices.receiptTextEncoding ?? "ascii-replace",
  }));
}
```

- [ ] **Step 4: Save config fields**

In `handleSave()`, inside `devices: { ... }`, add:

```ts
receiptPrintMode: escpos.receiptPrintMode,
receiptTextEncoding: escpos.receiptTextEncoding,
```

The saved `devices` object should include these fields regardless of whether `escpos.enabled` is true. This keeps receipt preferences when an operator temporarily disables the printer.

- [ ] **Step 5: Add UI controls**

In the ESC/POS Printer section, after the Transport selector and before the transport-specific network/serial fields, add:

```tsx
<div className="mb-4 grid grid-cols-2 gap-4">
  <div>
    <label className={labelClass}>Receipt Mode</label>
    <select
      className={selectClass}
      disabled={!escpos.enabled}
      value={escpos.receiptPrintMode}
      onChange={(e) =>
        setEscpos((s) => ({
          ...s,
          receiptPrintMode: e.target.value as ReceiptPrintMode,
        }))
      }
    >
      {RECEIPT_PRINT_MODES.map((mode) => (
        <option key={mode.value} value={mode.value}>
          {mode.label}
        </option>
      ))}
    </select>
  </div>
  <div>
    <label className={labelClass}>Text Encoding</label>
    <select
      className={selectClass}
      disabled={!escpos.enabled}
      value={escpos.receiptTextEncoding}
      onChange={(e) =>
        setEscpos((s) => ({
          ...s,
          receiptTextEncoding: e.target.value as ReceiptTextEncoding,
        }))
      }
    >
      {RECEIPT_TEXT_ENCODINGS.map((encoding) => (
        <option key={encoding.value} value={encoding.value}>
          {encoding.label}
        </option>
      ))}
    </select>
  </div>
</div>
```

- [ ] **Step 6: Build to verify UI types**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: no TypeScript errors in `InterfaceSettingsScreen.tsx`.

- [ ] **Step 7: Commit settings UI**

```bash
git add retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx
git commit -m "feat: add receipt print mode settings"
```

---

## Task 4: ESC/POS Sale Receipt Builder

**Files:**

- Create: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`

- [ ] **Step 1: Create builder module**

Create `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts` with the following implementation. It intentionally mirrors the existing canvas receipt content without changing sale math.

```ts
import type {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
} from "../../service/sale.service";
import dayjsAU from "../dayjsAU";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../constants";
import { cutCommand, initPrinterCommand } from "./escpos";

export type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";

interface BuildSaleInvoiceEscposOptions {
  isCopy?: boolean;
  belowText?: string;
  encoding: ReceiptTextEncoding;
  cut?: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const LINE_CHARS = 48;
const NAME_MAX = 32;

const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const fmtQty = (q: number) => (q / QTY_SCALE).toFixed(QTY_DP);

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

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
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

async function encodeText(
  text: string,
  encoding: ReceiptTextEncoding,
): Promise<Uint8Array> {
  if (encoding === "ascii-replace") return asciiReplace(text);
  const encoded = await window.electronAPI.encodeText({ text, encoding });
  return new Uint8Array(encoded);
}

function sanitizeLayoutText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function center(text: string, width = LINE_CHARS): string {
  const value = sanitizeLayoutText(text);
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  return " ".repeat(left) + value;
}

function leftRight(left: string, right: string, width = LINE_CHARS): string {
  const l = sanitizeLayoutText(left);
  const r = sanitizeLayoutText(right);
  const space = width - l.length - r.length;
  if (space <= 1) {
    return `${l.slice(0, Math.max(1, width - r.length - 1))} ${r}`.slice(0, width);
  }
  return l + " ".repeat(space) + r;
}

function wrapText(text: string, max: number): string[] {
  const value = sanitizeLayoutText(text);
  if (value.length <= max) return [value];
  const lines: string[] = [];
  let rest = value;
  while (rest.length > max) {
    let breakAt = rest.lastIndexOf(" ", max);
    if (breakAt <= 0) breakAt = max;
    lines.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

function summarisePayments(payments: SaleInvoicePaymentItem[]) {
  const byTender = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + p.amount;
    return acc;
  }, {});
  return {
    cashPaid: byTender.CASH ?? 0,
    creditPaid: byTender.CREDIT ?? 0,
    voucherPaid: byTender.VOUCHER ?? 0,
    giftcardPaid: byTender.GIFTCARD ?? 0,
    voucherPayments: payments.filter((p) => p.type === "VOUCHER"),
  };
}

function qrCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  const storeLength = data.length + 3;
  const pL = storeLength & 0xff;
  const pH = (storeLength >> 8) & 0xff;

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

class EscposWriter {
  private readonly parts: Uint8Array[] = [];

  constructor(private readonly encoding: ReceiptTextEncoding) {}

  raw(data: Uint8Array): void {
    this.parts.push(data);
  }

  async text(value: string): Promise<void> {
    this.parts.push(await encodeText(value, this.encoding));
  }

  async line(value = ""): Promise<void> {
    await this.text(`${value}\n`);
  }

  async divider(): Promise<void> {
    await this.line("-".repeat(LINE_CHARS));
  }

  align(mode: "left" | "center" | "right"): void {
    const value = mode === "left" ? 0 : mode === "center" ? 1 : 2;
    this.raw(bytes([ESC, 0x61, value]));
  }

  bold(enabled: boolean): void {
    this.raw(bytes([ESC, 0x45, enabled ? 1 : 0]));
  }

  size(mode: "normal" | "double-height"): void {
    this.raw(bytes([GS, 0x21, mode === "double-height" ? 0x01 : 0x00]));
  }

  feed(lines: number): void {
    this.raw(bytes([ESC, 0x64, lines]));
  }

  buffer(): Uint8Array {
    return concatBytes(this.parts);
  }
}

async function appendSaleInvoiceBody(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  belowText: string,
): Promise<void> {
  const isRefund = invoice.type === "REFUND";
  const isSpend = invoice.type === "SPEND";
  const headerLabel = isRefund
    ? "*** REFUND ***"
    : isSpend
      ? "*** INTERNAL ***"
      : invoice.abn
        ? `TAX INVOICE - ABN ${invoice.abn}`
        : "TAX INVOICE";

  writer.align("center");
  writer.bold(true);
  writer.size("double-height");
  await writer.line(center(invoice.companyName));
  writer.size("normal");
  writer.bold(false);

  for (const line of [
    invoice.address1,
    invoice.address2,
    [invoice.suburb, invoice.state, invoice.postcode].filter(Boolean).join(" "),
  ]) {
    if (line) await writer.line(center(line));
  }

  writer.bold(true);
  await writer.line(center(headerLabel));
  writer.bold(false);
  if (invoice.phone) await writer.line(center(`Ph: ${invoice.phone}`));
  await writer.line();

  writer.align("left");
  await writer.divider();
  const serialDisplay = invoice.serial ?? `#${invoice.id}`;
  await writer.line(
    leftRight(
      isRefund ? "Refund Invoice" : isSpend ? "Spend Doc" : "Invoice",
      serialDisplay,
    ),
  );
  if (isRefund && invoice.originalInvoiceId != null) {
    await writer.line(leftRight("Original Invoice", `#${invoice.originalInvoiceId}`));
  }
  await writer.line(
    leftRight("Date", dayjsAU(invoice.createdAt).format("ddd, DD MMM YYYY hh:mm A")),
  );
  await writer.line(leftRight("Terminal", invoice.terminalName ?? "-"));
  await writer.line(leftRight("Cashier", invoice.userName ?? "-"));
  if (invoice.memberName) {
    const memberLabel =
      invoice.memberLevel != null
        ? `${invoice.memberName} (L${invoice.memberLevel})`
        : invoice.memberName;
    await writer.line(leftRight("Member", memberLabel));
  }

  await writer.divider();

  for (const r of invoice.rows) {
    const priceChanged = r.unit_price_effective !== r.unit_price_original;
    const prefix = (priceChanged ? "^" : "") + (r.taxable ? "#" : "");
    for (const line of wrapText(prefix + r.name_en, NAME_MAX)) {
      await writer.line(line);
    }

    let qtyStr: string;
    if (r.type === "WEIGHT_PREPACKED") {
      qtyStr = `1 @ ${fmt(r.total)}`;
    } else if (r.measured_weight !== null && r.measured_weight > 0) {
      qtyStr = `${fmtQty(r.measured_weight)}${r.uom} @ ${fmt(r.unit_price_effective)}/${r.uom}`;
    } else {
      qtyStr = `${fmtQty(r.qty)} @ ${fmt(r.unit_price_effective)}`;
    }

    let totalStr = isSpend ? "-" : fmt(r.total);
    if (priceChanged && !isSpend) {
      qtyStr += ` (was ${fmt(r.unit_price_original)})`;
      const originalTotal = Math.round((r.unit_price_original * r.qty) / QTY_SCALE);
      const saved = originalTotal - r.total;
      if (saved > 0) totalStr = `(!${fmt(saved)}) ${totalStr}`;
    }

    await writer.line(leftRight(`  ${qtyStr}`, totalStr));
  }

  if (!isSpend) {
    await writer.divider();
    await writer.line(leftRight(`${invoice.rows.length} SUBTOTAL`, fmt(invoice.linesTotal)));
    if (invoice.creditSurchargeAmount > 0) {
      await writer.line(leftRight("Card Surcharge", `+${fmt(invoice.creditSurchargeAmount)}`));
    }
    if (invoice.rounding !== 0) {
      const sign = invoice.rounding > 0 ? "+" : "-";
      await writer.line(leftRight("Rounding", `${sign}${fmt(invoice.rounding)}`));
    }

    await writer.divider();
    writer.bold(true);
    writer.size("double-height");
    await writer.line(leftRight(isRefund ? "REFUND TOTAL" : "TOTAL", fmt(invoice.total)));
    writer.size("normal");
    writer.bold(false);

    await writer.divider();
    const { cashPaid, creditPaid, voucherPaid, giftcardPaid, voucherPayments } =
      summarisePayments(invoice.payments);

    if (cashPaid > 0) {
      if (isRefund) {
        await writer.line(leftRight("Cash Refunded", fmt(cashPaid)));
      } else {
        await writer.line(leftRight("Cash Received", fmt(cashPaid + invoice.cashChange)));
        await writer.line(leftRight("Cash Paid", fmt(cashPaid)));
      }
    }
    if (!isRefund && invoice.cashChange > 0) {
      await writer.line(leftRight("Change", fmt(invoice.cashChange)));
    }
    if (creditPaid > 0) {
      await writer.line(leftRight(isRefund ? "Credit Refunded" : "Credit Paid", fmt(creditPaid)));
    }
    if (voucherPaid > 0) {
      await writer.line(leftRight(isRefund ? "Voucher Refunded" : "Voucher Paid", fmt(voucherPaid)));
    }
    if (giftcardPaid > 0) {
      await writer.line(leftRight(isRefund ? "Gift Card Refunded" : "Gift Card Paid", fmt(giftcardPaid)));
    }

    await writer.divider();
    const tax = invoice.lineTax + invoice.surchargeTax;
    const totalSaved = invoice.rows.reduce((sum, r) => {
      if (r.unit_price_effective >= r.unit_price_original) return sum;
      const original = Math.round((r.unit_price_original * r.qty) / QTY_SCALE);
      return sum + (original - r.total);
    }, 0);
    await writer.line(leftRight("GST Included", fmt(tax)));
    if (totalSaved > 0) await writer.line(leftRight("You Saved", fmt(totalSaved)));
    if (!isRefund && invoice.type === "SALE" && invoice.pointsEarned > 0) {
      await writer.line(leftRight("Points Earned", invoice.pointsEarned.toLocaleString()));
    }

    if (voucherPayments.length > 0) {
      await writer.divider();
      await writer.line(isRefund ? "Vouchers Refunded" : "Vouchers Used");
      for (const payment of voucherPayments) {
        await writer.line(leftRight(`  ${payment.entityLabel ?? "Voucher"}`, fmt(payment.amount)));
      }
    }

    await writer.divider();
    await writer.line("^ = price changed  # = GST applicable");
    await writer.line("! = Saved");
  }

  await writer.line();
  writer.align("center");
  const footerLabel = isSpend
    ? "Internal consumption - no payment"
    : isRefund
      ? "Refund processed"
      : belowText;
  await writer.line(center(footerLabel));
  await writer.line();

  const qrPayload = `receipt%%%${invoice.serial ?? `INV-${invoice.id}`}`;
  writer.raw(qrCommand(qrPayload));
  await writer.line();
  await writer.line();

  if (isCopy) {
    writer.bold(true);
    await writer.line(center("** COPY **"));
    writer.bold(false);
  }

  await writer.line(center(`Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`));
  writer.align("left");
}

export async function buildSaleInvoiceEscposReceipt(
  invoice: SaleInvoiceDetail,
  options: BuildSaleInvoiceEscposOptions,
): Promise<Uint8Array> {
  const writer = new EscposWriter(options.encoding);
  writer.raw(initPrinterCommand());
  await appendSaleInvoiceBody(
    writer,
    invoice,
    options.isCopy ?? false,
    options.belowText ?? "Thank you!",
  );
  writer.feed(3);
  if (options.cut ?? true) writer.raw(cutCommand(3));
  return writer.buffer();
}

export async function buildSaleInvoiceEscposReceiptChain(
  invoices: SaleInvoiceDetail[],
  options: Omit<BuildSaleInvoiceEscposOptions, "cut">,
): Promise<Uint8Array> {
  if (invoices.length === 0) return new Uint8Array(0);

  const writer = new EscposWriter(options.encoding);
  writer.raw(initPrinterCommand());
  for (const [index, invoice] of invoices.entries()) {
    if (index > 0) {
      writer.feed(3);
      await writer.divider();
      writer.feed(1);
    }
    await appendSaleInvoiceBody(
      writer,
      invoice,
      options.isCopy ?? false,
      options.belowText ?? "Thank you!",
    );
  }
  writer.feed(3);
  writer.raw(cutCommand(3));
  return writer.buffer();
}
```

- [ ] **Step 2: Build to catch renderer typing issues**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: no TypeScript errors from `sale-invoice-escpos.ts`. If line wrapping creates prettier differences, do not change behavior while formatting.

- [ ] **Step 3: Commit builder**

```bash
git add retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts
git commit -m "feat: build sale receipts with escpos commands"
```

---

## Task 5: Wire Sale Receipt Mode Selection

**Files:**

- Modify: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`

- [ ] **Step 1: Import command builder**

Update imports in `sale-invoice-receipt.ts`:

```ts
import {
  buildSaleInvoiceEscposReceipt,
  buildSaleInvoiceEscposReceiptChain,
} from "./sale-invoice-escpos";
import type { ReceiptTextEncoding } from "./sale-invoice-escpos";
```

- [ ] **Step 2: Add config helper**

Add near the top-level helper functions:

```ts
type ReceiptPrintMode = "raster" | "escpos";

async function getReceiptPrintConfig(): Promise<{
  mode: ReceiptPrintMode;
  encoding: ReceiptTextEncoding;
}> {
  const config = await window.electronAPI.getConfig();
  return {
    mode: config.devices.receiptPrintMode ?? "raster",
    encoding: config.devices.receiptTextEncoding ?? "ascii-replace",
  };
}
```

- [ ] **Step 3: Branch single receipt print**

Replace `printSaleInvoiceReceipt()` with:

```ts
export async function printSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
): Promise<void> {
  const receiptConfig = await getReceiptPrintConfig();

  if (receiptConfig.mode === "escpos") {
    const buffer = await buildSaleInvoiceEscposReceipt(invoice, {
      isCopy,
      belowText,
      encoding: receiptConfig.encoding,
      cut: true,
    });
    await printESCPOS(buffer);
    return;
  }

  const canvas = await renderSaleInvoiceReceipt(invoice, isCopy, belowText);
  const buffer = buildPrintBuffer(canvas);
  await printESCPOS(buffer);
}
```

- [ ] **Step 4: Branch reprint chain**

In `printSaleInvoiceReprint()`, keep the children fetch as-is. Replace the body after `children` is computed with:

```ts
const receiptConfig = await getReceiptPrintConfig();

if (children.length === 0) {
  return printSaleInvoiceReceipt(invoice, true, belowText);
}

if (receiptConfig.mode === "escpos") {
  const buffer = await buildSaleInvoiceEscposReceiptChain(
    [invoice, ...children],
    {
      isCopy: true,
      belowText,
      encoding: receiptConfig.encoding,
    },
  );
  await printESCPOS(buffer);
  return;
}

const canvases: HTMLCanvasElement[] = [];
canvases.push(await renderSaleInvoiceReceipt(invoice, true, belowText));
for (const child of children) {
  canvases.push(await renderSaleInvoiceReceipt(child, true, belowText));
}

const buffer = buildMultiReceiptBuffer(canvases);
await printESCPOS(buffer);
```

- [ ] **Step 5: Build to verify integration**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: no TypeScript errors from receipt imports, global `window.electronAPI`, or builder async calls.

- [ ] **Step 6: Commit receipt wiring**

```bash
git add retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts
git commit -m "feat: select sale receipt print mode"
```

---

## Task 6: Manual Verification Pass

**Files:**

- No code files expected.
- Update this plan's checkboxes while executing.

- [ ] **Step 1: Final build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build exits 0.

- [ ] **Step 2: Confirm no unintended server changes**

Run:

```bash
git status --short
```

Expected: only intentional plan checkbox changes or no changes. No `retail_pos_server` files should be modified.

- [ ] **Step 3: Interface Settings manual check**

Run the app:

```bash
cd retail_pos_app && npm run dev
```

Expected:

- `/manager/settings` opens.
- ESC/POS Printer section has `Receipt Mode` and `Text Encoding`.
- Existing config defaults to `Raster Image` and `ASCII replace`.
- Saving does not clear network/serial ESC/POS printer fields.
- Switching to `ESC/POS Command` and `CP949` persists after app reload.

- [ ] **Step 4: Raster receipt smoke check**

Set `Receipt Mode` to `Raster Image`.

Expected:

- Completing or reprinting a sale receipt still follows the existing canvas raster output.
- No new alert appears when using the previously configured printer.

- [ ] **Step 5: ESC/POS command receipt smoke check**

Set `Receipt Mode` to `ESC/POS Command` and `Text Encoding` to `ASCII replace`.

Expected physical output:

- company/store header prints as text.
- invoice/date/terminal/cashier/member section prints.
- item rows print with English names and right-aligned totals.
- subtotal, surcharge, rounding, total, tender, GST, saved, points sections print.
- QR code prints and scans as `receipt%%%...`.
- paper cuts once.
- Korean member name appears as `?` replacement text instead of blocking output.

- [ ] **Step 6: Reprint chain smoke check**

Use an invoice with children, such as SALE with REFUND or repay chain.

Expected physical output in ESC/POS command mode:

- parent and children print in order.
- each document is visually separated.
- there is one final cut at the end.
- copy marker appears on every receipt body in the chain.

- [ ] **Step 7: Commit verification checkbox updates if this plan file was modified**

If checkboxes in this plan were updated during execution:

```bash
git add docs/superpowers/plans/2026-05-08-sale-receipt-escpos-command-mode.md
git commit -m "docs: update escpos receipt implementation checklist"
```

If no plan checkboxes were changed, skip this commit.

---

## Self-Review

- Spec coverage:
  - Mode setting is covered by Task 1 and Task 3.
  - Encoding setting and future Korean-capable printer path are covered by Task 1, Task 2, Task 3, and Task 4.
  - Native ESC/POS QR is covered by Task 4.
  - Sale receipt first print and reprint chain are covered by Task 5.
  - Raster fallback is preserved in Task 5.
  - Shift settlement is untouched by all tasks.

- Completeness scan:
  - No red-flag filler text or unspecified implementation steps are intentionally left.
  - Follow-up items from the spec are not part of this plan.

- Type consistency:
  - `ReceiptPrintMode` uses `"raster" | "escpos"` in main, preload, and renderer.
  - `ReceiptTextEncoding` uses `"ascii-replace" | "cp949" | "euc-kr"` in main, preload, renderer, and IPC.
  - IPC bridge method name is `encodeText` in preload implementation, preload declaration, and renderer builder.
