# Receipt Extra Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually controlled `receipt_extra_footer_text` Store Setting that prints on `SALE` receipts and `SALE` reprints only.

**Architecture:** Store the new text as a nullable local POS `StoreSetting` field and pass it through the existing store settings API. Add one renderer helper for receipt footer line width, normalization, validation, and splitting so the Store Settings UI and receipt renderers share the same 42-column rule. Extend the existing raster and ESC/POS sale receipt print functions with an optional extra footer argument; each renderer decides from `invoice.type` whether to print it.

**Tech Stack:** Prisma 7 generated client, Express 5, React 19, TypeScript, Tailwind CSS, existing raster and ESC/POS receipt builders.

---

## File Structure

- Create `retail_pos_server/prisma/migrations/20260610000000_add_receipt_extra_footer_text/migration.sql`
  - Adds the nullable `StoreSetting.receipt_extra_footer_text` column.
- Modify `retail_pos_server/prisma/schema.prisma`
  - Adds `receipt_extra_footer_text String?` beside `receipt_below_text`.
- Modify `retail_pos_server/src/v1/store/store.service.ts`
  - Accepts and persists the new field through the existing store settings endpoint.
- Modify generated Prisma client files by running `npx prisma generate`
  - Regenerates `retail_pos_server/src/generated/prisma`.
- Create `retail_pos_app/src/renderer/src/libs/receipt-extra-footer.ts`
  - Owns the 42-column width constant, printable-width calculation, validation, normalization, line splitting, and defensive truncation.
- Create `retail_pos_app/scripts/tests/receipt-extra-footer.test.ts`
  - Covers ASCII width, Korean width, blank-line preservation, over-width validation, and blank payload normalization.
- Modify `retail_pos_app/src/renderer/src/types/models.ts`
  - Adds `receipt_extra_footer_text?: string | null` to `StoreSetting`.
- Modify `retail_pos_app/src/renderer/src/screens/StoreSettingScreen/index.tsx`
  - Adds the textarea, validation, save blocking, and payload normalization.
- Modify `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
  - Prints extra footer lines in raster mode and forwards the new argument to ESC/POS mode.
- Modify `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`
  - Prints extra footer lines in command mode.
- Modify receipt call sites:
  - `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`
  - `retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/index.tsx`
  - `retail_pos_app/src/renderer/src/components/PrintLatestInvoiceButton.tsx`
  - `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`

---

### Task 1: Add Server Field And Store API Plumbing

**Files:**
- Create: `retail_pos_server/prisma/migrations/20260610000000_add_receipt_extra_footer_text/migration.sql`
- Modify: `retail_pos_server/prisma/schema.prisma`
- Modify: `retail_pos_server/src/v1/store/store.service.ts`
- Generate: `retail_pos_server/src/generated/prisma`

- [ ] **Step 1: Add the Prisma migration**

Create `retail_pos_server/prisma/migrations/20260610000000_add_receipt_extra_footer_text/migration.sql` with:

```sql
-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN "receipt_extra_footer_text" TEXT;
```

- [ ] **Step 2: Add the schema field**

In `retail_pos_server/prisma/schema.prisma`, update `model StoreSetting` so the receipt fields are:

```prisma
  credit_surcharge_rate      Int?     @default(15) // permille (15 = 1.5%)
  receipt_below_text         String?  @default("Thank you!")
  receipt_extra_footer_text  String?
  user_daily_voucher_default Int      @default(2000)
```

- [ ] **Step 3: Update the store setting DTO**

In `retail_pos_server/src/v1/store/store.service.ts`, update `StoreSettingDTO` to include the new optional field:

```ts
type StoreSettingDTO = {
  name: string;
  phone?: string;
  address1: string;
  address2?: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  abn?: string;
  website?: string;
  email?: string;
  credit_surcharge_rate?: number; // permille (15 = 1.5%)
  receipt_below_text?: string;
  receipt_extra_footer_text?: string | null;
  user_daily_voucher_default?: number; // cents (2000 = $20)
  cash_point_rate?: number; // percent (1 = 10%)
  other_point_rate?: number; // percent (1 = 10%)
};
```

- [ ] **Step 4: Persist the new field**

In `updateStoreSettingService`, add `receipt_extra_footer_text` to the destructure:

```ts
    const {
      name,
      phone,
      address1,
      address2,
      suburb,
      state,
      postcode,
      country,
      abn,
      website,
      email,
      credit_surcharge_rate,
      receipt_below_text,
      receipt_extra_footer_text,
      user_daily_voucher_default,
      cash_point_rate,
      other_point_rate,
    } = dto;
