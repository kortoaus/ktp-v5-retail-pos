# Retail POS

Retail point-of-sale system for Australian supermarkets. Monorepo with two projects: Electron desktop app + Express REST API server.

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
| `/price-tag`        | PriceTagScreen          | —     | —         | Print item price tags       |
| `/server-setup`     | ServerSetupScreen       | —     | —         | Configure server connection |
| `/shift/open`       | OpenShiftScreen         | No    | shift     | Open shift with cash count  |
| `/shift/close`      | CloseShiftScreen        | Yes   | shift     | Close shift with Z-report   |
| `/manager/settings` | InterfaceSettingsScreen | —     | interface | App settings                |
| `/manager/test`     | TestScreen              | —     | —         | Hardware testing            |
| `/manager/hotkey`   | HotkeyManagerScreen     | —     | hotkey    | Quick-select grid CRUD      |
| `/manager/user`     | UserManageScreen        | —     | user      | User account management     |
| `/manager/invoices` | SaleInvoiceSearchScreen | —     | —         | Invoice search, reprint     |
| `/manager/refund`   | RefundScreen            | Yes   | refund    | Refund against sale invoice |
| `/manager/cashio`   | CashIOManageScreen      | Yes   | cashio    | Cash in/out management      |
| `/manager/store`    | StoreSettingScreen      | —     | store     | Store settings              |
| `/customer-display` | CustomerScreen          | —     | —         | Customer-facing display     |

## Server API Routes

All routes prefixed with `/api`. Terminal middleware identifies terminal + company + store settings + current shift by IP address.

| Prefix      | Module   | Auth          | Purpose                             |
| ----------- | -------- | ------------- | ----------------------------------- |
| `/terminal` | Terminal | —             | Terminal registration, `/me`        |
| `/shift`    | Shift    | user + shift  | Open/close shifts, closing data     |
| `/item`     | Item     | —             | Item search, barcode lookup         |
| `/hotkey`   | Hotkey   | —             | Quick-select grid CRUD              |
| `/crm`      | CRM      | —             | Member lookup (by phone, by ID)     |
| `/user`     | User     | user + user   | User CRUD, auth by code             |
| `/sale`     | Sale     | user + sale   | Create / spend / query / latest     |
| `/voucher`  | Voucher  | user + sale   | Staff daily voucher list / issue    |
| `/printer`  | Printer  | —             | Server-side print (raw data)        |
| `/cloud`    | Cloud    | —             | Sync with cloud system              |
| `/cashio`   | CashIO   | user + cashio | Cash in/out CRUD with search        |
| `/store`    | Store    | user + store  | Store settings (GET/POST)           |

## Features

### Sales

- 4 independent carts with per-cart member assignment
- Barcode scan → GTIN → PLU → raw lookup chain (한글 IME 무관 — `e.code` 기반)
- QR scan: `member%%%{id}` assigns member, `receipt%%%{serial}` searches invoice
- Item types: normal, prepacked, weight, weight-prepacked
- Weight items: auto-read on modal open + 500ms polling when `autoPolling` enabled
- Normal item merge (same item + same price = qty increment)
- Line functions: change qty, override price, discount $, discount % (모두 line-level
  `unit_price_adjusted` 로 반영 — document-level discount 는 D-17 에서 제거)
- SPEND toggle (internal consumption): PaymentModal 안에서 toggle ON → cart 를
  type=SPEND invoice 로 기록 (payments 없음, 금액 0). D-14~16, D-29.
- On-screen keyboard (Korean dubeolsik + English + numpad)
- Hotkeys: touchscreen 6×6 grid for quick item selection

### Pricing

- Price arrays indexed by member level: `prices[0]` = base, `prices[N]` = level N
- Item-level promo prices (`PromoPrice`) with valid date range, same array structure — kept intentionally; cart-level/rule-based promotions removed (D-17)
- Effective price = `adjusted ?? discounted ?? original`
- Discounted = lowest of `prices[level]` and `promoPrice[level]`, only if < original
- Prepacked: embedded price from PP barcode → `unit_price_adjusted`
- Member change recalculates all lines in active cart

### Payment

- Credit card surcharge (configurable rate from Store Settings, default 1.5%). `payment.amount` for CREDIT is EFTPOS keyed-in value (includes surcharge, D-10)
- Tenders: CASH / CREDIT / VOUCHER (user-voucher / customer-voucher) / GIFTCARD. GIFTCARD = "CREDIT without surcharge" (D-24)
- Staff daily voucher: cashier issues on-spot from Search modal; balance decrements via `VoucherEvent REDEEM` on sale
- `total = linesTotal + rounding + creditSurchargeAmount`, `Σ payments.amount == total` (D-12)
- Tax: `lineTax = Σ row.tax_amount`, `surchargeTax = round(creditSurchargeAmount / 11)` (D-27). `invoice.lineTax` / `invoice.surchargeTax` 두 컬럼
- AU 5¢ rounding: cash-only mode (nonCashBill == 0 && cashIntent ≥ roundedCashTarget) 만 (D-30). Mixed / card-only 는 exact
- Split cash / credit / voucher / giftcard. Staged draft 가 active 면 `Complete Sale` 시 자동 포함 (1-step flow)
- `payment.amount` CASH 는 split 여부 무관 단일 payment 로 집약 (amount = cashApplied, change 는 invoice.cashChange, D-32)
- Serial: `{shift.id}-{YYYYMMDD}-{S|R|P}{seq6}` via `DocCounter` atomic increment (D-28)
- Server 가 invariant 검증 + row 별 `surcharge_share` 비례 배분 저장 + voucher REDEEM 트랜잭션 처리

