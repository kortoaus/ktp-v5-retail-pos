# Payment Pipeline Restructure Plan

> Created: 2026-03-24
> Last Updated: 2026-03-24

---

## Current Progress

### DONE — DB & Server
- [x] DB schema: all money → Int (cents), qty → Int (×1000), percent → Int (permille)
- [x] DB: `SaleInvoiceRow.discount_amount Int @default(0)` added
- [x] Cloud sync upload disabled (4 call sites)
- [x] Cloud sync download: conversion to Int on migrate (Price, PromoPrice, Promotion)
- [x] `cloud.sync.libs.ts` deleted
- [x] `decimal-utils.ts` deleted
- [x] Server: Decimal → plain arithmetic (sale, refund, shift, voucher, cashio)
- [x] Server: `sale.service.ts` split → `sale.create.service.ts` + `sale.query.service.ts`
- [x] Server: `sale.create.service.ts` — `discount_amount` in DTO + create, `total` stored from client directly
- [x] Server constants: `MONEY_SCALE`, `QTY_SCALE`, `PCT_SCALE`
- [x] Server: `store.service.ts` — surchargeRate as permille, voucher as cents

### DONE — Client Core
- [x] Client constants: `MONEY_SCALE`, `QTY_SCALE`, `PCT_SCALE`, `MONEY_DP`, `QTY_DP`, `PCT_DP`
- [x] `newSalesStore.ts` — Cart without discounts, no applyPromotions coupling
- [x] `newSalesStore.helper.ts` — Decimal removed, Int arithmetic, applyPromotions as separate function
- [x] `SaleStoreDiscount.targetItemIds` for targeted discount allocation
- [x] `Promotion` model: `discountPercentAmounts` + `discountFlatAmounts`
- [x] `SaleLineType.ppMarkdown` for member-change recalculation
- [x] `SaleInvoice`/`SaleInvoiceRow` types — full annotation with units and formulas
- [x] StoreSettingScreen: surchargeRate permille, voucherDefault cents

### DONE — NewSaleScreen
- [x] Shell with all components wired
- [x] LineViewer (Int → display)
- [x] CartSwitcher
- [x] LinePaging (reused)
- [x] LineFunctionPanel (qty ± QTY_SCALE, Discount $, %, Override Price)
- [x] ChangeQtyModal, InjectPriceModal, DiscountAmountModal, DiscountPercentModal
- [x] WeightModal (kg → QTY_SCALE)
- [x] CloudHotkeyViewer, SearchItemModal, MemberSearchModal (reused, display fixed)
- [x] PrintLatestInvoiceButton, KickDrawer, SyncButton, SyncPostButton
- [x] Barcode scanner + addLineGateway + addLinePP (PP: barcode)
- [x] DocumentMonitor (discounts display)
- [x] DiscountListModal
- [x] Back button, member highlight
- [x] Promotion hooks: useNewPromotions, useCartDiscounts (derived)

### DONE — Payment Pipeline
- [x] `libs/sale/types.ts` — SaleTotals, DocumentAdjustments, PaymentCalcResult, TaxCalcResult, FinalizedLine
- [x] `libs/sale/calc-sale-totals.ts` — Stage 1+2 pure functions
- [x] `libs/sale/calc-payments.ts` — Stage 3 pure function
- [x] `libs/sale/finalize-lines.ts` — Stage 4 (calcTax, allocateDiscountsToLines, allocateTaxToLines, largest-remainder)
- [x] `libs/sale/build-payload.ts` — Stage 4d (buildPayload + sanitizeRow with discount_amount)
- [x] `useNewPaymentCalc.ts` — thin reactive hook
- [x] `NewPaymentModal.tsx` — UI + handlePayment
- [x] `NewPaymentSummary.tsx` — Int cents display
- [x] Wired into NewSaleScreen (Pay button → modal → clearActiveCart on complete)

### DONE — PP Barcode System
- [x] `libs/pp-barcode.ts` — parse/build PP barcode, calcMarkdownPrice
- [x] PP barcode format: `00:{"01":barcode,"02":prices,"03":promoPrices,"04":weight,"05":discountType,"06":discountAmount}`
- [x] Numeric-only keys (HID Korean keyboard safe)
- [x] `label-builder.ts` — QR code support added for SLCS
- [x] `label-templates.ts` — `buildPPLabel60x30` with QR
- [x] `WeightLabelScreen` — scan item, scale, markdown input, print PP label
- [x] Route + HomeScreen button added
- [x] NewSaleScreen `addLinePP` — PP barcode scan → price override → member recalc

### DONE — Prepacked Redesign
- [x] `buildNewLine` simplified — no prepackedPrice/qty reversal
- [x] Prepacked = normal when barcode price === DB price
- [x] PP markdown: adjustedPrice from barcode, ppMarkdown stored for member recalc
- [x] `recalculateAllLines`: ppMarkdown lines re-apply markdown on member change

### DONE — Display Fixes
- [x] LabelingScreen: cents → dollars for display/barcode
- [x] OpenShiftScreen: `MONEY_SCALE` for cashInDrawer
- [x] CloseShiftScreen: Decimal removed, all cents, `toCents()` removed
- [x] SearchItemModal: price display cents → dollars
- [x] UserVoucherModal: `left_amount` cents → dollars
- [x] InvoiceReceiptViewer: Decimal removed, Int fmt, qty ×1000
- [x] InvoiceSearchPanel: fmt → cents, total includes surcharge
- [x] sale-invoice-receipt.ts: Decimal removed, Int fmt, total = invoice.total
- [x] refund-receipt.ts: Decimal removed, Int fmt
- [x] StoreSettingScreen: surchargeRate permille, voucherDefault cents