```

Then add it to the Prisma `data` object beside `receipt_below_text`:

```ts
        credit_surcharge_rate,
        receipt_below_text,
        receipt_extra_footer_text,
        user_daily_voucher_default,
```

- [ ] **Step 5: Regenerate Prisma client**

Run:

```bash
cd retail_pos_server && npx prisma generate
```

Expected: Prisma client generation succeeds and updates `retail_pos_server/src/generated/prisma`.

- [ ] **Step 6: Verify the server build**

Run:

```bash
cd retail_pos_server && npm run build
```

Expected: TypeScript build succeeds.

- [ ] **Step 7: Commit server data model changes**

```bash
git add retail_pos_server/prisma/schema.prisma \
  retail_pos_server/prisma/migrations/20260610000000_add_receipt_extra_footer_text/migration.sql \
  retail_pos_server/src/v1/store/store.service.ts \
  retail_pos_server/src/generated/prisma
git commit -m "feat: add receipt extra footer setting"
```

---

### Task 2: Add Shared Receipt Extra Footer Helper

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/receipt-extra-footer.ts`
- Create: `retail_pos_app/scripts/tests/receipt-extra-footer.test.ts`

- [ ] **Step 1: Create the failing helper test**

Create `retail_pos_app/scripts/tests/receipt-extra-footer.test.ts`:

```ts
import assert from "node:assert/strict";

import {
  RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
  normalizeReceiptExtraFooterPayload,
  receiptFooterPrintWidth,
  splitReceiptExtraFooterLines,
  truncateReceiptExtraFooterLine,
  validateReceiptExtraFooterText,
} from "../../src/renderer/src/libs/receipt-extra-footer.ts";

assert.equal(RECEIPT_EXTRA_FOOTER_LINE_WIDTH, 42);
assert.equal(receiptFooterPrintWidth("ABC 123"), 7);
assert.equal(receiptFooterPrintWidth("한글"), 4);
assert.equal(receiptFooterPrintWidth("A한B"), 4);

assert.deepEqual(splitReceiptExtraFooterLines("Line 1\n\nLine 3"), [
  "Line 1",
  "",
  "Line 3",
]);

assert.deepEqual(splitReceiptExtraFooterLines(""), []);
assert.deepEqual(splitReceiptExtraFooterLines("   \n\t"), []);
assert.equal(normalizeReceiptExtraFooterPayload("   \n\t"), undefined);
assert.equal(
  normalizeReceiptExtraFooterPayload("Line 1\r\nLine 2"),
  "Line 1\nLine 2",
);

const valid = validateReceiptExtraFooterText("A".repeat(42) + "\n한글");
assert.equal(valid.ok, true);
assert.deepEqual(valid.errors, []);

const invalid = validateReceiptExtraFooterText("A".repeat(43) + "\nOK");
assert.equal(invalid.ok, false);
assert.deepEqual(invalid.errors, [
  { lineNumber: 1, width: 43, maxWidth: 42 },
]);

assert.equal(truncateReceiptExtraFooterLine("A".repeat(45)), "A".repeat(42));
assert.equal(truncateReceiptExtraFooterLine("한".repeat(30)), "한".repeat(21));

console.log("receipt-extra-footer tests passed");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd retail_pos_app && node --experimental-strip-types scripts/tests/receipt-extra-footer.test.ts
```

Expected: FAIL with `Cannot find module` for `receipt-extra-footer.ts`.

- [ ] **Step 3: Create the helper implementation**

Create `retail_pos_app/src/renderer/src/libs/receipt-extra-footer.ts`:

