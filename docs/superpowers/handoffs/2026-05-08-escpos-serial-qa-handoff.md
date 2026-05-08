# ESC/POS Serial QA Handoff

Date: 2026-05-08
Branch: `codex/escpos-serial-support`

## Current State

ESC/POS receipt printing now supports one configured receipt printer with either
network or serial transport.

Implemented pieces:

- Config union: `{ type: "net"; host; port }` or serial config with path,
  baud rate, data bits, parity, stop bits, handshaking, DTR, and RTS.
- Legacy network config migration from old `{ host, port }`.
- Legacy serial config migration from old `{ path, baudRate }` to
  `38400 / 8N1 / DTR/DSR / DTR on / RTS on` defaults.
- Dedicated Electron main IPC: `escpos:print`.
- Preload bridge: `window.electronAPI.printEscpos(...)`.
- Renderer print routing:
  - network printers still use the local POS server TCP bridge;
  - serial printers use the new Electron IPC path.
- Interface Settings ESC/POS section:
  - single printer only;
  - Network / Serial selector;
  - serial port dropdown;
  - baud rate select: `9600`, `19200`, `38400`, `57600`, `115200`;
  - data bits: `7` / `8`;
  - parity: `none`, `even`, `odd`, `mark`, `space`;
  - stop bits: `1` / `2`;
  - handshaking: `None`, `DTR/DSR`, `RTS/CTS`, `XON/XOFF`;
  - configurable initial DTR/RTS line state;
  - Hello World serial test button.
- Diagnostic logging for serial test and main-process serial flow.
- Receipt raster conversion trims trailing blank canvas rows before sending to
  reduce serial payload size without changing the Korean-safe raster path.

Latest relevant commits:

- `05aedf7 fix: assert escpos serial dtr rts`
- `8087095 chore: log escpos serial print flow`
- `cdc502c feat: use baud rate select for escpos`
- `34aa58f feat: add escpos serial test print`

## Verification Already Run

Fresh verification passed after implementation:

```bash
cd retail_pos_app
npm run build
```

Additional checks previously passed:

```bash
git diff --check
git diff -- retail_pos_server package.json retail_pos_server/package.json
rg -n "from ['\"](electron|node:|fs|path|serialport)|require\\(['\"](electron|fs|path|serialport)" retail_pos_app/src/renderer/src
```

The server project has not been changed for serial support.

## QA Observation

Manual QA used:

- Path: `/dev/tty.usbserial-B0017L5B`
- Baud: `38400`
- Serial interface expected by printer:
  - `38400bps`
  - `8bit`
  - no parity
  - `DTR/DSR`

Before DTR/RTS assertion, the app successfully opened, wrote, drained, and
closed the port, but the printer did not print.

After adding DTR/RTS assertion, the observed log was:

```text
[ESC/POS:Serial] IPC request: path=/dev/tty.usbserial-B0017L5B, baudRate=38400, bytes=20
[ESC/POS:Serial] Job start: /dev/tty.usbserial-B0017L5B @ 38400, bytes=20, timeout=10006ms
[ESC/POS:Serial] Opening port: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Port opened: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Setting DTR/RTS: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Modem status: /dev/tty.usbserial-B0017L5B @ 38400, cts=false, dsr=false, dcd=false
[ESC/POS:Serial] Writing bytes: /dev/tty.usbserial-B0017L5B @ 38400, bytes=20
[ESC/POS:Serial] Write callback ok: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Draining port: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Drain complete: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Closing port: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Port closed: /dev/tty.usbserial-B0017L5B @ 38400
[ESC/POS:Serial] Job done: /dev/tty.usbserial-B0017L5B @ 38400
```

Interpretation:

- App, preload IPC, main IPC, serial open/write/drain/close all complete.
- `dsr=false` even after `port.set({ dtr: true, rts: true })`.
- Because the printer expects `DTR/DSR`, the next likely area is the physical
  serial layer: USB-serial adapter capability, cable wiring, or printer DIP /
  interface setting mismatch.

## Follow-up QA Result

Codex added a DTR/RTS control-line matrix diagnostic on this branch and also ran
the same matrix directly against the hardware from Node:

```text
Path: /dev/tty.usbserial-B0017L5B
Baud: 38400
Adapter: FTDI, serial B0017L5B
Payload: ESC @ + "Hello World\n\n\n" + cut
```

Result:

```text
DTR=true  RTS=false -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=false RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=true  RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
```

Electron app matrix result:

```text
Path: /dev/tty.usbserial-B0017L5B
Baud: 115200
DTR=true  RTS=false -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=false RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=true  RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
```

Note: the printer is expected to be configured for `38400`, so the `115200`
app run is useful for modem-line evidence but should not be treated as a valid
payload/printing test.

Electron app matrix result at the expected printer baud:

```text
Path: /dev/tty.usbserial-B0017L5B
Baud: 38400
DTR=true  RTS=false -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=false RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
DTR=true  RTS=true  -> cts=false, dsr=false, dcd=false, write/drain ok
```

Interpretation:

- The FTDI adapter is visible and the OS allows the app to open/write/drain the
  target port when unsandboxed.
- Changing host-side DTR/RTS does not cause the adapter to observe any asserted
  printer-side modem inputs.
- If the printer still produced no paper during the matrix run, the strongest
  remaining hypothesis is physical serial wiring / printer interface mode:
  missing or wrong DSR/DTR line, wrong straight-through vs null-modem cable, or
  a printer DIP/interface setting that does not match the cable.

## Hardware Breakthrough

The working hardware path is direct connection:

```text
TM-T82IV DB9 male
  -> CableCreation FTDI FT232RNL USB-RS232 DB9 female adapter
  -> USB
```

Do **not** insert the StarTech `SCNM9FM1MBK` null-modem cable in this path. With
the null-modem cable inserted, the app could open/write/drain but the printer
did not print. With the CableCreation adapter connected directly to the printer,
printing works.

Known-good app settings for this printer/adapter:

```text
Baud Rate: 38400
Data Bits: 8
Parity: none
Stop Bits: 1
Handshaking: DTR/DSR
DTR on: checked
RTS on: checked
```

The remaining issue is speed: full receipts are raster images for Korean text
safety, so `38400` serial output is inherently slow. Raising the printer and app
to `115200` would help, but the ESC/POS baud-rate command did not change the
printer in the Mac-only attempt. Windows Epson Utility is the next practical way
to change the printer baud rate.

## Next Debugging Steps

1. Keep the working direct CableCreation adapter connection. Do not add a
   null-modem cable for this adapter/printer pair.
2. Test a full sale receipt after the trailing blank raster trim and compare the
   `[ESC/POS:Serial] ... bytes=...` value against the earlier slow receipt.
3. If still too slow, use Windows Epson Utility to set the printer serial baud
   rate to `115200`, then set the app to `115200` and retry Hello World before
   full receipts.
4. Longer-term speed work: keep Korean-safe raster output but consider a hybrid
   receipt path where plain English/numeric rows are ESC/POS text and only
   Korean/mixed sections are raster.
