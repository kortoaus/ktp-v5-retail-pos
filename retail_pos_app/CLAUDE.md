# CLAUDE.md — retail_pos_app

Electron 40 desktop till. React 19 renderer + a thin main process that owns serial hardware
and the second (customer-facing) display.

## Commands

```bash
npm run dev / build      # electron-vite dev+HMR / → out/{main,preload,renderer}
npm run package:win      # NSIS x64 installer → dist/  (package:win:publish = CI, --publish always)
npm run package:mac      # DMG x64+arm64, unsigned (mac.identity: null)
npx tsc --noEmit -p tsconfig.web.json   # renderer typecheck
```

`postinstall` runs `electron-builder install-app-deps` to rebuild `serialport` against the Electron
ABI. **Never copy `node_modules` between machines/OSes** — reinstall. Windows builds need VS Build
Tools (C++) + Python 3.

## Layout

```
src/main/       index.ts (windows + lifecycle) · store.ts (config) · updater.ts · types.ts
  ipc/          app · config · text-encoding · serial · scale · label · escpos
  driver/       BaseScale · CasScale · DatalogicScale
src/preload/    index.ts (contextBridge) · index.d.ts (window.electronAPI types)
src/renderer/src/
  App.tsx main.tsx      HashRouter + providers    contexts/  Terminal → Shift → User
  service/*.service.ts  ALL HTTP (12 files)       libs/api.ts  the axios singleton
  store/SalesStore.ts   zustand cart state        libs/{printer,label-*,sale,refund}/
scripts/tests/  3 node:test files (not wired to npm test)
```

## Windows (`src/main/index.ts`)

- **Main window**: 1366×768, normal frame, fullscreen only via IPC `app:toggle-fullscreen`;
  `contextIsolation: true`, `nodeIntegration: false`, preload attached.
- **Customer window**: created only if `screen.getAllDisplays()` finds a non-primary display.
  Fullscreen, frameless, **no preload** → `window.electronAPI` is unavailable there; loads the same
  bundle at hash `#/customer-display`.
- Boot: `registerAllHandlers()` → main window → customer window → `autoConnectScale()` →
  `autoConnectEscposPrinter()` → `checkForBootUpdate()`. `before-quit` is intercepted once to
  `await cleanupAll()` (closes serial ports).

## IPC Contract

Adding/changing a channel means editing **three** files together: `src/main/ipc/*.ts`,
`src/preload/index.ts`, `src/preload/index.d.ts`. `index.d.ts` duplicates the domain types from
`src/main/types.ts` — keep both copies in sync.

| File | Channels |
|---|---|
| `ipc/app.ts` | `app:restart`, `app:get-network-ip`, `app:get-version`, `app:toggle-fullscreen`, `app:toggle-customer-display` |
| `ipc/config.ts` | `config:get`, `config:set` |
| `ipc/text-encoding.ts` | `text:encode` (`ascii-replace` \| `cp949` \| `euc-kr` via iconv-lite) |
| `ipc/serial.ts` | `serial:list-ports`, `serial:open`, `serial:close`, `serial:send`, **push `serial:data`** |
| `ipc/scale.ts` | `scale:connect`, `scale:disconnect`, `scale:read-weight`, `scale:status`, **push `barcode:scan`** |
| `ipc/label.ts` | `label:print` |
| `ipc/escpos.ts` | `escpos:print`, `escpos:test-control-lines` |

All but the two push channels are `handle`/`invoke`; handlers return `{ok, message}` rather than throwing.

## Persisted Config

**Not electron-store** — hand-rolled JSON at `app.getPath("userData")/app-config.json`
(`src/main/store.ts`; sync write, no atomic rename or backup, any parse error silently resets to
`DEFAULT_CONFIG`).

```
server:  { host, port } | null              ← retail_pos_server address; NOT validated on load
devices.scale:            { type: "CAS"|"DATALOGIC", path, baudRate, dataBits, stopBits, parity } | null
devices.zplSerial[]:      { name, path, language: "zpl"|"slcs", mediaSize? }
devices.zplNet[]:         { name, host, port, language, mediaSize? }   mediaSize: "7030"|"7090"|"100100"
devices.escposPrinter:    { type:"net", host, port } | { type:"serial", path, baudRate, ... } | null
devices.receiptPrintMode: "raster" | "escpos"                   (default "raster")
devices.receiptTextEncoding: "ascii-replace"|"cp949"|"euc-kr"    (default "ascii-replace")
```

`loadConfig()` migrates legacy shapes (`zplSerial` single→array, `escposPrinter` `{host,port}` →
`{type:"net",...}`). **No device key, token or secret is stored here** — the cloud device key lives
in `retail_pos_server/.env`.