```ts
export const RECEIPT_EXTRA_FOOTER_LINE_WIDTH = 42;

export type ReceiptExtraFooterValidationError = {
  lineNumber: number;
  width: number;
  maxWidth: number;
};

export type ReceiptExtraFooterValidation = {
  ok: boolean;
  errors: ReceiptExtraFooterValidationError[];
};

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function charPrintWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code <= 0x7e ? 1 : 2;
}

export function receiptFooterPrintWidth(value: string): number {
  let width = 0;
  for (const char of value) width += charPrintWidth(char);
  return width;
}

export function splitReceiptExtraFooterLines(
  value: string | null | undefined,
): string[] {
  if (value == null) return [];

  const normalized = normalizeNewlines(value);
  if (normalized.trim().length === 0) return [];

  return normalized.split("\n");
}

export function normalizeReceiptExtraFooterPayload(
  value: string,
): string | undefined {
  const normalized = normalizeNewlines(value);
  return normalized.trim().length === 0 ? undefined : normalized;
}

export function validateReceiptExtraFooterText(
  value: string,
  maxWidth: number = RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
): ReceiptExtraFooterValidation {
  const normalized = normalizeNewlines(value);
  if (normalized.trim().length === 0) return { ok: true, errors: [] };

  const errors = normalized
    .split("\n")
    .map((line, index) => ({
      lineNumber: index + 1,
      width: receiptFooterPrintWidth(line),
      maxWidth,
    }))
    .filter((line) => line.width > maxWidth);

  return { ok: errors.length === 0, errors };
}

export function truncateReceiptExtraFooterLine(
  value: string,
  maxWidth: number = RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  let output = "";

  for (const char of value) {
    const charWidth = charPrintWidth(char);
    if (width + charWidth > maxWidth) break;
    output += char;
    width += charWidth;
  }

  return output.trimEnd();
}
```

- [ ] **Step 4: Run the helper test to confirm it passes**

Run:

```bash
cd retail_pos_app && node --experimental-strip-types scripts/tests/receipt-extra-footer.test.ts
```

Expected:

```text
receipt-extra-footer tests passed
```

- [ ] **Step 5: Commit the helper and test**

```bash
git add retail_pos_app/src/renderer/src/libs/receipt-extra-footer.ts \
  retail_pos_app/scripts/tests/receipt-extra-footer.test.ts
git commit -m "feat: add receipt footer line validation"
```

---

### Task 3: Add Store Settings Textarea And Validation

**Files:**
- Modify: `retail_pos_app/src/renderer/src/types/models.ts`
- Modify: `retail_pos_app/src/renderer/src/screens/StoreSettingScreen/index.tsx`

- [ ] **Step 1: Add the renderer type field**

In `retail_pos_app/src/renderer/src/types/models.ts`, update `StoreSetting`:

```ts
  credit_surcharge_rate?: number | null; // percent
  receipt_below_text?: string | null;
  receipt_extra_footer_text?: string | null;
  user_daily_voucher_default?: number | null; // cents
```

- [ ] **Step 2: Import footer helpers in Store Settings**

In `retail_pos_app/src/renderer/src/screens/StoreSettingScreen/index.tsx`, add this import:

```ts
import {
  RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
  normalizeReceiptExtraFooterPayload,
  validateReceiptExtraFooterText,
} from "../../libs/receipt-extra-footer";
```

- [ ] **Step 3: Extend the form state**

Replace the current `FormState` type:

```ts
type FormState = Record<FieldKey, string>;
```

with:

```ts
type ExtraFieldKey = "receipt_extra_footer_text";

type FormState = Record<FieldKey | ExtraFieldKey, string>;
```

- [ ] **Step 4: Load and save the new field**

In `settingToForm`, add the new field after `receipt_below_text`:

```ts
    receipt_below_text: s.receipt_below_text ?? "",
    receipt_extra_footer_text: s.receipt_extra_footer_text ?? "",
```

In `formToPayload`, add the normalized payload after `receipt_below_text`:

```ts
    receipt_below_text: form.receipt_below_text || undefined,
    receipt_extra_footer_text: normalizeReceiptExtraFooterPayload(
      form.receipt_extra_footer_text,
    ),
```

