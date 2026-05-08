# Sale Receipt ESC/POS Command Mode Handoff

Date: 2026-05-08
Branch: `codex/sale-receipt-escpos-mode`
Repo: `/Users/dev/ktpv5/ktpv5-pos-retail`

## Current Status

The sale receipt ESC/POS command mode feature is implemented and builds.

Fresh verification run in this session:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Result: exit 0.

Worktree was clean after the latest commit.

## Implemented Scope

Sale receipts only:

- first sale receipt
- copy/reprint receipt
- refund receipt
- repay/reprint chain

Not changed:

- shift settlement/Z-report remains raster
- sale/payment/refund math unchanged
- POS server/cloud sync unchanged
- raster receipt mode still exists and remains default for old configs

## Key Files

- `retail_pos_app/src/main/types.ts`
  - Added `ReceiptPrintMode`, `ReceiptTextEncoding`, and text encode request types.

- `retail_pos_app/src/preload/index.d.ts`
  - Renderer-facing config and `encodeText()` declarations.

- `retail_pos_app/src/main/store.ts`
  - Config migration/defaults:
    - `receiptPrintMode: "raster"`
    - `receiptTextEncoding: "ascii-replace"`

- `retail_pos_app/src/main/ipc/text-encoding.ts`
  - Main-process encoding bridge.
  - Uses `iconv-lite` for `cp949` / `euc-kr`.
  - Keeps renderer free of Node/iconv imports.

- `retail_pos_app/src/preload/index.ts`
  - Exposes `window.electronAPI.encodeText()`.

- `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`
  - Adds ESC/POS Printer section controls:
    - `Receipt Mode`: `Raster Image` / `ESC/POS Command`
    - `Text Encoding`: `ASCII replace` / `CP949` / `EUC-KR`

- `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts`
  - ESC/POS command builder for sale invoice receipts.
  - Native QR command.
  - Single receipt builder and chain builder.
  - One final cut for chains.
  - Conservative non-ASCII print-width handling.
  - `cp949` / `euc-kr` only encode bytes; they assume the printer is already configured for a matching Korean code page/mode. No `ESC t n` is sent yet.

- `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
  - Selects raster vs ESC/POS command mode from app config.

- `retail_pos_app/src/main/ipc/escpos.ts`
  - Serial ESC/POS write path.
  - Latest serial QA fix splits `ESC @` initialization from the rest of the payload.

## Commit Timeline

Feature docs:

- `e330796 docs: specify sale receipt escpos command mode`
- `d909f84 docs: plan escpos sale receipt mode`

Implementation:

- `1bd2bc1 feat: add receipt print config`
- `54f3554 feat: add receipt text encoding bridge`
- `ab62092 feat: add receipt print mode settings`
- `b8ed828 feat: build sale receipts with escpos commands`
- `a262296 fix: refine escpos receipt text layout`
- `7b9078d feat: select sale receipt print mode`

Serial QA/debug fixes:

- `bfa14d4 fix: wait before serial escpos writes`
- `9e33c37 fix: split serial escpos init writes`

## QA Findings So Far

The user tested the same receipt over network and serial.

Network ESC/POS command mode:

- Printed complete receipt from top.
- QR printed.
- Layout looked reasonable.

Serial ESC/POS command mode before serial fixes:

- Printed partial receipts.
- The beginning of the receipt was randomly missing.
- Multiple outputs showed different first visible sections.
- Pattern: "first N bytes are lost, then the rest prints normally."

Interpretation:

- Builder bytes are likely valid because network prints correctly.
- The bug is likely in serial printer readiness / write timing, not sale receipt formatting.
- The first attempted fix added a DTR/RTS settle delay before write.
- That was not enough.
- The latest fix sends `ESC @` separately, drains, waits `750ms`, then sends the remaining payload.

## Latest Serial Fix Details

File: `retail_pos_app/src/main/ipc/escpos.ts`

Current hypothesis:

- `ESC @` initializes/resets the printer.
- On serial transport, if the full payload is sent immediately after `ESC @`, the printer may discard bytes while initializing.
- Network transport likely buffers enough that this does not show up.

Latest implementation:

```text
if payload starts with ESC @:
  write ESC @ only
  drain
  wait 750ms
  write the rest of the payload
  drain
else:
  write full payload
  drain
```

This is committed as:

```text
9e33c37 fix: split serial escpos init writes
```

## Immediate Next Step

Ask the user to restart the app and print the same receipt over serial 3-5 times.

Pass condition:

- Every serial print starts from the top: company/store header should appear.
- No random truncation at the beginning.
- QR and final cut still work.

If it passes:

- Run fresh build:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

- Check status:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git status --short
```

- Then ask whether to push/create PR, keep branch, or merge locally.

## If Serial Still Drops The Beginning

Continue systematic debugging. Do not guess blindly.

Next hypotheses to test, one at a time:

1. **Remove `ESC @` for serial command-mode receipts**
   - Since the port opens fresh each print, serial printers may not need an init reset.
   - Network can keep `ESC @`.
   - Safest test: add an option in the serial main process path to strip leading `ESC @` before writing, only for serial.

2. **Increase init settle**
   - Change `INIT_SETTLE_MS` from `750` to `1500`.
   - This is less elegant but can confirm whether the delay is still too short.

3. **Warm-up write before real payload**
   - After open/control lines, send a harmless feed or status-friendly no-op, drain, wait, then send real bytes.
   - Be careful not to advance paper unexpectedly.

4. **Chunk serial writes**
   - Send payload in chunks with short delays between chunks.
   - This targets serial/printer buffer overrun rather than init timing.
   - Use only after init-specific tests fail.

5. **Add diagnostics**
   - Log whether data starts with `ESC @`.
   - Log first 16 bytes.
   - Log exact timings: open, control-line set, init write/drain, body write/drain.

## QA Commands

Run app:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run dev
```

Settings path:

```text
/manager/settings
```

Set:

```text
ESC/POS Printer -> Receipt Mode -> ESC/POS Command
Text Encoding -> ASCII replace
```

Then reprint the same sale/refund receipt over serial several times.

## Important Notes

- User prefers Korean conversation.
- The user is actively doing physical printer QA.
- Do not claim the serial issue is fixed until the user confirms repeated serial prints start correctly.
- Raster mode must remain available until the user confirms command mode is reliable.
- The serial issue has appeared only on serial; network output looked good.
