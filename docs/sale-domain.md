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
7. [Decisions log (D-1 … D-25)](#7-decisions-log-d-1--d-25)
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
| Cloud sync | `synced`, `syncedAt`, `cloudId` |

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

Decided (D-18) to compute refund-per-unit on the fly:

```
refund_row.total  =  round((row.total + row.surcharge_share) × refund_qty / row.qty)
```

One multiplication, one round, all row-local. A pre-computed
`unit_refundable` would add a field to sync and could drift from the formula
above by 1 cent on rounding boundaries. Not worth it.

`surcharge_share` 는 **row-total 단위** (unit 단위 아님) — row.total 과 같은
축이라 수식 한 줄. Sale 생성 시 pre-compute (`round(invoice.creditSurchargeAmount
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

## 7. Decisions log (D-1 … D-36)

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
- Cloud sync: `synced`, `syncedAt`, `cloudId`
- Indexes: `shiftId`, `terminalId`, `userId`, `dayStr`, `(type, dayStr)`,
  `synced`, `memberId`, `originalInvoiceId`

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
{ increment: 1 } }, create: { date, counter: 1 } })` — atomic, 날짜 바뀌면
자연스럽게 새 row 에 counter=1 시작. 모든 InvoiceType 이 counter 공유 (prefix
로 구분). Format:
```
{shift.id}-{YYYYMMDD}-{typePrefix}{seq6}
```
`typePrefix`: `S` (SALE) / `R` (REFUND) / `P` (SPEND). `seq6` = 6-자리 zero-pad.
Cloud 단위 global uniqueness 는 cloud sync 가 처리 — local 범위에서만 unique.

### SPEND UX (2026-04-22)

**D-29. SPEND toggle mode (PaymentModal 내부)**
별도 screen 대신 PaymentModal 의 tender picker 맨 아래 **SPEND 토글 버튼**
추가. ON 상태:
- 기존 tender picker (CASH/CREDIT/USER_VOUCHER/GIFTCARD) 전부 disabled
- `payments = []`, `stagedPayment` 리셋 (숨겨진 state 방지)
- Active tender input 영역 `bg-black/50` overlay
- Summary 의 COMPLETE SALE 자리에 `RECORD SPEND` (orange) 버튼으로 교체
- 토글 OFF 시 전부 다시 리셋 (양방향 clean state)

### Cash rounding refined (2026-04-22)

**D-30. Rounding 은 CASH-only mode 에서만**
nonCashBill === 0 (즉 모든 tender 가 CASH) 이고, cashIntent 가 round5 된 cash
target 을 덮을 때만 rounding 적용. Mixed tender 는 exact (non-cash 가 1¢
정밀도를 받음). EXACT 버튼이 `round5(left)` 를 cashReceived 로 세팅해서
cashIntent >= roundedCashTarget 조건 충족 → rounding 자연 발동.

### Voucher duplication (2026-04-22)

**D-31. User-voucher 중복 선택은 Modal 에서 block**
이미 committed 된 user-voucher 는 Search modal 에서 "In use" 표시 + disabled.
Cashier 가 금액 변경하려면 pending list 에서 ✕ 로 제거 후 다시 추가. Option A
선택 — "항상 흐름이 눈에 보이게". Override 흐름 제거.

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

---

## 8. Open questions

Still open, to be resolved in later sessions:

- **Refund UI / service** — `POST /api/sale/refund` 와 RefundScreen 미구현.
  Invoice viewer 에서 refund 진입점 필요. Per-row refund qty 선택 + payment
  매칭 + VoucherEvent REFUND + 원본 `refunded_qty` increment.
- **Cloud sync push** — `SaleInvoice.synced`/`syncedAt`/`cloudId` + `TerminalShift`
  cloud sync. `createSaleService` 에 TODO 주석만 있고 실제 push 로직 없음.
- **Shift close service 재작성** — 집계 쿼리 (`SUM(amount) WHERE shiftId=X
  AND type=?`) + drawer 차이 (endedCashActual - endedCashExpected). 현재 sale
  create 가 increment 안 하므로 close 가 반드시 재집계.
- **Cloud uniqueness** — local serial 은 local 만 unique. Cloud 로 sync 할 때
  `(store branchCode or cloudId, serial)` 조합으로 global unique 보장. Cloud
  측에서 처리하기로 결정, schema 는 local 유지.
- **`LineAdjustment` enum redesign** — structured entries (`{ type, reason?,
  authorizedByUserId? }[]`) vs. the current string enum array. D-6 deferred.
- **Manager override for rare edge cases** — e.g., force a refund when CRM
  offline, adjust voucher balance manually. Scoping + audit mechanism
  pending.
- **Tax impact on goodwill voucher redemption** — ATO interpretation of
  "consideration received" when voucher was given away. Not urgent;
  probably fine for current scope.
- **Linkly / GiftCard provider API (Phase 4)** — EFTPOS 자동 키인, GiftCard
  balance 조회. 현재 모두 manual.