- [ ] **Step 5: Add save blocking validation**

Inside `StoreSettingScreen`, after `saving` state, add:

```ts
  const extraFooterValidation = form
    ? validateReceiptExtraFooterText(form.receipt_extra_footer_text)
    : { ok: true, errors: [] };
```

At the start of `onSubmit`, after the store-name check, add:

```ts
    if (!extraFooterValidation.ok) {
      window.alert("Receipt extra footer has lines that are too long");
      return;
    }
```

- [ ] **Step 6: Add textarea change handler**

Update the first import:

```ts
import { ChangeEvent, useCallback, useEffect, useState } from "react";
```

Add this handler near `handleKeyboardChange`:

```ts
  const handleExtraFooterChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (!form) return;
    setForm({
      ...form,
      receipt_extra_footer_text: event.target.value,
    });
  };
```

- [ ] **Step 7: Render the textarea below the existing fields**

Change the left panel wrapper from:

```tsx
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 p-4 content-start">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-500">
                {f.label}
              </label>
              <input
                type="text"
                readOnly
                value={form[f.key]}
                onPointerDown={() => setActiveField(f.key)}
                className={inputClass(f.key)}
              />
            </div>
          ))}
        </div>
```

to:

```tsx
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 p-4 content-start">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-500">
                {f.label}
              </label>
              <input
                type="text"
                readOnly
                value={form[f.key]}
                onPointerDown={() => setActiveField(f.key)}
                className={inputClass(f.key)}
              />
            </div>
          ))}

          <div className="col-span-2 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500">
                Receipt Extra Footer
              </label>
              <span
                className={cn(
                  "text-[11px]",
                  extraFooterValidation.ok ? "text-gray-400" : "text-red-600",
                )}
              >
                Max {RECEIPT_EXTRA_FOOTER_LINE_WIDTH} columns per line
              </span>
            </div>
            <textarea
              value={form.receipt_extra_footer_text}
              onChange={handleExtraFooterChange}
              rows={6}
              className={cn(
                "w-full resize-none rounded-lg border px-3 py-2 font-mono text-sm outline-none",
                extraFooterValidation.ok
                  ? "border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  : "border-red-500 ring-1 ring-red-500",
              )}
            />
            {!extraFooterValidation.ok && (
              <div className="space-y-0.5 text-xs text-red-600">
                {extraFooterValidation.errors.map((error) => (
                  <div key={error.lineNumber}>
                    Line {error.lineNumber}: {error.width}/{error.maxWidth} columns
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
```

- [ ] **Step 8: Verify app TypeScript build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Commit Store Settings UI changes**

```bash
git add retail_pos_app/src/renderer/src/types/models.ts \
  retail_pos_app/src/renderer/src/screens/StoreSettingScreen/index.tsx
git commit -m "feat: edit receipt extra footer setting"
```

---

### Task 4: Print Extra Footer In Raster And ESC/POS Receipts

**Files:**
- Modify: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
- Modify: `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`

- [ ] **Step 1: Import helpers in raster receipt file**

In `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`, add:

```ts
import {
  splitReceiptExtraFooterLines,
  truncateReceiptExtraFooterLine,
} from "../receipt-extra-footer";
```

- [ ] **Step 2: Update `estimateHeight` signature and tail calculation**

Change:

```ts
function estimateHeight(invoice: SaleInvoiceDetail, isCopy: boolean): number {
```

to:

```ts
function estimateHeight(
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  extraFooterText?: string,
): number {
```

Inside `estimateHeight`, after `const isSpend = invoice.type === "SPEND";`, add:

```ts
  const extraFooterLines =
    invoice.type === "SALE" ? splitReceiptExtraFooterLines(extraFooterText) : [];
```

Change:

```ts
  const tail = 8;
```

to:

```ts
  const tail = 8 + extraFooterLines.length;
```

- [ ] **Step 3: Update raster render signature and canvas height**

Change:

```ts
export async function renderSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
): Promise<HTMLCanvasElement> {
```

to:

```ts
export async function renderSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
  extraFooterText?: string,
): Promise<HTMLCanvasElement> {
```