### Refunds (in progress — service / UI 미구현)

- Refund against any completed sale invoice (shift required)
- Full or partial refund per row (per-row cap = `qty - refunded_qty`)
- **Surcharge 비례 환불** (D-26, revised) — GST 대칭 / EFTPOS 정산 대칭 / 소비자 공정
- Per-row refund math: `refund_row.total = round((row.total + row.surcharge_share) × refund_qty / row.qty)`
- `rounding_share` 는 없음. Refund invoice 가 자체 cash rounding 재계산 (tender 가 CASH 일 때만)
- Cash/credit/voucher/giftcard 모두 원본 tender 로 환불. Voucher 는 `VoucherEvent REFUND` + balance increment
- Customer voucher 포함 invoice 는 CRM 오프라인 시 환불 거부 (D-21)

### Shift Management

- One shift per terminal at a time
- Open: cash counter (denomination grid, 999 cap) + note
- Close: server sums invoices + cashios (D-34 — no increment cache, always re-aggregate via `SUM()`), count actual cash, double-confirm, Z-report auto-print
- Expected cash = `startedCash + salesCash − refundsCash + totalCashIn − totalCashOut`
- Shift tracks per-tender: `salesCash / salesCredit / salesVoucher / salesGiftcard` + refunds mirror, plus `salesCreditSurcharge / refundsCreditSurcharge / salesTax / refundsTax` (D-27, D-33)
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

### Customer Display

- Secondary screen on external monitor (auto-detected, fullscreen, frameless)
- **Idle mode**: Rotates cloud posts (image + Tiptap rich text) with 5s slide-up transition; falls back to store info
- **Active mode**: Mirrors current cart lines and document totals via BroadcastChannel
- Data refresh: customer screen requests `pos-refresh` on mount + every 10 min; main window responds with storeSetting + posts on `pos-customer-data`
- Manual refresh: "Posts" button in main window triggers `pos-refresh` for urgent updates

### Inter-Window Communication (BroadcastChannel)

| Channel             | Direction              | Payload                                  | Trigger                          |
| ------------------- | ---------------------- | ---------------------------------------- | -------------------------------- |
| `pos-cart`          | Main → Customer        | `{ carts, activeCartIndex, lineOffset }` | Real-time cart state changes     |
| `pos-refresh`       | Customer/Button → Main | `"refresh"` (signal only)                | Mount, 10 min poll, manual sync  |
| `pos-customer-data` | Main → Customer        | `{ storeSetting, posts }`                | On refresh signal or data change |

### Receipts

- **Sale**: store header, items (`^` = price changed, `#` = GST applicable, `!` = saved), totals, tender-by-tender payments, GST Included, You Saved, Vouchers Used (entityLabel list), QR code (`receipt%%%serial`), footer
- **Refund**: "*** REFUND ***" banner, links original invoice id, same row/payment structure with "Refunded" labels
- **Spend**: "*** INTERNAL ***" banner, rows only (prices `-`), no totals/payments, footer "Internal consumption - no payment"
- **Z-report**: shift settlement (tender별 sales/refunds, cashio, drawer expected vs actual)
- All: 576px canvas → ESC/POS thermal print. `** COPY **` marker on reprint
- Touchscreen tap-through guard: ModalContainer keeps invisible backdrop 100ms after close

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

| Scope     | Allows                                 |
| --------- | -------------------------------------- |
| admin     | Full access, bypasses all scope checks |
| interface | Interface/display settings             |
| user      | User account CRUD                      |
| hotkey    | Hotkey grid CRUD                       |
| refund    | Process refunds                        |
| cashio    | Cash in/out records                    |
| store     | Store settings                         |
| shift     | Open and close shifts                  |

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

- [x] Reprint last receipt (`PrintLatestInvoiceButton`)
- [x] Server-side payment validation (row totals / taxes / payment sum — `sale.create.service.ts`)
- [ ] Refund service + `RefundScreen` (D-26 surcharge 비례 환불)
- [ ] Shift close re-aggregation rewrite (D-34)
- [ ] Cloud sync push (invoice / shift → cloud)
- [ ] Linkly EFTPOS + GiftCard provider API (Phase 4)
- [ ] More label templates

Reports and analytics are handled by the cloud app — the POS does not store reporting data locally.

Domain decisions log: `docs/sale-domain.md` (D-1 … D-36).
