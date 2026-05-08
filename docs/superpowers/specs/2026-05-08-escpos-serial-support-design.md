# ESC/POS Serial Support Design

Date: 2026-05-08
Status: Implemented

## Goal

Add serial transport support for the ESC/POS receipt printer while preserving
the existing network receipt printer path. The receipt printer remains a single
configured device: each terminal can use either one network ESC/POS printer or
one serial ESC/POS printer.

## Receipt Printer Boundary

Receipt rendering happens in the renderer:

- `libs/printer/sale-invoice-receipt.ts` and
  `libs/printer/shift-settlement-receipt.ts` select Raster Image or ESC/POS
  Command mode from app config.
- `libs/printer/escpos.ts` converts canvases into ESC/POS raster bytes and
  appends init and cut commands for raster mode.
- `libs/printer/sale-invoice-escpos.ts` and
  `libs/printer/shift-settlement-escpos.ts` build native ESC/POS command bytes
  for command mode.
- `libs/printer/print.service.ts` sends bytes to the configured network or
  serial receipt printer.

## Config Shape

The ESC/POS printer config is a discriminated union:

```ts
type EscposPrinterConfig =
  | { type: "net"; host: string; port: number }
  | ({
      type: "serial";
      path: string;
    } & EscposSerialSettings);
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

Serial receipt printing uses a dedicated ESC/POS IPC boundary instead of label
printing IPC:

- main-process handler module: `src/main/ipc/escpos.ts`
- preload bridge method: `window.electronAPI.printEscpos(...)`
- preload type declarations in `src/preload/index.d.ts`
- registration from `src/main/ipc/index.ts`

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
2. The main process reuses the persistent configured SerialPort, opening it on
   boot or on demand if needed.
3. It queues the job, writes the raw ESC/POS bytes, and waits for `drain`.
4. It keeps the port open for later receipt jobs.
5. It returns `{ ok: true, message: "Printed" }` or `{ ok: false, message }`.

The serial path intentionally keeps the port open. Epson TM-T82IV serial QA
showed that opening the port immediately before each job could drop the first
part of the receipt. Persistent connection avoids that first-write loss while
still disconnecting safely during app cleanup.

## Serial Defaults

The app exposes:

- `path`
- `baudRate`
- `dataBits: 8`
- `parity: "none"`
- `stopBits: 1`
- `handshaking`
- initial `DTR` / `RTS` line state

Defaults target the tested Epson TM-T82IV direct FTDI path:

- `baudRate: 38400`
- `dataBits: 8`
- `parity: "none"`
- `stopBits: 1`
- `handshaking: "dtr-dsr"`
- `dtr: true`
- `rts: true`

## Timeout And Queueing

Serial writes use:

- a main-process queue so receipt jobs do not interleave
- byte-size-aware timeout based on payload bytes and baud rate
- reconnect-on-failure behavior
- safe disconnect during app shutdown

Timeout and errors identify the ESC/POS serial path, for example
`ESC/POS serial timeout`.

## Settings UI

The `ESC/POS Printer` section in
`src/renderer/src/screens/InterfaceSettingsScreen.tsx` remains a single-printer
form.

- Toggle enabled/disabled
- Receipt Mode: Raster Image or ESC/POS Command
- Text Encoding: ASCII replace, CP949, or EUC-KR
- Transport selector: `Network` or `Serial`
- Network fields: `Host`, `Port`
- Serial fields: serial port dropdown, `Baud Rate`, data bits, parity, stop
  bits, handshaking, DTR, and RTS.

The save handler writes only one `escposPrinter` object:

- `null` when disabled.
- `{ type: "net", host, port }` for network.
- `{ type: "serial", path, baudRate, dataBits, parity, stopBits, handshaking, dtr, rts }` for serial.

`getSerialPorts()` already exists and can supply the serial path options.

## Non-Goals

This change does not:

- Add multiple ESC/POS receipt printers.
- Change receipt canvas layout or ESC/POS raster generation.
- Move network ESC/POS printing from the server to Electron main.
- Add server-side serial hardware support.
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
- Settings can save a serial ESC/POS printer with full serial line settings.
- Network receipt printing still calls the existing server endpoint.
- Serial receipt printing calls Electron IPC, reuses the persistent SerialPort,
  and returns a visible failure message when the port cannot be opened.
- Interface Settings save restarts the app so device lifecycle changes apply
  from a clean boot.