### DONE — Phase 2 (Refund Flow)
- [x] `refund.types.ts` — Decimal removed, fmt → Int cents
- [x] `RefundableRowCard.tsx` — Int display, qty ×1000, discount_amount reflected
- [x] `RefundedRowCard.tsx` — Int display
- [x] `RefundQtyModal.tsx` — float input → ×1000, remainingQty display ÷1000
- [x] `RefundPanels.tsx` — Decimal → Int, partial refund net total (total - discount_amount)
- [x] `RefundDocumentMonitor.tsx` — Decimal → Int display
- [x] `RefundPaymentModal.tsx` — full Int rewrite (cents native, no Decimal)
- [x] Server `sale.refund.service.ts` — `RefundRowDto` + `discount_amount`
- [x] Server `sale.query.service.ts` — `remainingTotal = netTotal - refundedTotal`
- [x] `calcTax` bug fix — targeted promo discount on taxable items (was over-reporting GST)

### DONE — Cloud Sync Restored
- [x] `cloud.sync.service.ts` — rewritten, no Decimal conversion, direct Int pass-through
- [x] `sale.create.service.ts` — sync call restored
- [x] `sale.refund.service.ts` — sync call restored
- [x] `shift.service.ts` — sync call restored
- [x] `cloud.migrate.controller.ts` — syncAll calls restored
- [x] Cloud `ktpv5/data` schema — `discount_amount` added to SaleInvoiceRow
- [x] Cloud `ktpv5/data` DTO — `discount_amount` added

### DONE — External Projects
- [x] `dmarket/app` InvoiceReceiptViewer — Decimal removed, Int saved calc
- [x] `dm-new` InvoiceReceiptViewer — Decimal removed, Int saved calc
- [x] `ktpv5/retail_manager` InvoiceViewerDrawer — saved calc Int precision fix

### TODO — Phase 3 (Server Authority)
- [ ] Server re-computes totals/tax/discount from row data
- [ ] DTO schema validation (Zod)
- [ ] Shift settlement: server computes + stores directly

### TODO — Phase 4 (2D Barcode Production)
- [ ] Labeling app (Android): generate PP barcodes with full price snapshot
- [ ] Transition plan: dual support EAN13 + PP during rollout

### TODO — Phase 5 (Cleanup)
- [ ] Remove old SaleScreen (once NewSaleScreen is stable)
- [ ] Remove old salesStore + salesStore.helpers
- [ ] Remove old PaymentModal + usePaymentCalc
- [ ] CustomerScreen: switch to newSalesStore
- [ ] Cloud sync upload: rewrite without Decimal conversion
- [ ] Int/cents shift fields unification (TerminalShift already Int)

---

## Unit Conventions

| Unit | Scale | Example | Int Value |
|---|---|---|---|
| Money | ×100 (cents) | $10.50 | 1050 |
| Quantity | ×1000 | 1.234kg / 3ea | 1234 / 3000 |
| Percent | ×1000 (permille) | 1.5% / 10% | 15 / 100 |

Constants: `MONEY_SCALE=100`, `QTY_SCALE=1000`, `PCT_SCALE=1000`
Display: `MONEY_DP=2`, `QTY_DP=3`, `PCT_DP=3`

---

## 4-Stage Calculation Pipeline

```
Stage 0 ──→ Stage 1 ──→ Stage 2 ──→ Stage 3 ──→ Stage 4
 Cart        Totals      Discount    Payments    Finalize
 (locked)    (locked)    (reactive)  (reactive)  (locked)
                              ↑            ↑
                          user input   user input
```

---

## Refund Key Formula

```
netTotal = row.total - row.discount_amount   ← what customer actually paid
refundAmount = Math.round(netTotal * refundQty / originalQty)
refundTax = Math.round(row.tax_amount_included * refundQty / originalQty)
```

Old invoices: `discount_amount = 0` → refund unchanged.

---

## PP Barcode Format

```
00:{"01":"barcode","02":[prices],"03":[promoPrices],"04":weight,"05":discountType,"06":discountAmount}
```
- Keys: numeric only (HID Korean keyboard safe)
- 04: weight (×1000), omitted if not weight item
- 05: 1=pct, 2=amt, omitted if no markdown
- 06: permille or cents, omitted if no markdown

---

## SaleInvoice.total Definition

```
total = subtotal - documentDiscountAmount + rounding + creditSurchargeAmount
      = what customer ACTUALLY pays (includes surcharge)
      = Σ(payment.amount + payment.surcharge)

Display total directly — no need to add surcharge separately.
```

Server stores client's value directly.

---

## Cloud Sync Status

### DISABLED (schema migration)
- `sale.create.service.ts`: saleInvoiceSyncService
- `sale.refund.service.ts`: saleInvoiceSyncService
- `shift.service.ts`: terminalShiftSyncService
- `cloud.migrate.controller.ts`: syncAllTerminalShifts + syncAllSaleInvoices

### ACTIVE (download only)
- All cloudXxxMigrateService (items, categories, prices, promotions, etc.)
- Conversions: dollars→cents, percentage→permille, qty→×1000

### TO REBUILD
- Upload sync service — rewrite for Int (no Decimal conversion needed)
