# Receipt Extra Footer Design

## Goal

Add a manually controlled multi-line footer for sale receipts.

The existing `receipt_below_text` remains the short one-line footer, such as
`Thank you!`. The new field is a separate Store Setting named
`receipt_extra_footer_text`, intended for longer customer-facing text such as
exchange policy, refund notes, promotional copy, or store notices.

## Scope

The extra footer prints only on sale receipts:

- Original `SALE` receipt: print the extra footer.
- Reprinted or copy `SALE` receipt: print the extra footer.
- Repay replacement `SALE` receipt: print the extra footer.
- `REFUND` receipt: do not print the extra footer.
- Repay refund receipt: do not print the extra footer.
- `SPEND` receipt: do not print the extra footer.
- Shift settlement / Z-report receipts: no change.

## Data Model

Add `receipt_extra_footer_text` to `StoreSetting`.

Prisma field:

```prisma
receipt_extra_footer_text String?
```

The field is nullable and has no default. Existing stores therefore keep their
current receipt output until a manager explicitly enters extra footer text.

The local store API must accept and return the field through the existing
store setting DTO. The renderer `StoreSetting` type must expose it as:

```ts
receipt_extra_footer_text?: string | null;
```

Historical invoices do not snapshot this setting. This follows the current
`receipt_below_text` behavior: receipt reprints use the current Store Setting.

## Store Setting UI

Add one textarea to Store Settings for `receipt_extra_footer_text`.

The editor must preserve manual line breaks. Operators control receipt lines by
pressing Enter in the textarea. The app must not auto-wrap the saved text into
extra logical lines.

Validation rules:

- Split the textarea value on `\n`.
- Preserve empty lines.
- Validate each physical line against the receipt command-mode width:
  `42` printable columns.
- ASCII printable characters count as width `1`.
- Non-ASCII characters, including Korean, count as width `2`.
- If any line exceeds width `42`, show a line-specific validation message and
  block saving.
- Whitespace-only total content must be saved as `null` or omitted from the
  payload, matching existing optional Store Setting patterns.

The UI may show a compact receipt-line preview or line-width hints, but the
required behavior is validation and manual line preservation.

## Receipt Rendering

The extra footer prints between the existing short footer line and the receipt
QR code.

Example layout:

```text
Thank you!

Exchange/refund available with receipt.
Chilled/frozen items: same-day inquiry only.

[QR CODE]
Printed: 10/06/2026 03:45 PM
```

Rendering rules:

- Print the existing footer label first:
  - `SALE`: current `receipt_below_text`, falling back to `Thank you!`.
  - `REFUND`: `Refund processed`.
  - `SPEND`: `Internal consumption - no payment`.
- For `SALE` receipts only, print `receipt_extra_footer_text` lines after the
  existing footer label and before the QR code.
- Preserve blank lines from `receipt_extra_footer_text`.
- Do not auto-wrap extra footer lines during printing.
- Because Store Settings blocks over-width lines, the receipt renderer may
  truncate defensively if corrupt or legacy data exceeds the print width.
- Center-align extra footer lines, matching the current footer treatment.

Both receipt print paths must support the field:

- Raster image receipt renderer in
  `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`.
- ESC/POS command receipt builder in
  `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`.

The invoice viewer preview must also show the extra footer for `SALE`
invoices so manager-visible previews match printed sale receipts.

## API And Call Sites

All call sites that print sale receipts must pass both footer values:

- Payment completion sale receipt.
- Sale receipt reprint from completion overlay.
- Latest invoice print button.
- Sale invoice viewer reprint.
- Refund/repay flows only for the replacement `SALE` receipt.

For `REFUND` and `SPEND`, the renderer should ignore
`receipt_extra_footer_text` even if the current Store Setting contains text.

## Error Handling

- Store Setting save must fail fast in the UI when a line is too wide.
- Server-side storage does not need receipt-width validation in this design,
  because the field is local admin configuration and the existing store API is
  already a simple settings update endpoint.
- Print code must tolerate `null`, `undefined`, or blank extra footer text by
  printing nothing extra.

## Testing And Verification

Recommended verification:

- Run `cd retail_pos_server && npm run build`.
- Run `cd retail_pos_app && npm run build`.
- Manually verify Store Settings:
  - New textarea loads and saves.
  - Manual newlines are preserved after reload.
  - Empty extra footer saves as absent/null behavior.
  - A line over 42 printable columns shows a validation error and cannot save.
  - Korean text counts as width 2.
- Manually verify receipts:
  - `SALE` original receipt prints the extra footer before the QR code.
  - `SALE` reprint/copy prints the same extra footer.
  - `REFUND` receipt does not print the extra footer.
  - `SPEND` receipt does not print the extra footer.
  - Repay prints extra footer only on the replacement sale receipt.
  - Raster and ESC/POS command modes match the same line behavior.

## Out Of Scope

- Rich text, bold, alignment controls, font-size controls, or per-line styling.
- Automatic wrapping as an operator-facing feature.
- Snapshotting footer text onto historical invoices.
- Cloud sync or upstream cloud configuration for the new footer field.
