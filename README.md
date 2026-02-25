# Retail POS

Retail point-of-sale system for Australian supermarkets. Monorepo with two projects: Electron desktop app + Express REST API server.

### Quick Links

- [Pricing Rules](./retail_pos_app/docs/pricing_rules.md) · [가격 계산 규칙](./retail_pos_app/docs/pricing_rules_ko.md)
- [Payment Rules](./retail_pos_app/docs/payment_rules.md) · [결제 계산 규칙](./retail_pos_app/docs/payment_rules_ko.md)
- [Refund Rules](./retail_pos_app/docs/refund_rules.md) · [환불 규칙](./retail_pos_app/docs/refund_rules_ko.md)
- [External Device Plan](./retail_pos_app/docs/external_device_plan.md)
- [SLCS Printer Language](./retail_pos_app/docs/slcs.md)
- [How to Read a Sale Receipt](./retail_pos_app/docs/how_to_read_sale_invoice_receipt.md)

## Architecture

```
┌─────────────────────────────────────────────┐
│  retail_pos_app (Electron)                  │
│  ┌───────────────────────────────────────┐  │
│  │ Renderer (React SPA)                  │  │  ← UI, business logic
│  │  HashRouter, Tailwind, decimal.js     │  │
│  └──────────────┬────────────────────────┘  │
│                 │ IPC (serial only)          │
│  ┌──────────────┴────────────────────────┐  │
│  │ Main Process                          │  │  ← serialport, label printing
│  └───────────────────────────────────────┘  │
└──────────────────────┬──────────────────────┘
                       │ REST API (LAN)
┌──────────────────────┴──────────────────────┐
│  retail_pos_server (Express)                │
│  Prisma 7 + PostgreSQL                      │  ← items, pricing, users, shifts, CRM
└─────────────────────────────────────────────┘
```

## Stack

### Desktop App (`retail_pos_app`)

| Layer      | Technology                    | Version |
| ---------- | ----------------------------- | ------- |
| Shell      | Electron                      | 40.x    |
| Build      | electron-vite                 | 5.x     |
| Renderer   | React + TypeScript            | 19 / 5  |
| Styling    | Tailwind CSS                  | 4.x     |
| Routing    | react-router-dom (HashRouter) | 7.x     |
| Serial     | serialport (pinned)           | 13.0.0  |
| Encoding   | iconv-lite                    | SLCS euc-kr |
| Hangul     | es-hangul                     | keyboard composition |
| Math       | decimal.js                    | money/qty precision |
| Packaging  | electron-builder              | 26.x    |

### Server (`retail_pos_server`)

| Layer    | Technology | Version |
| -------- | ---------- | ------- |
| Runtime  | Node.js    | 22.x    |
| Framework | Express   | 5.x     |
| ORM      | Prisma     | 7.x     |
| Database | PostgreSQL | via pg  |
| Auth     | jsonwebtoken | 9.x   |
| Timezone | moment-timezone | AU/Sydney |

## App Boot Flow

1. Main process starts → registers IPC handlers → creates window
2. Auto-connect scale if configured in `app-config.json`
3. Renderer loads → `TerminalContext` reads config
4. No server configured? → `ServerSetupScreen` (enter host:port, tests `/health`)
5. Server configured → sets `apiService` baseURL + `ip-address` header → fetches `/api/terminal/me`
6. Terminal not found? → error screen with retry
7. Terminal found → `ShiftContext` fetches current shift → app renders
8. On quit → `cleanupAll()` (disconnects scale, closes serial ports)

## App Routes

| Route | Screen | Purpose |
| ----- | ------ | ------- |
| `/` | HomeScreen | Landing / navigation |
| `/sale` | SaleScreen | Main POS register |
| `/labeling` | LabelingScreen | Scan → print labels |
| `/server-setup` | ServerSetupScreen | Configure server connection |
| `/shift/open` | OpenShiftScreen | Open shift with cash count |
| `/manager/settings` | InterfaceSettingsScreen | App settings |
| `/manager/test` | TestScreen | Hardware testing |
| `/manager/hotkey` | HotkeyManagerScreen | Quick-select grid CRUD |
| `/manager/user` | UserManageScreen | User account management |
| `/sale/invoices` | SaleInvoiceSearchScreen | Invoice search, reprint |
| `/refund` | RefundScreen | Refund against sale invoice |