## Networking

`src/renderer/src/libs/api.ts` — one axios instance, 30 s timeout, no baseURL at construction.
`TerminalContext` bootstraps it: `setBaseURL(http://{config.server.host}:{port})`, then
`setHeader("ip-address", await electronAPI.getNetworkIp())`, then `GET /api/terminal/me`. Nothing
works before `TerminalProvider` mounts. Every method resolves to
`{ ok, status, msg, result, paging }` and **never throws** — network failure is
`{ok:false, status:0, msg:"Network Error"}`, so check `res.ok`, not try/catch. Auth header is
`Bearer ${user.id}%%%${Date.now()}`, written to `localStorage.accessToken` by
`service/user.service.ts` after `GET /api/user/code`; `refreshToken` is stored and never read.

**The renderer never calls api-server or crm-server directly.** The only non-local host anywhere is
the Cloudflare Images CDN in `libs/cf-image-utils.ts` (`<img src>` only). Everything cloud-facing is
proxied by the local server: `/api/crm/*`, `/api/cloud/*`, `/api/hotkey/cloud`,
`/api/customer-voucher/*`. One deliberate bypass:
`libs/printer/print.service.ts` uses bare `fetch` for `POST /api/printer/print` (binary body).

## Routing & Gating

`HashRouter` (required for `file://` in packaged builds). Two top-level branches:
`/customer-display` → `CustomerScreen`, **outside every provider and gate**; everything else →
`TerminalProvider > ShiftProvider > Gateway > Routes`.
`Gateway` (terminal level): loading → `ServerSetupScreen` if `!config.server` → "Not Registered
Terminal" panel if `/api/terminal/me` failed → otherwise children + a persistent `<DeviceMonitor>`
footer. `ManagerLayout` = `UserProvider > AuthGateway > Outlet`. **`UserProvider` is per-layout, not
app-wide** — `getMe()` re-runs on every entry into `/sale`, `/manager/*`, `/shift/*`, while `/`,
`/price-tag`, `/barcode-print`, `/server-setup` have no user context at all. Scope denial renders
`BlockScreen` via `hasScope()` (`libs/scope-utils.ts`).

## Cart State

`store/SalesStore.ts` — zustand, **no persist middleware**; carts are lost on reload/restart. Fixed
`CART_COUNT = 4` carts, each `{ lines, member }` (member is per-cart). `LINE_PAGE_SIZE = 10`;
`ALLOWED_CHANGE_QTY_TYPES = ["normal","prepacked"]`. `addLine` merges same-item lines only when
`unit_price_adjusted === null` and price match — and the merge **moves the line to
the bottom**. `store/SalesStore.helper.ts` `recalculateLine` is the **sole writer** of derived fields:

```
unit_price_effective = unit_price_adjusted ?? unit_price_discounted ?? unit_price_original
total      = round(unit_price_effective * qty / QTY_SCALE)
tax_amount = taxable ? round(total / 11) : 0        // AU GST 10% inclusive
net        = total - tax_amount
```

Do not recompute these in components. Payment-level math lives in
`screens/SaleScreen/PaymentModal/usePaymentCal.ts`; payload assembly in `libs/{sale,refund}/build-payload.ts`.

## Scales & Scanner

`driver/BaseScale.ts` opens the port from config, sets DTR+RTS, masks every byte with `0x7f`, 1000 ms
read timeout.
- `CasScale` — request/response: writes `0x57` (`'W'`), parses the last `STX…CR` frame; `'?'` = error.
  Always reports `status: "stable"` (never emits unstable).
- `DatalogicScale` — streaming: `CR`-delimited packets; `S11…` is a weight
  (`substring(3,8) / 1000` kg, cached), anything else is a barcode pushed to `barcode:scan`.

`hooks/useBarcodeScanner.ts` is the **single scanner boundary** for both serial (`onBarcodeScan`) and
HID keyboard-wedge input. It decodes from **`e.code`, not `e.key`**, so a Korean IME cannot corrupt
the buffer. Heuristics: >50 ms keystroke gap resets the buffer, 300 ms idle clears it, minimum length
3, Enter terminates. Spaces are stripped; every scan updates `DeviceMonitorStore.lastScannedBarcode`
for the global "Last Scan" readout. Scan dispatch (`screens/SaleScreen/index.tsx`) runs in priority
order `member%%%<id>` → `00:<json>` PP barcode (`libs/pp-barcode.ts`) → plain
`GET /api/item/search/barcode`. Weight-embedded: a 12/13-char barcode starting `2`/`02` promotes
`weight` → `weight-prepacked`, and `libs/scan-utils.ts embededPriceParser` reads digits 8–12 as
cents (inverse of `libs/barcode-utils.ts fiveDigitFloat`).

