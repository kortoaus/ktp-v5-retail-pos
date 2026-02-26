# Retail POS

Retail point-of-sale system for Australian supermarkets. Monorepo with two projects: Electron desktop app + Express REST API server.

### User Manual

- [User Manual (English)](./manual/index.md)
- [User Manual (Korean)](./manual_ko/index.md)

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

| Layer     | Technology                    | Version              |
| --------- | ----------------------------- | -------------------- |
| Shell     | Electron                      | 40.x                 |
| Build     | electron-vite                 | 5.x                  |
| Renderer  | React + TypeScript            | 19 / 5               |
| Styling   | Tailwind CSS                  | 4.x                  |
| State     | Zustand                       | 5.x                  |
| Routing   | react-router-dom (HashRouter) | 7.x                  |
| Serial    | serialport (pinned)           | 13.0.0               |
| Encoding  | iconv-lite                    | SLCS euc-kr          |
| Hangul    | es-hangul                     | keyboard composition |
| Math      | decimal.js                    | money/qty precision  |
| Icons     | react-icons (io5)             | UI icons             |
| Packaging | electron-builder              | 26.x                 |

### Server (`retail_pos_server`)

| Layer     | Technology      | Version   |
| --------- | --------------- | --------- |
| Runtime   | Node.js         | 22.x      |
| Framework | Express         | 5.x       |
| ORM       | Prisma          | 7.x       |
| Database  | PostgreSQL      | via pg    |
| Auth      | Token-based     | userId%%% |
| Timezone  | moment-timezone | AU/Sydney |

## App Routes

| Route               | Screen                  | Shift | Scope     | Purpose                     |
| ------------------- | ----------------------- | ----- | --------- | --------------------------- |
| `/`                 | HomeScreen              | —     | —         | Landing / navigation        |
| `/sale`             | SaleScreen              | Yes   | —         | Main POS register           |
| `/labeling`         | LabelingScreen          | —     | —         | Scan → print labels         |
| `/server-setup`     | ServerSetupScreen       | —     | —         | Configure server connection |
| `/shift/open`       | OpenShiftScreen         | No    | shift     | Open shift with cash count  |
| `/shift/close`      | CloseShiftScreen        | Yes   | shift     | Close shift with Z-report   |
| `/manager/settings` | InterfaceSettingsScreen  | —     | interface | App settings                |
| `/manager/test`     | TestScreen              | —     | —         | Hardware testing            |
| `/manager/hotkey`   | HotkeyManagerScreen     | —     | hotkey    | Quick-select grid CRUD      |
| `/manager/user`     | UserManageScreen        | —     | user      | User account management     |
| `/manager/invoices` | SaleInvoiceSearchScreen | —     | —         | Invoice search, reprint     |
| `/manager/refund`   | RefundScreen            | Yes   | refund    | Refund against sale invoice |
| `/manager/cashio`   | CashIOManageScreen      | Yes   | cashio    | Cash in/out management      |
| `/manager/store`    | StoreSettingScreen      | —     | store     | Store settings              |

## Server API Routes

All routes prefixed with `/api`. Terminal middleware identifies terminal + company + store settings + current shift by IP address.

| Prefix      | Module   | Auth               | Purpose                              |
| ----------- | -------- | ------------------ | ------------------------------------ |
| `/terminal` | Terminal | —                  | Terminal registration, `/me`         |
| `/shift`    | Shift    | user + shift       | Open/close shifts, closing data      |
| `/item`     | Item     | —                  | Item search, barcode lookup          |
| `/hotkey`   | Hotkey   | —                  | Quick-select grid CRUD               |
| `/crm`      | CRM      | —                  | Member lookup                        |
| `/user`     | User     | user + user        | User CRUD, auth by code              |
| `/sale`     | Sale     | user + refund      | Create & query sale/refund invoices  |
| `/printer`  | Printer  | —                  | Server-side print (raw data)         |
| `/cloud`    | Cloud    | —                  | Sync with cloud system               |
| `/cashio`   | CashIO   | user + cashio      | Cash in/out CRUD with search         |
| `/store`    | Store    | user + store       | Store settings (GET/POST)            |

## Features

### Sales

