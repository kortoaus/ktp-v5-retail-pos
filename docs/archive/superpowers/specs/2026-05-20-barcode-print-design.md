# Barcode Print Screen Design

## Goal

Add a simple POS utility screen that converts an operator-entered string into a barcode and prints it on the configured receipt printer.

The printed job must use ESC/POS barcode commands only. Raster printing is intentionally out of scope.

## Entry Point

- Add a `Barcode Print` button in `HomeScreen` under `Tools`, beside `Price Tag`.
- Add a route at `/barcode-print`.
- The screen is available without an open shift because it is a printer utility, not a sale workflow.

## Screen

The screen contains:

- Text input for the source string.
- Barcode type selector with:
  - `DataMatrix`
  - `QR Code`
  - `Code128`
- Preview area for operator confirmation.
- Print button.

The print button is disabled when the input is empty or the current barcode cannot be generated. The preview is browser-rendered for visibility only; it is not used for the print payload.

## Print Output

Each print job produces one receipt-printer slip:

1. Initialize printer.
2. Center alignment.
3. Selected barcode command.
4. Original string as human-readable text below the barcode.
5. Feed and cut.

The print path reuses the existing `printESCPOS()` function so configured serial and network receipt printers behave the same as existing ESC/POS receipt printing.

## ESC/POS Command Builder

Add a focused builder, likely `retail_pos_app/src/renderer/src/libs/printer/barcode-slip-escpos.ts`, that returns a `Uint8Array`.

Responsibilities:

- Encode the payload for printer barcode commands.
- Build QR Code command bytes using the existing ESC/POS QR pattern already used by command-mode receipts.
- Build Code128 command bytes using standard ESC/POS 1D barcode commands.
- Build DataMatrix command bytes using ESC/POS 2D symbol commands.
- Add the human-readable payload text below the symbol.
- Add feed and cut commands.

DataMatrix support is printer-dependent. Because there is no raster fallback, printers that do not support DataMatrix ESC/POS commands may ignore that print section or fail to render it.

## Error Handling

- Empty or whitespace-only input disables printing.
- Generation/command-building errors are shown in the screen.
- Missing printer configuration or transport failures reuse existing `printESCPOS()` alert behavior.
- DataMatrix printer incompatibility cannot be detected reliably before printing, so the UI should not promise guaranteed DataMatrix output on every model.

## Verification

- Run the app build: `cd retail_pos_app && npm run build`.
- Manually verify:
  - Home shows `Barcode Print` beside `Price Tag`.
  - `/barcode-print` renders text input, preview, type selector, and print button.
  - Empty input cannot print.
  - QR Code, Code128, and DataMatrix each build an ESC/POS payload.
  - The print payload does not call raster canvas conversion for the actual printer job.