`components/OnScreenKeyboard/usePhysicalKeyboard.ts` is the second key-event boundary: while an
`OnScreenKeyboard` instance is visible, it consumes mapped keydowns in the **capture phase** with
`stopPropagation`, so the scanner hook sees nothing while a keyboard is on screen. A module-level
mount-order registry arbitrates multiple instances — only the **last-mounted visible** one handles
(covers both CSS-`hidden` siblings and a `KeyboardInputText` overlay opened above an embedded
keyboard). Mapping lives in the pure `physical-key-map.ts` (dubeolsik by `e.code` position,
numpad-mode restriction, `Lang1`/`AltRight`/`HangulMode` = 한/영; CapsLock honored for Latin
letters, NumLock deliberately ignored). A barcode scanned while a keyboard is visible types into
the field — accepted trade-off, see
`docs/superpowers/specs/2026-08-04-physical-keyboard-input-design.md`.

## Printing

**ESC/POS (receipts, drawer)** — everything funnels through `libs/printer/print.service.ts`
`printESCPOS(bytes)`: `type === "serial"` → IPC `escpos:print` (persistent port, serialized write
queue); `type === "net"` → `POST http://{server}/api/printer/print?ip=&port=`, so **the local server
owns the TCP socket — main has no network ESC/POS path**. Two render modes per `receiptPrintMode`:
`raster` (576 px canvas → `GS v 0` slices in `libs/printer/escpos.ts`) or `escpos` (native commands
in `sale-invoice-escpos.ts` / `shift-settlement-escpos.ts`). Cash drawer =
`libs/printer/kick-drawer.ts`, same transport. All print call sites try/catch and only
`console.error` — printing must never block a sale.

**Labels (ZPL / SLCS)** — pure IPC `label:print` via `hooks/useZplPrinters.ts`; network labels go TCP
straight from main, never through the server. Serial label ports are hardcoded **115200/8/N/1
XON-XOFF**, opened fresh per job; SLCS Korean text is `euc-kr` via `iconv`.

## Broadcast Channels & Sockets

Main ↔ customer display is **`BroadcastChannel`, not IPC** — the two windows share one renderer
bundle: `pos-cart` (main → customer, `{carts, activeCartIndex, lineOffset}`, from
`hooks/useCartBroadcast.ts`), `pos-refresh` (customer/button → main, signal only), and
`pos-customer-data` (main → customer, `{storeSetting, posts}`).
No shared socket.io client — `components/SyncButton.tsx` opens its own
`io(apiService.getBaseURL())` for `cloud-sync-completed` (prompts a reload).
`hooks/useServerHealth.ts` polls `GET /ok` every 5 s (not a socket).

## Auto-Update & Testing

`src/main/updater.ts` (30 lines) no-ops unless `app.isPackaged`, checks **once at boot and never
again**, `autoDownload: true`, and on `update-downloaded` immediately `quitAndInstall(false, true)` —
**silent forced restart mid-shift, no prompt**. Feed comes from `package.json` `build.publish`.
No `test` script. `scripts/tests/*.test.ts` (3 files, some with an inline `node:module` resolver hook
to stub service imports) plus two colocated `*.test.mjs` run ad hoc:

```bash
node --experimental-strip-types scripts/tests/invoice-search-scan.test.ts
npm run test:label-core   # label-core + adapters, node:test
```

## Invariants & Footguns

- Renderer must not import `electron`, `fs`, `path`, or any Node API — native access is
  `window.electronAPI` only, and all HTTP belongs in `service/*.service.ts` (the `print.service.ts`
  raw-fetch is the one sanctioned exception).
- `serialport` (pinned 13.0.0) is the **only** native dependency; keep it that way, it is in
  `asarUnpack` for a reason. Never `nodeIntegration: true`, never `as any` / `@ts-ignore`.
- PaymentModal and `CloudHotkeyViewerV2` use **`div` tap targets, not `<button>`** — a focused button
  would be triggered by the HID scanner's Enter suffix. Do not "fix" this.
- Money is integer cents, qty/weight ×1000, percent ×1000 (`libs/constants.ts`). **`decimal.js` is a
  declared dependency but imported nowhere** — all math is `Math.round` on integers. Don't cite it
  as the convention. Dates use `dayjs` via `libs/dayjsAU.ts`; never `moment` here.
- `retail_pos_app/build/` (electron-builder `buildResources`, holds `icon.ico`/`icon.icns`) is
  **deleted in the current working tree** though present in git HEAD. CI checks out clean so it
  builds; a local `package:win` will not find the icon.
