# Retail POS — Desktop App

Electron desktop application for retail POS terminals. Communicates with `retail_pos_server` (Express + Prisma + PostgreSQL) via REST API. Electron exists solely for serial port access (scale, barcode scanner), label printing, and packaging.

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Shell | Electron | 40.2.1 |
| Build tool | electron-vite | 5.x |
| Renderer | React + TypeScript | 19.x / 5.x |
| Styling | Tailwind CSS | 4.x |
| Routing | react-router-dom (HashRouter) | 7.x |
| Serial | serialport (pinned) | 13.0.0 |
| Encoding | iconv-lite | (SLCS Korean euc-kr) |
| Packaging | electron-builder | 26.x |

## Project Structure

```
src/
  main/                           # Electron main process
    index.ts                      # App entry, window lifecycle, auto-connect scale
    types.ts                      # Shared types (AppConfig, DeviceConfig, WeightResult, LabelSendRequest)
    store.ts                      # JSON config store (userData/app-config.json)
    ipc/                          # IPC handlers (one file per domain)
      index.ts                    # registerAllHandlers, cleanupAll, autoConnectScale
      app.ts                      # app:get-network-ip
      config.ts                   # config:get, config:set
      serial.ts                   # serial:list-ports, serial:open/close/send
      scale.ts                    # scale:connect/disconnect/read-weight/status
      label.ts                    # label:print (assembles SLCS Buffer via iconv, sends TCP/serial)
    driver/                       # Scale hardware drivers
      BaseScale.ts                # Abstract base (serial open/close, MSB masking, DTR/RTS)
      CasScale.ts                 # CAS PD-II protocol (0x57 command, STX...CR frame)
      DatalogicScale.ts           # Datalogic protocol (S11 weight + barcode passthrough)
  preload/
    index.ts                      # contextBridge → window.electronAPI
    index.d.ts                    # Type declarations for renderer
  renderer/                       # React SPA (web-first, no Electron APIs)
    index.html
    src/
      main.tsx                    # React entry
      App.tsx                     # HashRouter, TerminalProvider, Gateway, Routes
      index.css                   # Tailwind import + global resets
      types/
        models.ts                 # TypeScript interfaces mirroring Prisma models
        sales.ts                  # SaleLineItem, SaleLineType, LineAdjustment
      store/
        salesStore.ts             # Zustand sales store (4 carts, line CRUD, price calc)
      libs/
        api.ts                    # ApiService (fetch-based, configurable baseURL + headers)
        label-builder.ts          # LabelBuilder: builds ZPL (string) or SLCS (serializable parts)
        label-templates.ts        # Label layout templates (e.g. buildPriceTag60x30)
      contexts/
        TerminalContext.tsx        # Terminal identification via /api/terminal/me
      components/
        Gateway.tsx               # Boot gate: server setup → terminal check → app
        DeviceMonitor.tsx         # Status bar: terminal info, server health, scale status
      hooks/
        useWeight.ts              # Scale read weight (connect/disconnect/readWeight)
        useBarcodeScanner.ts      # Barcode input (Datalogic serial + USB HID keyboard)
        useServerHealth.ts        # Polls GET /ok every 5s
        useScaleStatus.ts         # Polls scale:status every 5s
        useZplPrinters.ts         # Lists configured label printers, printLabel()
      screens/
        ServerSetupScreen.tsx     # First-run: configure server host + port
        TestScreen.tsx            # Device test: scale weight read + barcode display
        LabelingScreen.tsx        # Scan item → print price tag label
        InterfaceSettingsScreen.tsx  # Configure scale, label printers, ESC/POS printer
```

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
    "scale": { "type": "CAS", "path": "COM3", "baudRate": 9600, "dataBits": 7, "stopBits": 1, "parity": "even" },
    "zplSerial": { "path": "COM4", "language": "slcs" },
    "zplNet": [
      { "name": "Label Printer 1", "host": "192.168.1.50", "port": 9100, "language": "zpl" },
      { "name": "Label Printer 2", "host": "192.168.1.51", "port": 9100, "language": "slcs" }
    ],
    "escposPrinter": { "host": "192.168.1.52", "port": 9100 }
  }
}
```

## Hardware Support

| Device | Connection | Driver | Status |
|--------|-----------|--------|--------|
| CAS Scale (PD-II) | Serial | `CasScale.ts` | Done |
| Datalogic Scale + Scanner | Serial (shared cable) | `DatalogicScale.ts` | Done |
| USB HID Barcode Scanner | Keyboard emulation | `useBarcodeScanner.ts` | Done |
| Label Printer (ZPL) | Network / Serial | `label-builder.ts` + `label.ts` | Done |
| Label Printer (SLCS/Bixolon) | Network / Serial | `label-builder.ts` + `label.ts` (iconv euc-kr) | Done |
| ESC/POS Receipt Printer | Network | — | Config only |

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

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-network-ip` | renderer → main | Get machine's IPv4 address |
| `config:get` | renderer → main | Load AppConfig |
| `config:set` | renderer → main | Save AppConfig |
| `serial:list-ports` | renderer → main | List available serial ports |
| `serial:open/close/send` | renderer → main | Raw serial port operations |
| `serial:data` | main → renderer | Raw serial data push |
| `scale:connect` | renderer → main | Connect scale using saved config |
| `scale:disconnect` | renderer → main | Disconnect scale |
| `scale:read-weight` | renderer → main | Read weight from scale |
| `scale:status` | renderer → main | Check serial connection status |
| `barcode:scan` | main → renderer | Barcode scanned (Datalogic serial) |
| `label:print` | renderer → main | Send pre-built label to printer (TCP or serial) |

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

## What's Next

- [ ] **SaleScreen** — POS transaction UI (scan → line list → adjust → pay). Sales store is ready (`salesStore.ts`). See `docs/sale_store_plan.md` for spec.
- [ ] ESC/POS receipt printer driver (network)
- [ ] More label templates (different sizes, layouts)
- [ ] Product/pricing integration with retail_pos_server
