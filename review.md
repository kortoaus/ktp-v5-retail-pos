# Retail POS — Codebase Review (from source code)

> Generated from actual code, not existing docs. For AI context continuity.

---

## Architecture

```
retail_pos_app (Electron)
  Renderer (React 19 + Zustand + decimal.js)  →  REST API  →  retail_pos_server (Express 5 + Prisma 7 + PostgreSQL)
  Main Process (SerialPort only — IPC bridge)
```

- **Terminal identification**: `ip-address` header → `terminalMiddleware` looks up Terminal + Company + StoreSetting + current open Shift. All injected into `res.locals`.
- **Auth**: Token is `userId%%%timestamp` in Authorization header. `userMiddleware` parses it, loads User. `scopeMiddleware(scope)` checks `user.scope` includes scope (or "admin" bypasses).
- **Decimal handling**: Prisma stores money as `Decimal(18,2)`. Server converts to JS numbers via `numberifySaleInvoice`/`numberifyRow`/`numberifyPayment` before sending to client. Client uses `decimal.js` for all calculations.

---

## Pricing

### Server Side (`item.service.ts`)
- `patchItemPriceService(items)` — attaches `price` (from Price table) and `promoPrice` (from PromoPrice, valid date range) to each item.
- Price model: `prices: Float[]` — array indexed by member level. `prices[0]` = base price, `prices[1]` = level 1 price, etc.
- PromoPrice: same `prices[]` array structure, with `validFrom`/`validTo` date window.

### Client Side (`salesStore.ts`)
- `resolveOriginalPrice(item)` → `item.price.prices[0]` (base price, always)
- `resolveDiscountedPrice(item, memberLevel)` → picks lowest of `prices[memberLevel]` and `promoPrice.prices[memberLevel]`, only if lower than original
- **Effective price resolution**: `unit_price_adjusted ?? unit_price_discounted ?? unit_price_original`
- **Line total**: `unit_price_effective × qty`, rounded to 2dp
- **Tax**: `total / 11` (GST inclusive, Australian style), rounded to 2dp. Subtotal = total - tax.
- **4-cart system**: Zustand store holds 4 independent carts, switchable via `switchCart(index)`
- **Member is per-cart**: Each cart has its own `SaleMember | null`. Setting member only affects the active cart and recalculates its lines.
- `clearActiveCart()` resets lines + member for the active cart only, other carts unaffected

### Item Types
- `normal` — standard qty item, mergeable in cart (same item + same prices = increment qty)
- `prepacked` — barcode-embedded price, qty derived from `barcodePrice / defaultPrice`
- `weight-prepacked` — barcode-embedded price, qty=1, name appended with "(Prepacked)"
- `weight` — scale-weighed, measured_weight tracked
- Supplier prepacked: `isPrepacked && defaultPrice <= 0` → use barcode price as original, no discount

### Barcode Resolution (`item.search.barcode.service.ts`)
1. Normalize barcode → GTIN14
2. Look up by GTIN14 first
3. If starts with "02"/"2" → extract PLU candidate, look up by PLU
4. Fallback: raw barcode contains search

---

## Payment (`usePaymentCalc.ts`)

### Calculation Chain
```
subTotal = Σ line.total
documentDiscountAmount = subTotal × percent OR fixed amount
exactDue = subTotal - documentDiscountAmount
roundedDue = exactDue rounded to nearest 5c (AUS rounding)
hasCash = any cash payment exists
effectiveDue = hasCash ? roundedDue : exactDue
effectiveRounding = hasCash ? (roundedDue - exactDue) : 0
```

### Surcharge
- `CREDIT_SURCHARGE_RATE` from StoreSetting (default 0.015 = 1.5%)
- Per credit payment line: `surcharge = r2(amount × rate)`
- `totalEftpos = totalCredit + totalSurcharge`
- **Surcharge is separate from sale total** — `cashPaid + creditPaid = total` always balances

### Tax (GST)
- `taxableRatio = Σ taxable line totals / subTotal`
- `goodsTaxAmount = r2(exactDue × taxableRatio / 11)`
- `surchargeTaxAmount = r2(totalSurcharge / 11)`
- `taxAmount = goodsTaxAmount + surchargeTaxAmount`
- Per-line tax allocation: **largest-remainder method** (`calTaxAmountByLineExact`) — floor each line's share, distribute remaining cents by largest fractional part

### Split Payments
- Multiple committed payments + staging cash/credit
- `remaining = effectiveDue - totalCash - totalCredit`
- `changeAmount = abs(remaining)` when negative (overpaid)
- `canPay = remaining <= 0`

---

## Sale Invoice Creation (`sale.service.ts`)

- Wraps in `db.$transaction`
- Copies StoreSetting fields (name, address, abn, phone, website, email) into invoice snapshot
- Creates invoice + rows + payments in one nested create
- Generates `serialNumber = companyId-shiftId-terminalId-invoiceId`
- Does NOT update shift tallies on sale creation (only refund does)

---

## Refund (`sale.refund.service.ts`)

### Server Validation (transactional)
1. Fetch original sale invoice + all existing refunds
2. **Per-row qty validation**: `refundQty ≤ originalQty - alreadyRefundedQty`
3. **Payment cap validation**: `cashRefund ≤ originalCash - alreadyRefundedCash`, same for credit
4. Create refund invoice (type="refund") with `original_invoice_id` link
5. Generate serial number
6. **Update shift**: increment `refundsCash` and `refundsCredit` (converted to cents)

### Refundable Invoice Query (`getRefundableSaleInvoiceByIdService`)
- Returns original invoice rows with computed `remainingQty`, `remainingTotal`, `remainingIncludedTaxAmount`
- Returns `remainingCash`, `remainingCredit` caps