Change:

```ts
  canvas.height = estimateHeight(invoice, isCopy);
```

to:

```ts
  canvas.height = estimateHeight(invoice, isCopy, extraFooterText);
```

- [ ] **Step 4: Draw extra footer lines before QR**

In `renderSaleInvoiceReceipt`, replace this footer section:

```ts
  ctx.fillText(footerLabel, W / 2, y);
  y += LH + 10;

  // QR — 현재 serial placeholder (INV-<id>). serial 활성화 후에도 동일 슬롯.
```

with:

```ts
  ctx.fillText(footerLabel, W / 2, y);
  y += LH;

  const extraFooterLines = isRefund || isSpend
    ? []
    : splitReceiptExtraFooterLines(extraFooterText);
  if (extraFooterLines.length > 0) {
    y += 4;
    for (const line of extraFooterLines) {
      ctx.fillText(truncateReceiptExtraFooterLine(line), W / 2, y);
      y += LH - 6;
    }
  }

  y += 10;

  // QR — 현재 serial placeholder (INV-<id>). serial 활성화 후에도 동일 슬롯.
```

- [ ] **Step 5: Extend raster print function signatures**

Change `printSaleInvoiceReceipt` signature to:

```ts
export async function printSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
  extraFooterText?: string,
): Promise<void> {
```

In the ESC/POS branch options, add:

```ts
      extraFooterText,
```

Change the raster render call to:

```ts
  const canvas = await renderSaleInvoiceReceipt(
    invoice,
    isCopy,
    belowText,
    extraFooterText,
  );
```

Change `printSaleInvoiceReprint` signature to:

```ts
export async function printSaleInvoiceReprint(
  invoice: SaleInvoiceDetail,
  belowText: string = "Thank you!",
  extraFooterText?: string,
): Promise<void> {
```

Change the no-children call to:

```ts
    return printSaleInvoiceReceipt(invoice, true, belowText, extraFooterText);
```

In the ESC/POS chain options, add:

```ts
        extraFooterText,
```

Change raster chain render calls to:

```ts
  canvases.push(
    await renderSaleInvoiceReceipt(invoice, true, belowText, extraFooterText),
  );
  for (const child of children) {
    canvases.push(
      await renderSaleInvoiceReceipt(child, true, belowText, extraFooterText),
    );
  }
```

- [ ] **Step 6: Import helpers in ESC/POS receipt file**

In `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`, add:

```ts
import {
  splitReceiptExtraFooterLines,
  truncateReceiptExtraFooterLine,
} from "../receipt-extra-footer";
```

- [ ] **Step 7: Extend ESC/POS option and function signatures**

Update `BuildSaleInvoiceEscposOptions`:

```ts
export interface BuildSaleInvoiceEscposOptions {
  isCopy?: boolean;
  belowText?: string;
  extraFooterText?: string;
  encoding: ReceiptTextEncoding;
  cut?: boolean;
}
```

Change `appendFooter` signature to:

```ts
async function appendFooter(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  belowText: string,
  extraFooterText?: string,
): Promise<void> {
```

Change `appendSaleInvoiceBody` signature to:

```ts
async function appendSaleInvoiceBody(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  belowText: string,
  extraFooterText?: string,
): Promise<void> {
```

- [ ] **Step 8: Print extra footer lines in ESC/POS mode**

In `appendFooter`, replace:

```ts
  await writer.line();
  writer.align("center");
  await writer.line(centerLine(footerLabel));
  await writer.line();

  const qrPayload = `receipt%%%${invoice.serial ?? `INV-${invoice.id}`}`;
```

with:

```ts
  await writer.line();
  writer.align("center");
  await writer.line(centerLine(footerLabel));

  const extraFooterLines = isRefund || isSpend
    ? []
    : splitReceiptExtraFooterLines(extraFooterText);
  if (extraFooterLines.length > 0) {
    await writer.line();
    for (const line of extraFooterLines) {
      await writer.line(centerLine(truncateReceiptExtraFooterLine(line)));
    }
  }

  await writer.line();

  const qrPayload = `receipt%%%${invoice.serial ?? `INV-${invoice.id}`}`;
```

