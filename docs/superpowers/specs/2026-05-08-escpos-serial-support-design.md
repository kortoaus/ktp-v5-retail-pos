# ESC/POS Serial Support Design

Date: 2026-05-08
Status: Draft approved for planning

## Goal

Add serial transport support for the ESC/POS receipt printer while preserving
the existing network receipt printer path. The receipt printer remains a single
configured device: each terminal can use either one network ESC/POS printer or
one serial ESC/POS printer.

## Current Behavior

Receipt rendering happens in the renderer:

- `libs/printer/sale-invoice-receipt.ts` and
  `libs/printer/shift-settlement-receipt.ts` draw 576px receipt canvases.
- `libs/printer/escpos.ts` converts canvases into ESC/POS raster bytes and
  appends init and cut commands.
- `libs/printer/print.service.ts` sends bytes to the local POS server
  `/api/printer/print` endpoint.
- `retail_pos_server/src/v1/printer/printer.service.ts` opens a TCP socket to
  the configured receipt printer and writes raw bytes.

The current ESC/POS config shape is network-only:

```ts
interface EscposPrinterConfig {
  host: string;
  port: number;
}
```

## Desired Config Shape

Change the ESC/POS printer config to a discriminated union:

```ts
type EscposPrinterConfig =
  | { type: "net"; host: string; port: number }
  | { type: "serial"; path: string; baudRate: number };
```

`DeviceConfig.escposPrinter` stays `EscposPrinterConfig | null`, so the app
continues to model exactly one receipt printer.

Existing saved configs without `type` are treated as legacy network configs and
migrated on load to:

```ts
{ type: "net", host, port }
```

This preserves current deployments.

## Architecture

Add a dedicated ESC/POS IPC boundary instead of reusing label printing IPC:

- New main-process handler module: `src/main/ipc/escpos.ts`
- New preload bridge method: `window.electronAPI.printEscpos(...)`
- New preload type declarations in `src/preload/index.d.ts`
- Registration from `src/main/ipc/index.ts`

The renderer continues to produce ESC/POS bytes. It does not import Electron,
Node APIs, or `serialport`.

Network printing keeps the existing server TCP bridge for now. Serial printing
uses the new Electron main-process IPC path.

## Print Flow

`printESCPOS(data)` reads `window.electronAPI.getConfig()`.

If no server exists and the configured printer is network, it shows the existing
"Server not configured" failure path. A server is not required for serial ESC/POS
printing.

If no ESC/POS printer is configured, it shows the existing "ESC/POS printer not
configured" failure path.

For network printers:

1. Read `config.server`.
2. Build the existing `/api/printer/print?ip=<host>&port=<port>` URL.
3. Send the raw ESC/POS byte body with `Content-Type:
   application/octet-stream`.
4. Preserve the `ip-address` header when a terminal IP is available.

For serial printers:

1. Call `window.electronAPI.printEscpos({ printer, data: Array.from(data) })`.
2. The main process opens the configured serial port.
3. It writes the raw ESC/POS bytes.
4. It waits for `drain`.
5. It closes the port.
6. It returns `{ ok: true, message: "Printed" }` or `{ ok: false, message }`.

The serial path uses open/write/drain/close per job. This keeps recovery simple
if a receipt printer is unplugged or a job fails.

## Serial Defaults

The first version exposes only:

- `path`
- `baudRate`

The main process uses fixed serial framing:

- `dataBits: 8`
- `parity: "none"`
- `stopBits: 1`

The default baud rate is `115200`.

More detailed serial options can be added later by extending the union member
without changing the overall architecture.

## Timeout And Queueing

Serial writes must use a byte-size-aware timeout:

- Estimate job duration from payload bytes and baud rate.
- Apply a minimum timeout for short jobs.
- Add a margin for long raster receipts.

The timeout and errors must identify the ESC/POS serial path, for example:

- `ESC/POS serial open failed`
- `ESC/POS serial write failed`
- `ESC/POS serial timeout`

The first implementation does not need a persistent queue if each print call
awaits the IPC response before returning. If later UI paths can fire concurrent
receipt jobs, add an in-main-process queue keyed by serial path.

## Settings UI

Update the `ESC/POS Printer` section in
`src/renderer/src/screens/InterfaceSettingsScreen.tsx`.

The section remains a single-printer form:

- Toggle enabled/disabled.
- Transport selector: `Network` or `Serial`.
- Network fields: `Host`, `Port`.
- Serial fields: serial port dropdown, `Baud Rate`.

The save handler writes only one `escposPrinter` object:

- `null` when disabled.
- `{ type: "net", host, port }` for network.
- `{ type: "serial", path, baudRate }` for serial.

`getSerialPorts()` already exists and can supply the serial path options.

## Non-Goals

This change does not:

- Add multiple ESC/POS receipt printers.
- Change receipt canvas layout or ESC/POS raster generation.
- Move network ESC/POS printing from the server to Electron main.
- Add server-side serial hardware support.
- Add detailed serial options beyond path and baud rate.
- Change label printer behavior.

## Verification

Run:

```bash
cd retail_pos_app
npm run build
```

Manual checks:

- A legacy network config with `{ host, port }` loads as a network printer.
- Settings can save a network ESC/POS printer.
- Settings can save a serial ESC/POS printer with path and baud rate.
- Network receipt printing still calls the existing server endpoint.
- Serial receipt printing calls the new Electron IPC and returns a visible
  failure message when the port cannot be opened.