- 4 independent carts with per-cart member assignment
- Barcode scan → GTIN → PLU → raw lookup chain
- Item types: normal, prepacked, weight, weight-prepacked
- Normal item merge (same item + same price = qty increment)
- Line functions: change qty, override price, discount $, discount %
- On-screen keyboard (Korean dubeolsik + English + numpad)
- Hotkeys: touchscreen 6×6 grid for quick item selection

### Pricing

- Price arrays indexed by member level: `prices[0]` = base, `prices[N]` = level N
- Promo prices with valid date range, same array structure
- Effective price = `adjusted ?? discounted ?? original`
- Discounted = lowest of `prices[level]` and `promoPrice[level]`, only if < original
- Prepacked: qty = barcodePrice ÷ unit price
- Member change recalculates all lines in active cart

### Payment

- Credit card surcharge (configurable rate from Store Settings, default 1.5%)
- Surcharge separate from sale total: `cashPaid + creditPaid = total`
- Australian 5c rounding (cash payments only)
- Split cash/credit with committed payment lines
- Per-line GST allocation via largest-remainder method
- Tax: `goodsTax = exactDue × taxableRatio ÷ 11`, `surchargeTax = surcharge ÷ 11`
- Server-side validation: row totals ≈ subtotal, payment ≈ total
- All math via `decimal.js`

### Refunds

- Refund against any completed sale invoice (shift required)
- Full or partial refund by item and quantity
- Cash/credit capped at original payment method amounts (server-enforced)
- No surcharge on refunds, 5c rounding applied
- Refund receipt uses StoreSetting data (consistent with sale)

### Shift Management

- One shift per terminal at a time
- Open: cash counter (denomination grid, 999 cap) + note
- Close: server sums invoices + cashios, count actual cash, double-confirm, Z-report auto-print
- Expected cash = started + salesCash − refundsCash + cashIn − cashOut
- All shift money stored in cents (Int)

### Cash In / Out

- Cash in (float top-up) and cash out (petty cash) during shift
- Search by keyword and date range
- Tracked on shift settlement

### Store Settings

- Store display info, credit surcharge rate (% ↔ decimal), receipt footer
- `useStoreSetting()` hook — fresh fetch on mount
- 2-column form, no scrolling

### User Management

- Code-based login, scopes: admin, interface, user, hotkey, refund, cashio, store, shift
- Admin (ID 1) bypasses all scope checks, cannot be edited
- ServerPagingList with search

### Receipts

- **Sale**: store header, items (^=price changed, #=GST), totals, payments, QR code, footer
- **Refund**: "*** REFUND ***" banner, links original serial, StoreSetting data
- **Z-report**: shift settlement (sales/refunds/cashio, drawer expected vs actual)
- All: 576px canvas → ESC/POS thermal print

### Hardware

| Device                       | Connection         | Status |
| ---------------------------- | ------------------ | ------ |
| CAS Scale (PD-II)            | Serial             | Done   |
| Datalogic Scale + Scanner    | Serial (shared)    | Done   |
| USB HID Barcode Scanner      | Keyboard emulation | Done   |
| Label Printer (ZPL)          | Network / Serial   | Done   |
| Label Printer (SLCS/Bixolon) | Network / Serial   | Done   |
| ESC/POS Receipt Printer      | Serial             | Done   |
| Cash Drawer                  | Via ESC/POS kick   | Done   |

## Permissions

| Scope     | Allows                                        |
| --------- | --------------------------------------------- |
| admin     | Full access, bypasses all scope checks        |
| interface | Interface/display settings                    |
| user      | User account CRUD                             |
| hotkey    | Hotkey grid CRUD                              |
| refund    | Process refunds                               |
| cashio    | Cash in/out records                            |
| store     | Store settings                                |
| shift     | Open and close shifts                         |

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
npm run start            # Production
npx prisma generate      # Regenerate Prisma client
npx prisma db push       # Push schema to database
```

## What's Next

- [ ] Reprint last receipt (one-tap from sale screen)
- [ ] Cloud sync (invoices, shifts → cloud)
- [ ] More label templates

Reports and analytics are handled by the cloud app — the POS does not store reporting data locally.
