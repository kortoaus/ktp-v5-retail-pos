# ESC/POS Serial QA Handoff

Date: 2026-05-08
Branch: `codex/escpos-serial-support`

## Current State

ESC/POS receipt printing now supports one configured receipt printer with either
network or serial transport.

Implemented pieces:

- Config union: `{ type: "net"; host; port }` or
  `{ type: "serial"; path; baudRate }`.
- Legacy network config migration from old `{ host, port }`.
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
  - Hello World serial test button.
- Diagnostic logging for serial test and main-process serial flow.

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

## Next Debugging Steps

Start next session by confirming hardware before changing app logic:

1. Print the printer self-test page and confirm serial settings exactly match
   `38400 / 8N1 / DTR/DSR`.
2. Confirm the USB-serial adapter supports modem control lines, especially DSR.
3. Confirm cable wiring:
   - TX/RX/GND connected correctly;
   - DTR/DSR lines present;
   - straight-through vs null-modem expectation for this printer model.
4. If possible, temporarily switch printer flow control to no-handshake and
   retry the Hello World button.
5. If hardware checks out, add a temporary control-line matrix test:
   - DTR true / RTS false;
   - DTR false / RTS true;
   - DTR true / RTS true;
   - log `cts/dsr/dcd` before write for each.

Avoid changing receipt raster generation until the serial line readiness is
understood. The current 20-byte Hello World test is enough to prove whether the
printer receives plain ESC/POS text.

