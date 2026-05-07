# Sale Domain Design — ktpv5-pos-retail

Living design doc for the post-cleanup (commit `8e47319 cleanup`) rebuild of the
sale / invoice / payment / voucher domain. Written during the 2026-04-21
redesign session.

Supplements the pre-session handover's 17 locked decisions (Q1–Q17). Where a
decision here supersedes a Q-item, it is marked explicitly.

The live schema draft lives in
`retail_pos_server/prisma/schema.prisma` under `// Draft` blocks near the
bottom. The top-of-block comment in that file restates the core invariants —
read that comment first for schema-level navigation. This doc is for the
reasoning and trade-offs behind those invariants.

---

## Table of Contents

0. [Units & precision](#0-units--precision)
1. [Cart line (`SaleLineType`) — money model](#1-cart-line-salelinetype--money-model)
2. [Invoice model (`SaleInvoice`)](#2-invoice-model-saleinvoice)
3. [Row model (`SaleInvoiceRow`)](#3-row-model-saleinvoicerow)
4. [Payment model (`SaleInvoicePayment`)](#4-payment-model-saleinvoicepayment)
5. [Voucher model (`Voucher` + `VoucherEvent`)](#5-voucher-model-voucher--voucherevent)
6. [Refund math](#6-refund-math)
7. [Decisions log (D-1 … D-38)](#7-decisions-log-d-1--d-38)
8. [Open questions](#8-open-questions)

---

## 0. Units & precision

| Quantity | Constant | Storage |
|---|---|---|
| Money | `MONEY_SCALE = 100` | Integer cents |
| Qty / weight | `QTY_SCALE = 1000` | Integer thousandths (three decimal places) |

All money math uses `Math.round`. Never raw floats. AU GST is 10 %
**inclusive** → `tax = Math.round(total / 11)`, not `× 0.1`.

Summed tax equals `Σ (rounded per line)`, not `round(Σ net × 0.1)`. This avoids
cumulative 1-cent drift between per-line totals and invoice-level tax.

---

## 1. Cart line (`SaleLineType`) — money model

Scope: a single cart line, money-related fields only. Status after the
`barcode_price` removal (D-3) and `subtotal → net` rename (D-2).

### Primitive fields (input — never auto-derived)

| Field | Type | Meaning |
|---|---|---|
| `unit_price_original` | `Int` (cents) | Master list price at scan time. Snapshot — never changes after line creation. |
| `unit_price_discounted` | `Int?` | Member-level or promo price **if** it beats `original`. `null` when nothing improves on original. Re-evaluated when the cart's member changes. |
| `unit_price_adjusted` | `Int?` | Manual override or PP-barcode markdown. `null` when no override. |
| `qty` | `Int` (×1000) | Line quantity. `1000` = one unit. For weight items: gross weight in grams-equivalent. |
| `measured_weight` | `Int?` | Gross weight for weight / weight-prepacked items. Display only. |
| `taxable` | `Boolean` | Drives GST. Item-level flag snapshotted at scan. |

### Derived fields (written only by `recalculateLine`)

| Field | Formula |
|---|---|
| `unit_price_effective` | `unit_price_adjusted ?? unit_price_discounted ?? unit_price_original` |
| `total` | `round(unit_price_effective × qty / QTY_SCALE)` — **tax-inclusive** |
| `tax_amount` | `taxable ? round(total / 11) : 0` |
| `net` | `total - tax_amount` — tax-exclusive |

### Metadata (money-adjacent)

| Field | Meaning |
|---|---|
| `adjustments` | Tag list. Today only `PRICE_OVERRIDE` is written. `QTY_OVERRIDE` / `DISCOUNT_OVERRIDE` enum values exist but are unused (D-6). |
| `ppMarkdown` | `{discountType, discountAmount}` metadata from a PP barcode — needed so `recalculateCartLines` can re-apply markdown when the member level changes. |

### Invariants

1. **`recalculateLine` is the only writer of derived fields.** Every mutation
   path (`addLine`, `changeLineQty`, `injectLinePrice`, `recalculateCartLines`)
   funnels through it. No component sets `total` / `tax_amount` / `net` /
   `unit_price_effective` directly.
2. **`unit_price_original` is a snapshot.** Master-data changes mid-session do
   not retroactively rewrite existing lines.
3. **`unit_price_discounted` is re-evaluated on member change**, via
   `recalculateCartLines`. `unit_price_adjusted` is preserved across member
   changes — except for pp-markdown, which re-applies on the new discounted
   base.
4. **`taxable` is snapshotted at scan time.** Flipping master taxability later
   doesn't affect existing lines.
5. **Money precision** — per-line tax is rounded independently; invoice tax is
   the sum of rounded line values.

### Storage vs derivation

All derived fields are **stored** (cached on the object), not computed at read
time. Rationale:
- `total` and `tax_amount` become persisted columns on `SaleInvoiceRow`
  (receipt reprint, BAS GST, cloud sync, Z-report). Caching in cart state
  makes serialization identity.
- `LineViewer` reads `total` on every render; `DocumentMonitor` sums
  `total` / `tax_amount` on every cart change. Avoiding recomputation in hot
  paths.
- `recalculateLine` centralises the math — drift is impossible if the
  invariant holds.

Single source of truth is preserved at the **writer** level, not the **field**
level.

### SPEND rows (per D-14 to D-16)

SPEND invoices (internal consumption — kitchen / cafe) use the same line shape
but force `unit_price_adjusted = 0` at row-creation time, with
`adjustments = []` (no tag).

- `unit_price_original` stays at retail (preserves "kitchen took $X retail"
  reporting)
- `unit_price_effective` resolves to 0 via the existing derivation
- `total / tax_amount / net` cascade to 0
- The `PRICE_OVERRIDE` tag is reserved for cashier actions — SPEND is
  structural (driven by `invoice.type`), not a line-level cashier override.
  Keeping the tag empty preserves the audit-query invariant "this tag means
  the cashier deliberately changed the price."

---

## 2. Invoice model (`SaleInvoice`)

### Top-level invariant

```
Invoice.total  =  linesTotal
               +  rounding
               +  creditSurchargeAmount

Invoice.total  ≡  "customer가 실제로 낸 돈" (surcharge 포함, 거스름 제외)

Σ payments.amount  ==  Invoice.total
```

There is **no** `documentDiscountAmount` subtraction term — all discounts
live inside `linesTotal` (D-17).

### Document type

`InvoiceType { SALE | REFUND | SPEND }`. Direction is carried by the `type`
field; every money / qty column stays **positive** (D-13). Analytical sign, if
needed, is applied via a view:

```sql
CASE WHEN invoice.type = 'REFUND' THEN -amount ELSE amount END
```

### Field groups (summary — see schema for full list)

| Group | Purpose |
|---|---|
| Serial / dayStr | External identification, daily query indexing |
| type + refund linkage | Document type + `originalInvoiceId` for REFUND docs |
| Actor linkage | `shiftId`, `terminalId`, `userId` (cashier) |
| Store snapshot | `companyName`, `abn`, `address*`, `country`, etc. — from `StoreSetting` at sale time (Q1/Q2) |
| Terminal/User snapshot | `terminalName`, `userName` — for receipt reprint (Q6) |
| Member snapshot | `memberId`, `memberName`, `memberLevel`, `memberPhoneLast4` — optional |
| Money | `linesTotal`, `rounding`, `creditSurchargeAmount`, `lineTax`, `surchargeTax`, `total`, `cashChange` |
| Operational | `receiptCount`, `note` |
| Cloud sync | `cloudId` (`null` means not pushed yet) |

### Why all the snapshots

Receipt reprints six months later must show the same trading name, ABN,
cashier name, and line details the customer saw. Master data can be renamed,
archived, or rewritten without invalidating historical invoices. Store
snapshots are taken at invoice creation and never updated.

### SPEND invoices

`type = SPEND`. Same actor / store snapshot; `total = 0`, `payments = []`. No
GST event (kitchen & cafe are same legal entity). No `department` or
`requestedBy` fields — kept minimal (D-15).

---

## 3. Row model (`SaleInvoiceRow`)

### Row-level invariants (same as cart line, persisted)

```
unit_price_effective  =  unit_price_adjusted
                      ??  unit_price_discounted
                      ??  unit_price_original

total       =  round(unit_price_effective × qty / QTY_SCALE)
tax_amount  =  taxable ? round(total / 11) : 0
net         =  total - tax_amount
```

### Field groups

- **Linkage** — `invoiceId`, `index` (0-based)
- **Type** — `SaleInvoiceRowType { NORMAL | PREPACKED | WEIGHT | WEIGHT_PREPACKED }` (Q7)
- **Item snapshot (flat columns)** — `itemId`, `name_en`, `name_ko`, `barcode`, `uom`, `taxable`
- **Price snapshot** — the four `unit_price_*` values above
- **Qty** — `qty`, `measured_weight`
- **Money totals** — `total`, `tax_amount`, `net`
- **Adjustments metadata** — `adjustments LineAdjustment[]`, `ppMarkdownType`, `ppMarkdownAmount`
- **Refund linkage** — `originalInvoiceId`, `originalInvoiceRowId` (REFUND rows only)
- **Refund pre-compute** (SALE rows only) — `refunded_qty`, `surcharge_share` (row-total 단위, D-26)

### Why flatten `ppMarkdown` into two columns

The cart TS type uses `ppMarkdown: { type, amount } | null`. On the DB row it
becomes `ppMarkdownType: String?` + `ppMarkdownAmount: Int?`. Reasons:
- Queryable (`WHERE ppMarkdownType = 'pct'`) without JSON operators
- No schema migration for minor markdown additions
- `null` on both fields unambiguously means "not a PP-markdown line"

### Why `discount_share` is absent

`documentDiscountAmount` was eliminated (D-17). No per-row discount
allocation exists to snapshot.

### Why `rounding_share` is absent (D-26)

Rounding 절대값이 $0.00~$0.04 수준이라 row 여러 개에 cents 로 비례 배분하면
대부분 0 이 되어 의미 없음. 그리고 refund 정책상 **rounding 은 refund invoice 가
독립 own** — 원본 rounding 은 refund 에 반영 안 함 (refund 가 cash tender 면
refund invoice 자체의 5¢ rounding 을 새로 계산). 따라서 row 에 pre-compute 할
이유 없음.

### Why `unit_refundable` is absent

Decided (D-18/D-26 revised) to compute refund amounts on the fly:

```
refund_row.total           = product refund amount only
refund_row.surcharge_share = surcharge refund share
```

The service calculates both from the row's remaining product/surcharge amounts
and lets the final refund of that row absorb rounding drift. A pre-computed
`unit_refundable` would add a field to sync and could drift by 1 cent on
rounding boundaries. Not worth it.

`surcharge_share` 는 **row-total 단위** (unit 단위 아님) — row.total 과 같은
축. Sale 생성 시 pre-compute (`round(invoice.creditSurchargeAmount
× row.total / invoice.linesTotal)`), 마지막 row 에 drift absorb.

---

## 4. Payment model (`SaleInvoicePayment`)

### Enum

`PaymentType { CASH | CREDIT | VOUCHER | GIFTCARD }` — four tenders (D-7).
`GIFTCARD` is exposed and behaves as "CREDIT without surcharge" — cashier
processes the card manually on the EFTPOS machine and keys the amount into
POS (D-24). No `EFTPOS` enum value — card tender is `CREDIT` for now;
Linkly in Phase 4 will populate sub-scheme on a dedicated `EftposTransaction`
table via the entity-backed pattern.

### Core fields

| Field | Meaning |
|---|---|
| `invoiceId` | FK → `SaleInvoice` |
| `type` | `PaymentType` |
| `amount` | cents, "money moved via this tender". **Includes surcharge** for `CREDIT` — see next section |
| `entityType` | `"user-voucher"` \| `"customer-voucher"` \| `null` |
| `entityId` | reference to entity table (or external id — customer voucher) |
| `entityLabel` | snapshot for receipt ("Kim Staff Daily", …) — voucher tenders only |

### Surcharge — the "never again" rule

Surcharge lives in **one place only**: `SaleInvoice.creditSurchargeAmount`
(invoice level). The payment row has **no** `surcharge` column (D-9).

`payment.amount` for a credit tender equals the amount keyed into the
EFTPOS machine itself — i.e. the bill portion plus its proportional
surcharge, baked together. This means:

```sql
SELECT SUM(amount) FROM SaleInvoicePayment
WHERE type = 'CREDIT' AND <date range>
-- directly matches EFTPOS settlement report
```

No join to invoice. No "did I add surcharge yet?" confusion. The
`creditSurchargeAmount` field on invoice is kept for a different kind of
question ("how much did we make from surcharge?") but is not part of the
settlement path.

### Voucher payment — two sub-types

When `type = VOUCHER`:

- **`entityType = 'user-voucher'`** → `entityId` references local `Voucher.id`
  (staff voucher, stored in this DB)
- **`entityType = 'customer-voucher'`** → `entityId` references CRM voucher id
  (external; not a FK; voucher record lives on CRM server)

Reporting queries can split by `entityType` for cleanly separated staff vs.
customer voucher totals.

### CRM offline behaviour (D-21)

Customer voucher redemption and refund both require CRM connectivity. If CRM
is unreachable:
- **Sale (redemption)** — refused at the tender step; cashier offers another
  payment method.
- **Refund** — entire refund of an invoice that contains a `customer-voucher`
  payment is refused. Cashier / manager records the exception on paper and
  tells the customer the refund will process within 24h.

No partial refund, no cash fallback (would violate the `refund ≤ original
tender` cash-cap principle), no async queue (silent inconsistency risk).

---

## 5. Voucher model (`Voucher` + `VoucherEvent`)

### Scope — staff only (D-19)

The local `Voucher` + `VoucherEvent` tables store **only** staff (User)
vouchers. Customer vouchers live entirely on the CRM server. The
handover's `ownerType { user | member | bearer }` enum is dropped — owner
is implicit in the `userId` FK; no enum needed.

### Balance invariant

```
Voucher.balance  ==  Σ VoucherEvent.amount (same voucherId)
```

Event sign convention:

| Event type | Sign |
|---|---|
| `ISSUE` | `+initAmount` (once, at creation) |
| `REDEEM` | `-amount` |
| `REFUND` | `+amount` |
| `EXPIRE` | `-balance` (final zero-out) |
| `ADJUST` | `±amount` (manual, manager scope) |

### No use restrictions (D-19)

Voucher is a generic `$` balance. There is **no** item / category / brand
enforcement. The `kind` field (`"staff-daily"`, `"goodwill"`, …) is a label
used for reporting and UI, not for eligibility checks. Any restriction
metadata goes into `metadata Json?` for display only.

### Customer voucher events are NOT snapshotted locally (D-23)

The `SaleInvoicePayment` row is the only local record of a customer voucher
redemption (`entityType`, `entityId`, `entityLabel`, `amount`, `createdAt`).
The customer's full voucher history lives on CRM and is accessible to them
via the CRM mobile app. No need for POS-side mirroring.

### Goodwill voucher — escape hatch for future document-level discounts (from D-17)

If a true document-level adjustment is ever required again, do **not**
reintroduce `documentDiscountAmount`. Instead:
1. "Goodwill Voucher" button → issue a local `Voucher { kind: 'goodwill', userId: <manager> }` with the desired amount
2. Immediately redeem it as a `SaleInvoicePayment { type: VOUCHER, entityType: 'user-voucher', entityId }`
3. `VoucherEvent` logs `ISSUE` and `REDEEM` events atomically for audit

Reuses existing infrastructure (voucher CRUD, entity-backed payment, refund
balance restoration) without adding any schema. Treat the redemption as
consideration received — GST is computed on the full `linesTotal`. Revisit
only if ATO interpretation ever requires a discount to reduce GST.

---

## 6. Refund math

### Refund-to-original-tender rule

Refunds go back to the same tender the customer used, up to the amount of
that tender. Cash cap (`refund cash ≤ original cash paid`) is a hard rule
that prevents voucher-to-cash fraud. No fallback to cash if the original
tender is unavailable (see CRM offline section — D-21).

### Surcharge — proportional refund (D-26, revised)

원칙 상 surcharge 도 비례 환불한다. Q5 (REFUND 일 때 creditSurchargeAmount=0)
은 **폐기**. 이유 세 가지:

1. **GST 대칭** — surchargeTax 가 별도 field 로 저장되는데 (D-27), refund 에서
   surcharge 를 안 돌려주면 "원래 surcharge GST 는 남고 상품 GST 만 감면" 상황
   → BAS 보고 어긋남.
2. **EFTPOS 정산 대칭** — `payment.amount` (D-10) 는 EFTPOS 키인 금액. refund
   도 EFTPOS 에 surcharge 포함 키인해야 `SUM(CREDIT sale) - SUM(CREDIT refund)`
   가 단말 정산과 일치.
3. **소비자 공정성** — surcharge 는 supply 의 일부 (ATO 해석). Supply 취소되면
   같이 환불.

### Storage — Interpretation A (split), not combined

D-12 invariant (`total = linesTotal + rounding + creditSurchargeAmount`) 을
SALE / REFUND 에서 **동일 의미** 로 유지하기 위해, refund_row 저장 컬럼은 SALE
과 같은 축을 쓴다:

```
refund_row.total           = 상품 부분만 (tax-inclusive, surcharge 제외)
refund_row.surcharge_share = 이 row 가 돌려받는 surcharge 몫 (cents)
```

→ Invoice 레벨에서:
- `linesTotal            = Σ refund_row.total`           (상품 합)
- `creditSurchargeAmount = Σ refund_row.surcharge_share` (surcharge 합)
- `total                 = linesTotal + rounding + creditSurchargeAmount` (D-12)

초기 §6 문구의 `refund_row.total = round((row.total + surcharge_share) × qty / row.qty)`
는 "per-row refund 금액 개념값" (receipt 에 보이는 합) 의 표현이었다.
저장 레이어는 product / surcharge 를 **분리 저장** 하고, receipt / cashier 에
보이는 per-row 환불 금액은 두 컬럼의 합으로 표시.

B 해석 (합산 저장) 의 비용이 너무 크다 — 모든 SUM / report / receipt / cloud
sync 가 `WHERE type='REFUND'` 분기 필요 + row.total 컬럼 의미가 SALE/REFUND
간 비대칭. 영구 부채.

### Per-row refund amount — drift-absorbing

Naive `round(row.surcharge_share × refund_qty / row.qty)` 는 같은 row 를 여러
번 나눠 환불하면 rounding drift 누적 → 합이 원본과 ±n¢ 어긋남.

예: row.qty=3, surcharge=50¢ 을 1개씩 3번 환불 시 17+17+17 = 51¢ (1¢ over).

**해결: remaining-based 계산 + row 별 마지막 환불이 drift 흡수.**

각 원본 row 에 대해:

```
priorRefundProduct   = Σ (이 row 를 참조하는 prior refund row).total
priorRefundSurcharge = Σ (이 row 를 참조하는 prior refund row).surcharge_share
remainingQty         = origRow.qty - origRow.refunded_qty
remainingProduct     = origRow.total           - priorRefundProduct
remainingSurcharge   = origRow.surcharge_share - priorRefundSurcharge

if (refund_qty === remainingQty):                   // 이 row 의 마지막 환불
  refund_row.total           = remainingProduct     ← drift 흡수
  refund_row.surcharge_share = remainingSurcharge   ← drift 흡수
else:
  refund_row.total           = round(remainingProduct   × refund_qty / remainingQty)
  refund_row.surcharge_share = round(remainingSurcharge × refund_qty / remainingQty)
```

**불변식:** `row.refunded_qty === row.qty` 시점에
```
Σ (이 row 의 모든 refund rows).total           === origRow.total
Σ (이 row 의 모든 refund rows).surcharge_share === origRow.surcharge_share
```

Drift 흡수 판정은 **row 별**. Invoice 가 부분 환불 상태여도 특정 row 는 완전
환불될 수 있고, 그 시점에 그 row 는 깔끔히 정산됨.

### refund_row.tax_amount — product GST only

```
refund_row.tax_amount = row.taxable ? round(refund_row.total / 11) : 0
```

refund_row.total 이 product 부분만 담으므로 상품 GST 만 나옴. Surcharge GST 는
invoice-level `surchargeTax = round(creditSurchargeAmount / 11)` 로 별도 관리
(D-27, SALE 과 동일 구조).

### Refund cap per row

`refunded_qty` is a running counter on the original SALE row. Next refund's
`refund_qty` must be ≤ `qty - refunded_qty`. Updated atomically when a REFUND
invoice is created.

### REFUND invoice shape

- `type = REFUND`
- `originalInvoiceId` → original SALE invoice
- Rows: one REFUND row per refunded quantity of original rows, each with
  `originalInvoiceId`, `originalInvoiceRowId` populated.
  Each row stores product portion in `total` and surcharge portion in
  `surcharge_share` (split 저장, drift-absorbing 로직).
- `linesTotal            = Σ refund_row.total`             (product 합)
- `creditSurchargeAmount = Σ refund_row.surcharge_share`   (환불 surcharge 합)
- `lineTax               = Σ refund_row.tax_amount`        (상품 GST 합)
- `surchargeTax          = round(creditSurchargeAmount / 11)` (surcharge GST)
- `total = linesTotal + rounding + creditSurchargeAmount`  (D-12 동일)
- `rounding` — refund 결제가 전부 CASH 이고 non-cash 전무 면 5¢ round, 그 외 0
- Payments: 원본 tender 로 환불 (cap: 원본 − prior refund children 합).
  - CREDIT / GIFTCARD: EFTPOS 수동 (payment.amount 에 surcharge 포함 키인 금액)
  - VOUCHER (user): `VoucherEvent.REFUND +amount` + `Voucher.balance += amount`
    (validTo / status 변경 안 함 — expired 여도 balance 복구)
  - VOUCHER (customer, CRM): 현재 CRM online check 미구현 → 해당 invoice
    환불 전면 차단 (D-21)

---

## 7. Decisions log (D-1 … D-38)

Numbering continues from the handover's Q-series, which stopped at Q17.
Within this log, decisions are grouped by theme; numeric order is
chronological within theme.

### Cart line — SaleLineType

**D-1. `recalculateAllLines` → `recalculateCartLines`**
Narrowed from "map over all 4 carts" to "take a single cart, return a single
cart". Function now takes a single `Cart` and returns a single `Cart`. Call
site: `SalesStore.ts:setMember`.

**D-2. `line.subtotal` → `line.net`**
Invoice-level `subtotal` became `linesTotal` per handover Q3. Line-level
`subtotal` (= `total − tax_amount`) renamed to `net` to eliminate the name
collision.

**D-3. Dead field `barcode_price` removed**
Always written `null` in `buildNewLine`, never read.

**D-4. `unit_price_effective` stays stored, not computed**
Pattern: derived scalars are cached; `recalculateLine` is the only writer.
Excluding `effective` alone would break the pattern, and the field will be a
persisted column on `SaleInvoiceRow`.

**D-5. `net` redundancy acknowledged, kept**
Any two of `{total, tax_amount, net}` determine the third. Kept for display
readability in `DocumentMonitor`. May be dropped in a future simplification
pass.

**D-6. `LineAdjustment` enum — future restructure flagged**
Today only `PRICE_OVERRIDE` is ever written. `QTY_OVERRIDE` /
`DISCOUNT_OVERRIDE` are dead. Planned redesign: structured entries
(`{ type, reason?, authorizedByUserId?, originalValue }[]`). Out of scope
for this session.

### Payment types

**D-7. Four payment types (no EFTPOS enum value, no POINT)**
`PaymentType { CASH | CREDIT | VOUCHER | GIFTCARD }`. Card tender is
`CREDIT` today; Phase 4 Linkly integration will populate sub-scheme
(Visa/MC/Amex/EFTPOS-debit) on an `EftposTransaction` side table. POINT
never entered the enum — points live on CRM; customers convert points to
vouchers there, and POS only sees the resulting voucher.

**D-8. `GIFTCARD` stored as `GIFTCARD` (no hyphen)**
Prisma enum values disallow hyphens. UI displays "Gift Card".

### Surcharge model

**D-9. Surcharge column removed from `SaleInvoicePayment`**
Double-bookkeeping (per-payment `surcharge` + invoice-level
`creditSurchargeAmount`) was the main source of "does this include surcharge
or not?" confusion. Single source of truth: invoice.

**D-10. `payment.amount` includes surcharge (for credit)**
`payment.amount` ≡ "money that moved via this tender". For credit, equals
the amount keyed into the EFTPOS machine. Settlement query is a single
`SUM(amount) WHERE type = 'CREDIT'`.

**D-11. `SaleInvoice.creditSurchargeAmount` stays, analytical only**
Used for "how much did we make from surcharge?" queries. Not used in
settlement math.

### Money invariants

**D-12. Invoice math**
```
Invoice.total = linesTotal + rounding + creditSurchargeAmount
Σ payments.amount == Invoice.total
```
(`documentDiscountAmount` absent — D-17.)

**D-13. Sign convention — invoice-type based, all amounts positive**
Direction carried by `invoice.type`; money / qty / surcharge columns always
positive. Matches ATO convention (tax invoice vs. adjustment note both
positive).

### Internal consumption (SPEND)

**D-14. SPEND lives in `SaleInvoice`, via `InvoiceType` enum widening**
One document model for everything leaving the store. Unifies cloud-sync
and row aggregation.

**D-15. SPEND scope**
Kitchen & cafe same legal entity → no GST event. No `department`, no
`requestedBy` / `approvedBy` fields.

**D-16. SPEND row shape — retail snapshot preserved, adjusted = 0, no tag**
`unit_price_original` = retail (for "kitchen took $X retail" reporting).
`unit_price_adjusted` = 0 (forces `effective` = 0 via existing derivation).
`adjustments` = `[]` (SPEND is an invoice-level discriminator, not a
cashier action).

### Discount model

**D-17. `documentDiscountAmount` eliminated — all discounts live at line level**
All discounts (staff %, manager goodwill $, coupon, senior/student) apply
to individual line rows at apply-time, baked into each line's
`unit_price_effective`. `linesTotal` already reflects post-discount totals.

Consequences:
- `SaleInvoice.documentDiscountAmount` column dropped
- Invariant: `Invoice.total = linesTotal + rounding + creditSurchargeAmount`
- Refund pre-compute: `discount_share` per row no longer needed
- Tax: computed cleanly per line (no re-allocation)

Apply-time burden:
- Staff discount button iterates all cart lines, sets each
  `unit_price_adjusted = round(effective × 0.9)`
- Flat $ off (goodwill) allocates proportionally with drift absorbed on
  first row
- Receipts sum line-level discounts back up if a summary line is desired

Supersedes handover Q4 (`documentDiscountAmount = 0` on refund) — moot,
field no longer exists.

### Row draft

**D-18. `SaleInvoiceRow` drafted in schema**
Fields: linkage, row type, item snapshot, price snapshot, qty, money
totals, adjustments metadata, refund linkage, refund pre-compute. See the
schema file for the exact column list.

Omitted fields (with reasons):
- `discount_share` — D-17 eliminated `documentDiscountAmount`
- `unit_refundable` — computed on the fly (formula in section 6)

`ppMarkdown` flattened to `ppMarkdownType` + `ppMarkdownAmount` rather than
JSON.

### Voucher

**D-19. Voucher DB scope: staff (User) only**
Customer vouchers live on CRM. Local `Voucher` + `VoucherEvent` are
staff-only. `ownerType` enum dropped (no member/bearer distinctions needed
locally).

**D-20. Payment `entityType` naming — `'user-voucher'` vs `'customer-voucher'`**
Two entityType strings discriminate local vs. CRM voucher within the single
`PaymentType.VOUCHER` tender. Enables cleanly split reporting.

**D-21. CRM-offline behaviour — strict block on both sale and refund**
Customer voucher redemption needs CRM online. If CRM is unreachable:
- Sale: refuse redemption; offer alternate tender
- Refund: refuse refund of the entire invoice; paper log + 24h SLA

No partial refund, no manager override, no cash fallback (cash-cap
violation).

**D-22. Voucher model drafted in schema**
See schema file for full shape. Key points:
- `balance == Σ events.amount` invariant
- Append-only `VoucherEvent` log with signed `amount`
- `kind` is a label, not enforcement
- `metadata Json?` for display-only attributes

**D-23. Customer voucher events — NOT snapshotted locally**
The `SaleInvoicePayment` row is the only local record (entityType,
entityId, entityLabel, amount, createdAt). Customer history lives on CRM
and is accessible via the CRM mobile app.

### Deferrals

**D-24 (revised 2026-04-22). GIFTCARD exposed — "CREDIT without surcharge"**
3rd-party gift cards (Woolworths/Coles/Prezzee) are processed manually on
the EFTPOS machine; POS only records the amount. Structurally identical to
CREDIT, minus surcharge:
- `payment.amount` = amount actually charged to the card (no surcharge
  component)
- Does NOT contribute to `Invoice.creditSurchargeAmount`
- `entityType` / `entityId` / `entityLabel` are all `null` (no local or
  remote entity to reference)
- Refund uses the same manual EFTPOS flow. Cap rule still applies:
  `refund giftcard ≤ original giftcard tender`
- Provider API integration (`GiftCardTransaction` table, Linkly-style
  balance check) remains deferred. POS cannot verify the card balance —
  cashier is responsible for reading the EFTPOS response
- Schema comment retains `TODO(phase-4)` for the provider hookup, but the
  "UI does not expose" note is removed

### Invoice expansion

**D-25. `SaleInvoice` remaining fields drafted**
Added to the schema:
- Identity: `serial` (nullable, unique), `dayStr`, `companyId`
- Actor linkage: `shiftId`, `terminalId`, `userId` (with backrefs on
  `TerminalShift`, `Terminal`, `User`)
- Store snapshot (per Q1/Q2): `companyName`, `abn`, `phone`, `address1/2`,
  `suburb`, `state`, `postcode`, `country`
- Terminal / User snapshot (Q6): `terminalName`, `userName`
- Member snapshot (optional): `memberId`, `memberName`, `memberLevel`,
  `memberPhoneLast4`
- Operational: `receiptCount`, `note`
- Cloud sync: `cloudId` (`null` means not pushed yet; D-38 removed `synced` / `syncedAt`)
- Indexes: `shiftId`, `terminalId`, `userId`, `dayStr`, `(type, dayStr)`,
  `cloudId`, `memberId`, `originalInvoiceId`

`memberId` is a `String?` external reference to CRM — not a FK. The member
snapshot fields freeze the member's identity at sale time so that later
renames / tier changes on CRM do not rewrite historical receipts.

### Refund revised (2026-04-22)

**D-26. Surcharge 비례 환불 + `rounding_share` drop**
Q5 (REFUND creditSurchargeAmount=0) 폐기. Refund 도 surcharge 를 비례로 돌려줌
(GST 대칭 / EFTPOS 정산 대칭 / 소비자 공정). Row 의 `surcharge_share` 는 유지
(row-total 단위, unit 아님). `rounding_share` 는 제거 — rounding 금액이 너무 작아
row 배분 의미 없고, refund invoice 가 독립 own.

**D-26 revised (2026-04-23) — Interpretation A (split storage) + drift absorption**
초기 수식 `refund_row.total = round((row.total + surcharge_share) × refund_qty
/ row.qty)` 를 **문자 그대로 저장** 하면 D-12 invariant 가 깨짐 (surcharge 이중
계산). 따라서:

1. **Split storage** — `refund_row.total` = 상품 부분만, `surcharge_share` =
   surcharge 부분 별도. SALE row 와 동일 축 유지 → invoice-level 수식이 SALE /
   REFUND 에서 동일 (§6 Storage 섹션).

2. **Drift-absorbing 수식** — naive round 공식은 여러 번 나눠 환불 시 drift
   누적. 각 row 의 prior refund 합 기반으로 remaining 계산하고, `refund_qty
   === remainingQty` 면 (= row 의 마지막 환불) 잔량 전부 가져감. Drift 자동
   흡수 (§6 Per-row refund amount 섹션).

Server 구현: `sale.refund.service.ts`. 클라이언트 compute:
`libs/refund/compute.ts`.

### GST on surcharge (2026-04-22)

**D-27. Surcharge 에도 GST 10% 적용**
ATO: surcharge 는 supply 의 일부 → 동일 세율. Tax-inclusive 관례:
`surchargeTax = round(creditSurchargeAmount / 11)`. Invoice 에 `lineTax` +
`surchargeTax` 두 컬럼 분리 저장 (BAS / shift 집계 편의). 합산은 runtime
또는 shift.salesTax 에 합쳐 누적.

### Serial (2026-04-22)

**D-28. DocCounter 기반 serial 발급 — two-phase write 폐기**
신규 `DocCounter { date @unique, counter }` 모델. Sale create transaction 첫
동작으로 `upsert({ where: { date: startOfDay(AU) }, update: { counter:
{ increment: 1 } }, create: { date, counter: random(101..999) } })` —
atomic, 날짜 바뀌면 자연스럽게 새 row 에 100 초과 1000 미만 난수로 시작.
모든 InvoiceType 이 counter 공유 (prefix 로 구분). Format:
```
{shift.id}-{YYYYMMDD}-{typePrefix}{seq6}
```
`typePrefix`: `S` (SALE) / `R` (REFUND) / `P` (SPEND). `seq6` = 6-자리 zero-pad.
Cloud 단위 global uniqueness 는 cloud sync 가 처리 — local 범위에서만 unique.

### SPEND UX (2026-04-22)

**D-29. SPEND toggle mode (PaymentModal 내부)**
별도 screen 대신 PaymentModal 의 tender picker 맨 아래 **SPEND 토글 버튼**
추가. ON 상태:
- 기존 tender picker (VOUCHER/CASH/CREDIT/GIFTCARD) 전부 disabled
- `payments = []`, `stagedPayment` 리셋 (숨겨진 state 방지)
- Active tender input 영역 `bg-black/50` overlay
- Summary 의 COMPLETE SALE 자리에 `RECORD SPEND` (orange) 버튼으로 교체
- 토글 OFF 시 전부 다시 리셋 (양방향 clean state)

### Cash rounding refined (2026-05-06)

**D-30. Rounding 은 cash-settled remainder 에만**
Voucher 는 cash 보다 먼저 적용될 수 있고, 남은 cash target 을 5¢ 단위로
round 할 수 있다. CREDIT/GIFTCARD 는 exact tender 이므로 하나라도 있으면
rounding 은 0 이다.

조건:
- `exactNonCashBill === 0` — CREDIT/GIFTCARD bill portion 부재
- `cashTenderPresent` — cash tender 가 rounding 을 맡음
- `cashIntent >= round5(linesTotal - voucherBill - exactNonCashBill)`

예:
- cash-only `$100.01` → `$100.00`
- voucher `$5.00` + cash remainder `$5.03` → cash `$5.05`
- voucher + credit/giftcard → exact, no rounding
- voucher-only → no rounding

### Voucher-first payment flow (2026-05-06)

**D-31. Voucher 가 tender order 를 lead**
PaymentModal tender order:

1. VOUCHER
2. CASH
3. CREDIT / GIFTCARD exact tenders

No-member carts show User Voucher. Member carts show Customer Voucher placeholder
until CRM lookup/redeem is implemented. User Voucher and Customer Voucher are
mutually exclusive in the picker.

Lock rules:
- Voucher can be added only before CASH/CREDIT/GIFTCARD.
- Cash can follow voucher, but is locked after CREDIT/GIFTCARD.
- CREDIT/GIFTCARD are exact-last tenders.
- Already committed user-voucher rows are shown as "In use" in the Search modal
  and cannot be selected again.

If member changes while PaymentModal is open, all staged and committed payment
state is cleared so member-specific price/voucher/payment math cannot mix with
the prior member.

PaymentModal action controls are div-based tap targets instead of `<button>`.
HID barcode scanners send Enter suffixes; avoiding focusable buttons prevents
scanner input from accidentally triggering tender/complete actions.

### Payload shape (2026-04-22)

**D-32. CASH 는 payload 에서 단일 payment 로 집약**
UI 상 split 여부 무관, `SaleCreatePayload.payments` 에는 CASH 하나로 합산
(amount = cashApplied). Change 는 `invoice.cashChange` 한 컬럼. 서버 정산
`SUM(amount WHERE type='CASH')` 하나로 끝.

### Shift schema (2026-04-22)

**D-33. TerminalShift 필드 정리**
- 오타 `startedCach` → `startedCash`
- 중복 제거: `cashIn`/`cashOut` 삭제 (`totalCashIn/Out` 만 유지)
- 추가: `salesGiftcard`, `refundsGiftcard` (D-24 대응)
- 추가: `salesCreditSurcharge`, `refundsCreditSurcharge` (surcharge 분석)
- `salesTax` / `refundsTax` 는 lineTax + surchargeTax 합산 저장

### Shift close — no increment cache (2026-04-22)

**D-34. Sale create 에서 shift 집계 increment 안 함**
`tx.terminalShift.update({ salesCash: increment, ... })` 제거. Shift close 시점에
`SUM(SaleInvoicePayment.amount) WHERE shiftId=X` 로 일괄 재집계. 증분 캐시는
drift 위험 + 성능 이득 없음 (인덱스 `[shiftId]` 있음). Source-of-truth 기반.

### Schema cleanup (2026-04-22)

**D-35. Staff 모델 삭제**
legacy 빈 테이블. `User` 모델이 cashier/voucher 관계 담당. 중복 제거.

### Serial + DB indexes (2026-04-22)

**D-36. 성능/정합 인덱스 보강**
- `SaleInvoicePayment`: `@@index([invoiceId])`, `@@index([type, createdAt])` (EOD tender 별 SUM)
- `SaleInvoiceRow`: `@@index([originalInvoiceId])` (refund 조회)

### Repay + TerminalShift schema 확장 (2026-04-23)

**D-37. Repay (same-shift 전량 재결제) + TerminalShift 집계 필드 확장**

#### Repay
"이미 결제된 SALE 의 tender 만 다시 선택" UX. 한 transaction 안에서 REFUND (전량) +
새 SALE 을 원자적으로 생성. 두 문서를 만들지만 UX 는 한 동작. 조건:
- `orig.type === SALE`
- `orig.refunds.filter(type=REFUND).length === 0` (첫 환불이어야)
- `orig.shiftId === currentShiftId`
- `now - orig.createdAt < 10분`
- 원본 payments 에 customer-voucher 없음 (D-21 확장)

추적: 새 SALE 의 `originalInvoiceId = 원본 SALE.id`. 기존 REFUND 의 `originalInvoiceId`
와 같은 컬럼 공유 — **`refunds` relation 이 REFUND 자식 + repay-SALE 자식을 둘 다
반환**. 따라서 `refunds` 순회 코드는 반드시 `type === 'REFUND'` 로 필터. 서버 Prisma
include 2곳 (`loadOriginalOrThrow`, `getSaleInvoiceByIdService`) 에 `where: { type: "REFUND" }`
source filter, 클라 `compute.ts` / `SaleInvoiceViewer` 도 defensive filter.

구현: `POST /api/sale/repay`. 서버: `sale.repay.service.ts` 가 `buildRefundInTx` +
`buildSaleInTx` 를 한 `$transaction` 에 순차 호출. 클라: `PaymentModalForRepay`
(invoice viewer 에서 직접 open, SaleScreen 경유 없음 — cart 편집 불가).

#### TerminalShift schema 확장

D-33 이후 추가 필요 항목 8종 (SUM-based 재집계 대상, D-34 기준 close 시 채워짐):

**Voucher split (D-20 대응)**
- `salesVoucher` 삭제 → `salesUserVoucher` + `salesCustomerVoucher`
- `refundsVoucher` 삭제 → `refundsUserVoucher` + `refundsCustomerVoucher`
- 이유: staff voucher 비용 vs CRM customer redemption 분리 추적. CRM 연동 (Phase 4)
  시점에 구분 의미 있어짐. 지금은 customer-voucher 차단 (D-21) 이라 항상 0.

**Gross items / rounding / counts**
- `salesLinesTotal`, `refundsLinesTotal` — Σ invoice.linesTotal (상품만, surcharge 제외)
  - tender 합 = linesTotal + rounding + surcharge 이므로 "상품 매출" 단독 표시 시 필요.
- `salesRounding`, `refundsRounding` — Σ invoice.rounding (signed, 보통 음수)
  - Drawer 엔 영향 없음 (payment.amount 가 이미 rounding 후 값). 분석 전용.
- `salesCount`, `refundsCount` — 거래 건수. Z-report 헤더, 평균 거래액.
- `repayCount` — `SaleInvoice where type=SALE AND originalInvoiceId IS NOT NULL` 의
  건수. Repay 로 생성된 새 SALE (salesCount 의 subset). 운영 분석용.

**SPEND**
- `spendCount`, `spendRetailValue` — SPEND 은 금액 0 / payments 없음이라 기존 tender
  필드에 반영 안 됨. `spendRetailValue = Σ row.unit_price_original × qty / QTY_SCALE`
  로 "주방이 retail $X 어치 가져감" 추적. 매니저 보고서용.

#### Close flow — preview + 재집계

두 endpoint 공통 helper `aggregateShift(shiftId)` 사용:
- `POST /api/shift/close/data` — **preview**. SUM 집계만, write 없음. CloseShiftScreen
  이 진입 시 호출해서 expected cash 와 tender 별 합계 표시 → cashier 가 실물 현금과
  맞춰봄.
- `POST /api/shift/close` — **실행**. 같은 SUM 재집계 + shift record 에 write + 닫기.
  Client DTO 는 `{ closedNote, endedCashActual }` 만 — 기대 현금/tender 합은 서버가
  재계산. Client-side drift / tampering 불가능.

Preview 와 close 가 같은 helper 를 쓰므로 "preview 에서 봤던 숫자 ≡ 실제 close 된 숫자"
보장 (단, 사이에 새 invoice 생기지 않았을 때).

#### 파생 사항 (정리)
- `docs/sale-domain.md` 업데이트 (이 D-37).
- 서버: `/api/sale/repay` 추가, `sale.create.service` / `sale.refund.service` 에서 tx 내부
  로직을 `buildSaleInTx` / `buildRefundInTx` 로 추출.
- 클라: `PaymentModalForRepay/` 신규, `SaleInvoiceViewer` 에 Repay 버튼 + 10분 타이머,
  `can-repay.ts`, `invoice-row-to-line.ts`.
- `app` 쪽 `TerminalShift` 타입 server schema 와 full sync (기존 오타 `startedCach` +
  dead `cashIn/cashOut` 포함 전수 정리).

### Cloud sync push (2026-04-24)

**D-38. Cloud sync — `cloudId` 단일 플래그, id-ASC sweep, 트리거 기반 (no cron)**

POS (local) → main api (deviceId 주입 + proxy) → data-server (archive). 설계 원칙
4가지 + 파급 변경사항.

#### 원칙 1. `cloudId != null ⟺ synced`

`SaleInvoice.synced` / `syncedAt` boolean 삭제. `cloudId Int?` 한 컬럼으로
단일화. `TerminalShift` 도 동일 — 기존에 `cloudId` 가 없었는데 추가하고
`synced`/`syncedAt` 제거. 이유:
- 한 컬럼에 "sync 여부 + cloud 쪽 참조" 둘 다 표현 → 불일치 상태 자체가 불가능.
- Query: `WHERE cloudId IS NULL` 로 미처리 대상 한 번에. `@@index([cloudId])`
  추가.

#### 원칙 2. id-ASC sweep, 실패 시 break

`cloud.sync.service.ts` 의 `syncAllSaleInvoices()` / `syncAllShifts()` 는
`orderBy: { id: 'asc' }` 로 pending 목록을 뽑고 순차 push. **실패 시 즉시
`break`** — 후속 invoice 는 parent 의 `cloudId` 에 의존할 수 있으므로
(repay chain) 선행이 막히면 뒤도 막혀야 함. 다음 sweep 에서 재시도.

구체적 종속성 체크: push 직전에 `inv.originalInvoiceId != null` 이면 로컬
parent 의 `cloudId` 를 lookup, 없으면 break (이번 sweep 은 아직 parent 가 안
올라간 상태). 다음 sale/refund/repay 또는 서버 재기동이 parent 부터 다시 push.

#### 원칙 3. Fire-and-forget, no cron

트리거 지점 5개 — `sale.create.service.createSaleService`,
`sale.refund.service.createRefundService`, `sale.repay.service.createRepayService`,
`shift.service.closeTerminalShiftService`, `index.ts` 서버 기동 직후. 전부
`triggerSyncAllSaleInvoices()` / `triggerSyncAllShifts()` 로 module-level
concurrency guard 내에서 1회 호출. Cron/interval scheduler 없음 — 다음 sale
이 어차피 sweep 을 다시 돌리므로 실운영에서 재시도 커버됨.

#### 원칙 4. `originalInvoiceId` 를 cloud id 로 resolve 해서 전송

Data-server 의 `RetailSaleInvoice.originalInvoiceId` 는 cloud 쪽 `id`
(self-relation) 를 참조. POS 는 push payload 빌드 시 로컬 parent 의 `cloudId`
를 조회해서 payload 의 `originalInvoiceId` 필드로 넣음. Row-level
`originalInvoiceId` / `originalInvoiceRowId` 는 POS-local id 를 그대로 전송
(cross-device 분석은 필요 시 `(deviceId, localId)` join 으로 해결).

#### 파급 변경 (data-server)

- `@@unique([deviceId, localId])` — `RetailSaleInvoice`, `RetailTerminalShift`
  양쪽 추가. Upsert idempotency 확보 (네트워크 재시도 시 중복 생성 방지).
- `InvoiceType` enum 선언 + `RetailSaleInvoice.type` 을 String → enum.
- `RetailTerminalShift.createdAt` / `updatedAt` 추가 (기존엔 없어서 cloud 가
  언제 받았는지 추적 불가였음). `openedNote` / `closedNote` nullable.
- `RetailSaleInvoice` 에서 `synced` / `syncedAt` / `cloudId` (POS-local 개념
  오복사) 삭제.
- `RetailSaleInvoice.serial` nullable (POS 와 대칭 — 실운영에선 항상 세팅).

#### Transport 계약

- POS 는 `API_URL` (main api) 로 POST. 엔드포인트
  `/device/sync/retail/sale-invoice`, `/device/sync/retail/terminal-shift`.
- Main api 가 `device-api-key` 헤더에서 `deviceId` resolve → payload 에
  주입해서 data-server 로 forward.
- Data-server 응답 `{ ok, msg, result: { id } }` — POS 가 `result.id` 를
  로컬 `cloudId` 에 저장.
- Idempotent: data-server 는 `(deviceId, localId)` unique 로 upsert. 재시도
  안전.

#### 결과 (운영)

- 모든 SALE / REFUND / SPEND / repay 가 생성 직후 자동 push 시도.
- Shift close 직후 해당 shift 도 push (closed 된 shift 만 대상).
- 서버 재기동 시 밀린 것 자동 catch-up.
- 실패는 조용히 남음 (`cloudId = null` 유지) — 다음 sale 이 다시 쓸어감.

### POS pricing / Z-report presentation refinements (2026-05-01)

**D-39. Member/promo price candidates include all tiers up to member level**

기존 `resolveDiscountedPrice` 는 현재 `memberLevel` 의 level price 와 promo price
만 후보로 봤다. 운영자가 level-1 가격을 base 보다 높게 오입력하거나, base promo 가
member-level promo 보다 낮은 경우를 놓치지 않기 위해 후보 범위를 확장한다.

규칙:
- `unit_price_original = price.prices[0]`
- 자동 할인 후보 = `price.prices[0..memberLevel]` +
  `promoPrice.prices[0..memberLevel]`
- 후보 중 `> 0 && < unit_price_original` 인 값만 `unit_price_discounted` 가 될 수
  있다.
- 후보가 없으면 `unit_price_discounted = null`, 따라서 effective 는 original 로
  fallback.

의미:
- 고객은 본인 level 이하에서 접근 가능한 정상/프로모 가격 중 최저가를 받는다.
- mis-keyed higher member tier 는 자동으로 제외되어 base 가격보다 비싸게 팔리지
  않는다.
- PP barcode markdown 도 같은 resolver 를 통해 markdown 전 기준가를 잡는다.

**D-40. Z-report prints net tender movement**

Shift settlement receipt 는 Sales 와 Refunds 를 각각 독립 섹션으로 유지한다. 여기에
운영자가 실제 tender movement 를 바로 볼 수 있도록 `NET TOTAL` 섹션을 추가한다.

표시 항목:
- Cash = `salesCash - refundsCash`
- Credit = `salesCredit - refundsCredit`
- Voucher = `(salesUserVoucher + salesCustomerVoucher) -
  (refundsUserVoucher + refundsCustomerVoucher)`
- Gift Card = `salesGiftcard - refundsGiftcard`
- GST = `salesTax - refundsTax`
- Total = sales tender total - refund tender total

Expected cash 공식은 그대로
`startedCash + salesCash - refundsCash + totalCashIn - totalCashOut` 이며, Z-report
의 Net Cash row 는 이 공식의 tender movement 부분과 일치한다.

### Sale point earning and CRM ledger (2026-05-06)

**D-41. POS/data-server store point snapshots; CRM owns the point ledger**

POS calculates canonical earned points when a normal `SALE` is created and
stores the result on `SaleInvoice.pointsEarned`. Each invoice row stores the
item point-exclusion snapshot on `SaleInvoiceRow.isPointExcluded`.

Rules:
- Points earn only for completed `SALE` invoices with a member attached.
- `REFUND`, `SPEND`, and repay replacement `SALE` invoices store
  `pointsEarned = 0`.
- Rows with `isPointExcluded = true` do not contribute to the point base.
- Cash and eligible exact-tender shares use `StoreSetting.cash_point_rate` and
  `StoreSetting.other_point_rate`.
- Voucher redemption does not earn points.
- `cashApplied` is used, not cash received, so change never earns points.
- Surcharge and rounding are not part of the point base.

Refund point reversal:
- REFUND invoices store `pointsReversed` as a positive snapshot.
- `pointsReversed` is derived from the original sale's `pointsEarned`, not
  from current point rates.
- Eligible refund base uses refund row product totals only; surcharge and
  rounding do not contribute.
- Excluded original rows do not reverse points.
- The final eligible refund absorbs proportional rounding drift so total
  reversed points can equal the original sale's `pointsEarned`.
- CRM records REFUND reversal as `MemberPointLedgerType.VOID` and floors
  `Member.points` at `0`.

Sync contract:
- POS sync sends invoice `pointsEarned` and row `isPointExcluded` to
  data-server. REFUND sync also sends invoice `pointsReversed`.
- Data-server persists those fields on `RetailSaleInvoice` and
  `RetailSaleInvoiceRow`.
- For member invoices, data-server sends a best-effort signed CRM `/push`
  signal with:
  - `companyId`
  - `memberId`
  - `invoiceId` = data-server `RetailSaleInvoice.id`
  - `serial`
  - `pointsEarned`
  - `pointsReversed`
- CRM validates the HMAC signature with `CRM_PUSH_SECRET`, creates one
  `MemberPointLedger` `EARN` row for
  `entityType = "retail-sale-invoice"` / `entityId = String(invoiceId)`, and
  increments `Member.points` only if that ledger row is newly created.
- Duplicate CRM push signals are idempotent through
  `@@unique([companyId, entityType, entityId, type])`.

Operational implication: CRM must be deployed before data-server when this
contract changes, because data-server starts sending the expanded `/push`
payload after deployment. This change also includes DB migrations for POS
local server and data-server; apply them with `npx prisma migrate deploy` in
each target environment before running code that reads or writes
`pointsReversed`.

---

## 8. Open questions

Still open, to be resolved in later sessions:

- **`LineAdjustment` enum redesign** — structured entries (`{ type, reason?,
  authorizedByUserId? }[]`) vs. the current string enum array. D-6 deferred.
- **Manager override for rare edge cases** — e.g., force a refund when CRM
  offline, adjust voucher balance manually. Scoping + audit mechanism
  pending.
- **Tax impact on goodwill voucher redemption** — ATO interpretation of
  "consideration received" when voucher was given away. Not urgent;
  probably fine for current scope.
- **Linkly / GiftCard provider API (Phase 4)** — EFTPOS 자동 키인, GiftCard
  balance 조회. 현재 모두 manual. CRM customer-voucher redeem/refund 도 Phase 4
  에서 해제 (D-21).
