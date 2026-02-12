# Retail POS — Desktop App

Electron desktop application for retail POS terminals. Communicates with `retail_pos_server` (Express + Prisma + PostgreSQL) via REST API. Electron exists solely for serial port access (scale, barcode scanner), label printing, and packaging.

## Stack

| Layer      | Technology                    | Version                        |
| ---------- | ----------------------------- | ------------------------------ |
| Shell      | Electron                      | 40.2.1                         |
| Build tool | electron-vite                 | 5.x                            |
| Renderer   | React + TypeScript            | 19.x / 5.x                     |
| Styling    | Tailwind CSS                  | 4.x                            |
| Routing    | react-router-dom (HashRouter) | 7.x                            |
| Serial     | serialport (pinned)           | 13.0.0                         |
| Encoding   | iconv-lite                    | (SLCS Korean euc-kr)           |
| Hangul     | es-hangul                     | (virtual keyboard composition) |
| Math       | decimal.js                    | (money/qty precision)          |
| Packaging  | electron-builder              | 26.x                           |

## Boot Flow

1. **Main process** starts → registers all IPC handlers → creates window
2. **Auto-connect scale** if configured in `app-config.json`
3. **Renderer** loads → `TerminalContext` reads config
4. **No server configured?** → `ServerSetupScreen` (enter host:port, tests `/health`)
5. **Server configured** → sets `apiService` baseURL + `ip-address` header → fetches `/api/terminal/me`
6. **Terminal not found?** → error screen with retry
7. **Terminal found** → app renders (routes, DeviceMonitor status bar)
8. **On quit** → `before-quit` fires `cleanupAll()` (disconnects scale, closes serial ports)

## Config Store

Persisted at `{userData}/app-config.json`:

```json
{
  "server": { "host": "192.168.1.100", "port": 2200 },
  "devices": {
    "scale": {
      "type": "CAS",
      "path": "COM3",
      "baudRate": 9600,
      "dataBits": 7,
      "stopBits": 1,
      "parity": "even"
    },
    "zplSerial": { "path": "COM4", "language": "slcs" },
    "zplNet": [
      {
        "name": "Label Printer 1",
        "host": "192.168.1.50",
        "port": 9100,
        "language": "zpl"
      },
      {
        "name": "Label Printer 2",
        "host": "192.168.1.51",
        "port": 9100,
        "language": "slcs"
      }
    ],
    "escposPrinter": { "host": "192.168.1.52", "port": 9100 }
  }
}
```

## Hardware Support

| Device                       | Connection            | Driver                                         | Status      |
| ---------------------------- | --------------------- | ---------------------------------------------- | ----------- |
| CAS Scale (PD-II)            | Serial                | `CasScale.ts`                                  | Done        |
| Datalogic Scale + Scanner    | Serial (shared cable) | `DatalogicScale.ts`                            | Done        |
| USB HID Barcode Scanner      | Keyboard emulation    | `useBarcodeScanner.ts`                         | Done        |
| Label Printer (ZPL)          | Network / Serial      | `label-builder.ts` + `label.ts`                | Done        |
| Label Printer (SLCS/Bixolon) | Network / Serial      | `label-builder.ts` + `label.ts` (iconv euc-kr) | Done        |
| ESC/POS Receipt Printer      | Network               | —                                              | Config only |

## Label Printing Architecture

Label building is split between renderer (HMR) and main (binary encoding):

```
Renderer (HMR)                          Main (stable, no reload needed)
─────────────────                       ──────────────────────────────
LabelBuilder.build(language)
  ZPL → { language: 'zpl', data: string }
  SLCS → { language: 'slcs', parts: [
    { type: 'raw', data: 'CB\r\n' },
    { type: 'euc-kr', data: '한국어' },
  ]}

printLabel(printer, label) ──IPC──→     assembleSLCS() → iconv.encode()
                                        sendTcp() or sendSerial()
                                        connect → send → disconnect (per tx)
```

- **ZPL serial**: fixed 115200/8/N/1/RTS-CTS
- **Label printers**: per-printer `language` config (`zpl` or `slcs`)
- **Multiple network printers** supported, one serial printer max

## IPC Channels

| Channel                  | Direction       | Purpose                                         |
| ------------------------ | --------------- | ----------------------------------------------- |
| `app:get-network-ip`     | renderer → main | Get machine's IPv4 address                      |
| `config:get`             | renderer → main | Load AppConfig                                  |
| `config:set`             | renderer → main | Save AppConfig                                  |
| `serial:list-ports`      | renderer → main | List available serial ports                     |
| `serial:open/close/send` | renderer → main | Raw serial port operations                      |
| `serial:data`            | main → renderer | Raw serial data push                            |
| `scale:connect`          | renderer → main | Connect scale using saved config                |
| `scale:disconnect`       | renderer → main | Disconnect scale                                |
| `scale:read-weight`      | renderer → main | Read weight from scale                          |
| `scale:status`           | renderer → main | Check serial connection status                  |
| `barcode:scan`           | main → renderer | Barcode scanned (Datalogic serial)              |
| `label:print`            | renderer → main | Send pre-built label to printer (TCP or serial) |

## Commands

```bash
npm run dev              # Dev mode with HMR
npm run build            # Production build → out/
npm run package:win      # Build + NSIS installer (x64)
npm run package:mac      # Build + DMG (x64 + arm64)
npm run package:all      # Both platforms
```

## Cross-Platform Build

Dev on Mac, production 90%+ Windows. Native modules (`serialport`) must be rebuilt per-OS.

**Do not copy `node_modules` between machines.** Always `npm install` fresh.

### Windows prerequisites

- Node.js 22
- Visual Studio Build Tools with "Desktop development with C++" workload
- Python 3

### Build steps (per platform)

```bash
git clone <repo>
cd retail_pos_app
npm install              # triggers postinstall → rebuilds native modules for Electron
npm run package:win      # or package:mac
```

## Docs

| Document                       | Purpose                               |
| ------------------------------ | ------------------------------------- |
| `docs/pricing_rules.md`        | Pricing rules for all item types (EN) |
| `docs/pricing_rules_ko.md`     | 가격 계산 규칙 (KO)                   |
| `docs/external_device_plan.md` | External device integration plan      |

## What's Next

- [x] Sales store (4 carts, pricing engine, member levels)
- [x] On-screen keyboard (Korean dubeolsik + English + numpad)
- [x] Item search modal with keyboard
- [x] Weight read modal (scale integration)
- [x] Barcode scan → item lookup → add to cart
- [ ] SaleScreen UI polish (line list, totals, cart switching)
- [ ] ESC/POS receipt printer driver (network)
- [ ] Payment flow
- [ ] More label templates (different sizes, layouts)
