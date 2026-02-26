# Functional Test Checklist

---

## Shift

- [ ] Open shift with cash count → verify started cash stored correctly (cents)
- [ ] Cannot open shift when one is already open
- [ ] Close shift → summary shows correct sales/refunds/cashio totals
- [ ] Close shift → expected cash = started + salesCash - refundsCash + cashIn - cashOut
- [ ] Close shift → difference color: green (match), red (short), blue (over)
- [ ] Close shift → double-confirm required (two taps)
- [ ] Close shift → Z-report receipt prints automatically
- [ ] Close shift → shift becomes null, HomeScreen shows "Open Shift" again
- [ ] Close shift → note saved correctly
- [ ] CashCounter denomination count capped at 999
- [ ] Kick Drawer button works from CashCounter

---

## Sale

- [ ] Add normal item → merges with existing same-item line (qty increments)
- [ ] Add prepacked item → qty derived from barcodePrice / defaultPrice
- [ ] Add weight-prepacked item → qty=1, name shows "(Prepacked)"
- [ ] Add weight item → measured_weight tracked
- [ ] Barcode scan → resolves by GTIN14, then PLU, then raw
- [ ] Member level pricing → lowest of level price and promo price applied
- [ ] Price override (inject price) → adjustments includes "PRICE_OVERRIDE"
- [ ] Change qty → line total recalculated
- [ ] Remove line → reindexed correctly
- [ ] 4-cart system → switch between carts, each independent
- [ ] Clear cart → resets lines and member

---

## Payment

- [ ] Subtotal = sum of line totals
- [ ] Document discount (%) → correct percentage applied
- [ ] Document discount ($) → fixed amount applied
- [ ] 5c rounding applied only when cash payment exists
- [ ] No rounding when credit-only payment
- [ ] Credit surcharge = amount × rate (from StoreSetting)
- [ ] Surcharge rate reflects StoreSetting value (not hardcoded)
- [ ] Split cash/credit payment → both recorded
- [ ] Change calculated correctly when overpaying with cash
- [ ] Cannot pay when remaining > 0
- [ ] GST = goodsTax + surchargeTax
- [ ] Per-line tax allocation (largest-remainder) sums to goodsTaxAmount exactly
- [ ] Server rejects sale if row totals don't match subtotal
- [ ] Server rejects sale if payment total doesn't match total
- [ ] Server rejects sale if total doesn't match subtotal - discount + rounding
- [ ] Serial number generated: companyId-shiftId-terminalId-invoiceId

---

## Refund

- [ ] Search invoice → only sale invoices selectable for refund
- [ ] Refundable rows show remaining qty (original - already refunded)
- [ ] Cannot refund more qty than remaining
- [ ] Weight-prepacked → all-or-nothing refund
- [ ] Qty=1 or remaining=1 → added directly, no qty modal
- [ ] Qty>1, remaining>1 → qty input modal appears
- [ ] Cash refund capped at original cash paid - already refunded cash
- [ ] Credit refund capped at original credit paid - already refunded credit
- [ ] No surcharge on refund
- [ ] 5c rounding applied on refund
- [ ] Refund invoice links to original via original_invoice_id
- [ ] Refund receipt prints with "*** REFUND ***" banner
- [ ] Refund receipt uses StoreSetting data (not Company)
- [ ] Multiple partial refunds → remaining qty decreases correctly each time
- [ ] Reprint sale → continuous print of sale + all linked refund receipts

---

## Cash In / Out

- [ ] Create cash in → type "in", amount saved correctly
- [ ] Create cash out → type "out", amount saved correctly
- [ ] Note saved (optional)
- [ ] Kick Drawer button works from CashIOForm
- [ ] List shows type badge (green IN / red OUT), amount, user, note, time
- [ ] Search by keyword (name or note) → Search button triggers, not on-change
- [ ] Date range filter works
- [ ] Pagination (ServerPagingList) → page buttons work, no scrolling
- [ ] Scope-gated to "cashio" → unauthorized user sees block screen

---

## Store Settings

- [ ] Loads current settings on mount
- [ ] All fields editable: name, phone, address, suburb, state, postcode, country, abn, website, email, surcharge rate, receipt footer
- [ ] Credit surcharge rate displayed as percent (e.g. 1.5), saved as decimal (0.015)
- [ ] Numpad for phone/postcode/abn/surcharge, keyboard for text fields
- [ ] Save → updates server
- [ ] Scope-gated to "store"
- [ ] 2-column form layout, no scrolling

---

## User Management

- [ ] List users with ServerPagingList (no scrolling)
- [ ] Search by keyword → Search button triggers
- [ ] Create user → name, code, scopes, save
- [ ] Edit user → select from list, form populates
- [ ] Toggle archived
- [ ] All scopes visible as checkboxes (including "shift" and "store")
- [ ] Scope-gated to "user"

---

## Receipts

- [ ] Sale receipt: store name, address, ABN, phone, website (https:// prefix if exists)
- [ ] Sale receipt: items with ^ (price changed) and # (GST) markers
- [ ] Sale receipt: TOTAL includes surcharge
- [ ] Sale receipt: QR code from serial number
- [ ] Sale receipt: belowText from StoreSetting receipt_below_text
- [ ] Refund receipt: "*** REFUND ***" banner, links original serial
- [ ] Refund receipt: website line (https:// prefix if exists)
- [ ] Z-report: all amounts in dollars (from cents), difference shown
- [ ] Copy receipt: "** COPY **" marker

---

## HomeScreen

- [ ] Grouped sections: Shift, Sales, Tools, Settings
- [ ] "Open Shift" visible only when no shift
- [ ] "Sale", "Cash In / Out", "Close Shift" visible only when shift open
- [ ] All buttons navigate to correct routes
- [ ] No scrolling

---

## Auth & Permissions

- [ ] Terminal identified by ip-address header
- [ ] User login by code → token set
- [ ] Scope "admin" bypasses all scope checks
- [ ] Each scope-gated screen shows block screen for unauthorized users
- [ ] Logout on HomeScreen mount (apiService.logout)

---

## General

- [ ] No scrollable lists anywhere (all use ServerPagingList or fixed layout)
- [ ] On-screen keyboard works: Korean, English, numpad layouts
- [ ] KeyboardInputText opens modal overlay on tap
- [ ] DateRangeSelector calendar with presets (Today, This Week, This Month, This Year)
- [ ] All money calculations use decimal.js (no floating point errors)
- [ ] Server Decimal→number conversion works (no Decimal objects in API responses)