## Server API Routes

All routes prefixed with `/api`:

| Prefix | Module | Purpose |
| ------ | ------ | ------- |
| `/terminal` | Terminal | Terminal registration, `/me` |
| `/shift` | Shift | Open/close shifts |
| `/item` | Item | Item search, barcode lookup |
| `/hotkey` | Hotkey | Quick-select grid CRUD |
| `/crm` | CRM | Member lookup |
| `/user` | User | User CRUD, auth by code |
| `/sale` | Sale | Create & query sale/refund invoices |
| `/printer` | Printer | Server-side print (raw data) |
| `/cloud` | Cloud | Sync with cloud system |

## Features

### Sales

- 4-cart system with pricing engine and member levels
- Barcode scan → item lookup → add to cart
- Line functions: change qty, override price, discount $, discount %
- On-screen keyboard (Korean dubeolsik + English + numpad)
- Item search modal with keyboard
- Hotkeys: touchscreen 6×6 grid for quick item selection

### Payment
- Credit card surcharge (1.5%, separate from sale total)
- Australian 5c rounding (cash payments only)
- Split cash/credit, note denomination quick-add buttons
- Per-line GST allocation via largest-remainder method (`includedTaxAmount`)
- Tax split: `goodsTaxAmount` (goods) + `surchargeTaxAmount` (surcharge)
- Auto-fill: double-tap Credit fills exactDue, double-tap Cash fills remaining
- All math via `decimal.js`, rounded to 2dp at each step
- See `retail_pos_app/docs/payment_rules.md` for full calculation chain

### Refunds
- Refund against any completed sale invoice
- Full or partial refund — by item and by quantity
- Proportional amount calculation; uses exact remaining values when refunding last unit
- Cash/credit split capped at original payment method amounts (server-enforced)
- No surcharge on refund, 5c rounding always applied
- Server-side race condition protection (transactional validation)
- Separate refund receipt template (`*** REFUND ***`)
- Reprint sale → continuous print of sale + all linked refund receipts, single paper cut
- Shift settlement tracks `refundsCash` / `refundsCredit` separately
- See `retail_pos_app/docs/refund_rules.md` for full rules

### Shift Management

- `ShiftContext` — global state with `shift`, `openShift()`, `reloadShift()`
- Open shift screen with cash counter (denomination grid + numpad) + note
- Blocks opening if shift already exists

### User Management

- Admin screen with list + inline editor
- On-screen keyboard: numpad for code (digits only), full keyboard for name
- State-driven pagination

### Label Printing

- ZPL and SLCS (Bixolon) printer languages
- Network and serial connections
- Label types: normal, prepacked (embedded price), weight, weight-prepacked

### Hardware

| Device | Connection | Status |
| ------ | ---------- | ------ |
| CAS Scale (PD-II) | Serial | Done |
| Datalogic Scale + Scanner | Serial (shared) | Done |
| USB HID Barcode Scanner | Keyboard emulation | Done |
| Label Printer (ZPL) | Network / Serial | Done |
| Label Printer (SLCS/Bixolon) | Network / Serial | Done |
| ESC/POS Receipt Printer | Network | Done |

## App Config

Persisted at `{userData}/app-config.json`:

```json
{
  "server": { "host": "192.168.1.100", "port": 2200 },
  "devices": {
    "scale": { "type": "CAS", "path": "COM3", "baudRate": 9600 },
    "zplSerial": { "path": "COM4", "language": "slcs" },
    "zplNet": [{ "name": "Label 1", "host": "192.168.1.50", "port": 9100, "language": "zpl" }],
    "escposPrinter": { "host": "192.168.1.52", "port": 9100 }
  }
}
```

## IPC Channels (App)