- [ ] **Step 9: Pass extra footer through ESC/POS body builders**

Change the end of `appendSaleInvoiceBody` to:

```ts
  await appendFooter(writer, invoice, isCopy, belowText, extraFooterText);
}
```

In `buildSaleInvoiceEscposReceipt`, change the `appendSaleInvoiceBody` call to:

```ts
  await appendSaleInvoiceBody(
    writer,
    invoice,
    options.isCopy ?? false,
    options.belowText ?? "Thank you!",
    options.extraFooterText,
  );
```

In `buildSaleInvoiceEscposReceiptChain`, change the `appendSaleInvoiceBody` call to:

```ts
    await appendSaleInvoiceBody(
      writer,
      invoice,
      options.isCopy ?? false,
      options.belowText ?? "Thank you!",
      options.extraFooterText,
    );
```

- [ ] **Step 10: Verify app build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

- [ ] **Step 11: Commit receipt renderer changes**

```bash
git add retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts \
  retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts
git commit -m "feat: print sale receipt extra footer"
```

---

### Task 5: Pass Extra Footer Through Receipt Call Sites And Preview

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
- Modify: `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`
- Modify: `retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/index.tsx`
- Modify: `retail_pos_app/src/renderer/src/components/PrintLatestInvoiceButton.tsx`
- Modify: `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`

- [ ] **Step 1: Update PaymentModal sale and spend print calls**

In `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`, add this local constant near each print call or once near `belowText` use:

```ts
        storeSetting?.receipt_extra_footer_text || undefined,
```

For `handlePrintReceipt`, the call should become:

```ts
      await printSaleInvoiceReceipt(
        detail,
        completedInfo.receiptPrinted,
        storeSetting?.receipt_below_text || undefined,
        storeSetting?.receipt_extra_footer_text || undefined,
      );
```

For `handleSpend`, the call should become:

```ts
          await printSaleInvoiceReceipt(
            detailRes.result,
            false,
            storeSetting?.receipt_below_text || undefined,
            storeSetting?.receipt_extra_footer_text || undefined,
          );
```

The print function ignores the extra footer for `SPEND`, so passing the value here is harmless and keeps the call signature consistent.

- [ ] **Step 2: Update repay print calls**

In `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`, replace:

```ts
      const belowText = storeSetting?.receipt_below_text || undefined;
```

with:

```ts
      const belowText = storeSetting?.receipt_below_text || undefined;
      const extraFooterText =
        storeSetting?.receipt_extra_footer_text || undefined;
```

Then update refund and replacement sale print calls:

```ts
          await printSaleInvoiceReceipt(
            refundDetail,
            false,
            belowText,
            extraFooterText,
          );
```

```ts
          await printSaleInvoiceReceipt(
            newSaleDetail,
            false,
            belowText,
            extraFooterText,
          );
```

In `handleReprint`, update the call to:

```ts
        await printSaleInvoiceReceipt(
          detail,
          true,
          storeSetting?.receipt_below_text || undefined,
          storeSetting?.receipt_extra_footer_text || undefined,
        );
```

- [ ] **Step 3: Update refund detail print call**

In `retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/index.tsx`, update the refund print call:

```ts
          await printSaleInvoiceReceipt(
            detail,
            false,
            storeSetting?.receipt_below_text || undefined,
            storeSetting?.receipt_extra_footer_text || undefined,
          );
```

The print function ignores the extra footer for `REFUND`, preserving the spec.

- [ ] **Step 4: Update latest invoice reprint**

In `retail_pos_app/src/renderer/src/components/PrintLatestInvoiceButton.tsx`, update the reprint call:

```ts
      await printSaleInvoiceReprint(
        res.result,
        storeSetting?.receipt_below_text || undefined,
        storeSetting?.receipt_extra_footer_text || undefined,
      );
```

- [ ] **Step 5: Update invoice viewer print and preview imports**

In `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`, add:

```ts
import { splitReceiptExtraFooterLines } from "../libs/receipt-extra-footer";
```

After `belowText`, add:

```ts
  const extraFooterText = storeSetting?.receipt_extra_footer_text ?? "";
```