### Client Side (`RefundScreen`)
- Search invoice → fetch refundable data → select items → RefundPaymentModal
- No surcharge on refunds, 5c rounding always applied

---

## Shift

### Schema (`TerminalShift`)
All money fields are **Int (cents)**:
- Opening: `startedCach`, `openedUserId`, `openedUser`, `openedAt`, `openedNote`
- Closing: `closedUserId`, `closedUser`, `closedAt`, `closedNote`, `endedCashExpected`, `endedCashActual`
- Tallies: `salesCash`, `salesCredit`, `salesTax`, `refundsCash`, `refundsCredit`, `refundsTax`, `cashIn`, `cashOut`, `totalCashIn`, `totalCashOut`

### Open Flow
- Client counts cash with CashCounter (denomination grid), sends cents
- Server validates no existing open shift, creates TerminalShift

### Close Flow
1. Client calls `POST /shift/close/data` → server sums invoices (Decimal) + cashios (Decimal), returns float summaries
2. Client shows summary panel + CashCounter for actual count
3. Client calculates: `expectedCash = startedCash + salesCash - refundsCash + cashIn - cashOut`
4. Client converts all floats → cents, sends `POST /shift/close`
5. Server writes all fields + closedUser/closedAt
6. Client fetches closed shift by ID, prints Z-report receipt
7. Double-confirm required (two taps)

### Note on Tallies
- **Sale creation does NOT update shift tallies** — tallies are computed at close time from actual invoices/cashios
- **Refund creation DOES increment** `refundsCash`/`refundsCredit` on shift (seems inconsistent — close overwrites anyway)

---

## Cash In/Out

- Model: `CashInOut` — `shiftId`, `terminalId`, `userId`, `userName`, `type` (in/out), `amount` (Decimal), `note`
- Server: CRUD with keyword search on userName/note, date range, pagination
- Client: `CashIOManageScreen` — `ServerPagingList` (no scroll, page buttons), `CashIOForm` with numpad + keyboard + kick drawer

---

## Store Settings

- Single row (id=1): company display info + `credit_surcharge_rate` (Float, e.g. 0.015) + `receipt_below_text`
- Client displays rate as percent (×100), sends back as decimal (÷100)
- `useStoreSetting()` hook fetches fresh on mount (no context cache)
- Scope-gated to "store"

---

## Cloud Sync (`cloud.migrate.service.ts`)

- Pulls items, categories, brands, prices, promo prices from cloud API
- Delta sync based on `lastUpdatedAt`
- Upserts everything locally
- Normalizes barcodes (GTIN, PLU)
- Also syncs Company data

---

## Receipt Printing

### Sale Receipt (`sale-invoice-receipt.ts`)
- Canvas-based rendering (576px width thermal)
- Header: store name, address, locality, ABN, phone, website (https:// prefix)
- Meta: invoice serial, date, terminal, member level
- Items: name (wrapped), qty/weight × price, total. `^` = price changed, `#` = GST applicable
- Totals: subtotal, discount, surcharge, rounding, TOTAL (includes surcharge)
- Payments: cash received/paid, change, credit paid (includes surcharge)
- Footer: GST included, You Saved, legend, belowText, QR code, COPY marker, print timestamp

### Refund Receipt (`refund-receipt.ts`)
- Same canvas style, "*** REFUND ***" banner
- Links to original invoice serial
- No surcharge section

### Shift Settlement Receipt (`shift-settlement-receipt.ts`)
- "SHIFT SETTLEMENT" / "Z-REPORT"
- All amounts from cents (÷100)
- Sections: meta, sales (cash/credit/tax), refunds (cash/credit/tax), cash in/out, drawer (started/expected/actual/difference)

---

## Key Scopes

```typescript
SCOPES = ["admin", "interface", "user", "hotkey", "refund", "cashio", "store"]
```
- "shift" scope exists in middleware but NOT in SCOPES constant
- "admin" bypasses all scope checks

---

## Routes

| Server Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/terminal/me` | GET | — | Terminal identity |
| `/api/shift/current` | GET | — | Current open shift |
| `/api/shift/open` | POST | user+shift | Open shift |
| `/api/shift/close/data` | POST | user+shift | Get closing summaries |
| `/api/shift/close` | POST | user+shift | Close shift |
| `/api/shift/:id` | GET | — | Get shift by ID |
| `/api/item/*` | GET | — | Item search/barcode |
| `/api/sale/invoice/create` | POST | user | Create sale |
| `/api/sale/invoices` | GET | — | Search invoices |
| `/api/sale/invoice/:id` | GET | — | Get invoice |
| `/api/sale/invoice/:id/refundable` | GET | — | Get refundable invoice |
| `/api/sale/refund` | POST | user | Create refund |
| `/api/cashio` | GET/POST | user+cashio | Cash in/out CRUD |
| `/api/store` | GET/POST | (POST: user+store) | Store settings |
| `/api/user/*` | GET/POST | (POST: user+user) | User CRUD |
| `/api/hotkey/*` | various | — | Hotkey CRUD |
| `/api/cloud/*` | POST | — | Cloud sync |
| `/api/printer/*` | POST | — | Server-side print |
| `/api/crm/*` | GET | — | Member lookup |

---

## Potential Issues / Notes

1. **Sale creation doesn't update shift tallies** but refund does — close-time recalculation makes the refund increment redundant/inconsistent
2. **"shift" scope not in SCOPES constant** — UI won't show it as a checkbox in UserForm
3. **Serial number format** `companyId-shiftId-terminalId-invoiceId` — not padded, could be inconsistent lengths
4. **Refund uses Company data** for receipt (not StoreSetting) — different from sale which uses StoreSetting
5. **No server-side sale total validation** — client sends all calculated values, server trusts them
6. **CashCounter overflow** — denomination grid with numpad, no max validation on counts