| Channel | Direction | Purpose |
| ------- | --------- | ------- |
| `app:get-network-ip` | renderer → main | Machine IPv4 |
| `config:get/set` | renderer → main | AppConfig read/write |
| `serial:list-ports` | renderer → main | List serial ports |
| `serial:open/close/send` | renderer → main | Raw serial ops |
| `serial:data` | main → renderer | Serial data push |
| `scale:connect/disconnect` | renderer → main | Scale lifecycle |
| `scale:read-weight` | renderer → main | Read weight |
| `scale:status` | renderer → main | Connection status |
| `barcode:scan` | main → renderer | Datalogic serial scan |
| `label:print` | renderer → main | Send label to printer |

## Commands

### App

```bash
cd retail_pos_app
npm run dev              # Dev with HMR
npm run build            # Production build
npm run package:win      # NSIS installer (x64)
npm run package:mac      # DMG (x64 + arm64)
npm run package:all      # Both platforms
```

### Server

```bash
cd retail_pos_server
npm run dev              # nodemon dev server
npm run build            # TypeScript compile
npm run start            # Production (node dist/index.js)
```

## Cross-Platform Build (App)

Dev on Mac, production 90%+ Windows. Native modules (`serialport`) must be rebuilt per-OS.

**Do not copy `node_modules` between machines.** Always `npm install` fresh.

Windows prerequisites: Node.js 22, Visual Studio Build Tools (C++ workload), Python 3.

## Docs

| Document | Purpose |
| -------- | ------- |
| `retail_pos_app/docs/pricing_rules.md` | Pricing rules for all item types (EN) |
| `retail_pos_app/docs/pricing_rules_ko.md` | 가격 계산 규칙 (KO) |
| `retail_pos_app/docs/payment_rules.md` | Payment calculation rules (EN) |
| `retail_pos_app/docs/payment_rules_ko.md` | 결제 계산 규칙 (KO) |
| `retail_pos_app/docs/refund_rules.md` | Refund rules and payment caps (EN) |
| `retail_pos_app/docs/refund_rules_ko.md` | 환불 규칙 (KO) |
| `retail_pos_app/docs/external_device_plan.md` | External device integration plan |
| `retail_pos_app/docs/slcs.md` | Bixolon SLCS label printer command reference |
| `retail_pos_app/docs/how_to_read_sale_invoice_receipt.md` | How to read a printed sale receipt |
## What's Next

- [x] Sales store (4 carts, pricing engine, member levels)
- [x] On-screen keyboard (Korean dubeolsik + English + numpad)
- [x] Item search modal, weight read modal, barcode scan flow
- [x] SaleScreen line function modals (qty, price, discount)
- [x] Label printing (ZPL + SLCS, 4 label types)
- [x] User management (list + inline editor + on-screen keyboard)
- [x] Shift management (context + open shift with cash counter)
- [x] Payment modal (discount, surcharge, 5c rounding, split cash/credit)
- [x] Payment rules documentation (EN + KO)
- [x] ESC/POS receipt printer driver
- [x] Receipt generation from OnPaymentPayload
- [x] Invoice search screen (keyword, date range, member, barcode scan)
- [x] Invoice search modal (`SearchInvoiceModal` + shared `InvoiceSearchPanel`)
- [x] Labeling screen with persistent weight scale panel + auto-polling
- [x] Per-line tax allocation (`includedTaxAmount`) for refund accuracy
- [x] Refund screen (select invoice → view refundable rows → refund)
- [x] Refund payment modal (cash/credit split, capped at original amounts)
- [x] Refund receipt printing + continuous sale+refund reprint
- [x] Touch-friendly input components (`KeyboardInputText`, `DateRangeSelector`)
- [x] Server Decimal→number conversion (`numberifySaleInvoice`, `numberifyRow`)
- [ ] Store configuration (credit card surcharge rate, tax rate, receipt footer)
- [ ] Close shift flow (cash count, expected vs actual, Z-report print)
- [ ] Cash in/out (petty cash, float top-up — tracked on shift)
- [ ] SaleScreen UI polish (cart switching indicator, totals display)
- [ ] Reprint last receipt (one-tap from sale screen)
- [ ] Cloud sync (invoices, shifts)
- [ ] More label templates

Reports, analytics, and benchmarking are handled by the cloud app only — the POS does not store or display reporting data locally.