Update `handlePrint`:

```ts
      await printSaleInvoiceReprint(invoice, belowText, extraFooterText);
```

Update the preview render:

```tsx
        {invoice && (
          <Receipt
            invoice={invoice}
            belowText={belowText}
            extraFooterText={extraFooterText}
          />
        )}
```

Update the `Receipt` props:

```tsx
function Receipt({
  invoice,
  belowText,
  extraFooterText,
}: {
  invoice: SaleInvoiceDetail;
  belowText: string;
  extraFooterText: string;
}) {
```

Inside `Receipt`, after `const isSpend = invoice.type === "SPEND";`, add:

```ts
  const extraFooterLines =
    invoice.type === "SALE"
      ? splitReceiptExtraFooterLines(extraFooterText)
      : [];
```

Replace the footer preview:

```tsx
      <div className="text-center mt-3 text-gray-500">
        {isSpend
          ? "Internal consumption — no payment"
          : isRefund
            ? "Refund processed"
            : belowText}
      </div>
```

with:

```tsx
      <div className="text-center mt-3 text-gray-500">
        <div>
          {isSpend
            ? "Internal consumption — no payment"
            : isRefund
              ? "Refund processed"
              : belowText}
        </div>
        {extraFooterLines.length > 0 && (
          <div className="mt-2">
            {extraFooterLines.map((line, index) => (
              <div key={index}>{line || "\u00a0"}</div>
            ))}
          </div>
        )}
      </div>
```

- [ ] **Step 6: Verify helper test and app build**

Run:

```bash
cd retail_pos_app && node --experimental-strip-types scripts/tests/receipt-extra-footer.test.ts
```

Expected:

```text
receipt-extra-footer tests passed
```

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: build succeeds.

- [ ] **Step 7: Commit call site and preview changes**

```bash
git add retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx \
  retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx \
  retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/index.tsx \
  retail_pos_app/src/renderer/src/components/PrintLatestInvoiceButton.tsx \
  retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx
git commit -m "feat: pass receipt extra footer to sale prints"
```

---

### Task 6: Final Verification

**Files:**
- Read/verify only unless fixes are required.

- [ ] **Step 1: Confirm no unrelated files are staged**

Run:

```bash
git status --short
```

Expected: only intentional implementation files are modified. Existing user-owned files such as `AGENTS.md` may remain modified but must not be staged unless the user explicitly asks.

- [ ] **Step 2: Run server build**

Run:

```bash
cd retail_pos_server && npm run build
```

Expected: TypeScript build succeeds.

- [ ] **Step 3: Run app helper test**

Run:

```bash
cd retail_pos_app && node --experimental-strip-types scripts/tests/receipt-extra-footer.test.ts
```

Expected:

```text
receipt-extra-footer tests passed
```

- [ ] **Step 4: Run app build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: Electron/Vite build succeeds.

- [ ] **Step 5: Manual verification checklist**

Use the app with a local server database that has the migration applied:

```bash
cd retail_pos_server && npx prisma db push
cd ../retail_pos_app && npm run dev
```

Manual checks:

- Open Store Settings and confirm the `Receipt Extra Footer` textarea appears.
- Enter:

```text
Exchange/refund available with receipt.

냉장/냉동 상품은 당일 문의 바랍니다.
```

- Save, reload Store Settings, and confirm line breaks are preserved.
- Enter 43 ASCII characters on one line and confirm saving is blocked.
- Enter 22 Korean characters on one line and confirm saving is blocked.
- Complete a `SALE` and confirm the extra footer prints between `receipt_below_text` and the QR code.
- Reprint the same `SALE` and confirm the extra footer appears.
- Print a `REFUND` receipt and confirm the extra footer does not appear.
- Print a `SPEND` receipt and confirm the extra footer does not appear.
- Run a repay flow and confirm the refund receipt does not include the extra footer but the replacement sale receipt does.

- [ ] **Step 6: Confirm final repository state**

Run:

```bash
git status --short
```

Expected: implementation commits are complete, intentional changes are clean,
and any user-owned pre-existing changes remain unstaged.
