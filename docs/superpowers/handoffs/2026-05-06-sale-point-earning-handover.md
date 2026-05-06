# Sale Point Earning Handover

Date: 2026-05-06
Branch: `codex/sale-point-earning`
Workspace: `/Users/dev/ktpv5/ktpv5-pos-retail`

## 2026-05-06 Session Update

This thread continued after the original handover. Work is now spanning three
repos and should continue in the same session/thread context:

- `/Users/dev/ktpv5/ktpv5-pos-retail`
- `/Users/dev/ktpv5/ktpv5-data-server`
- `/Users/dev/ktpv5/ktpv5-crm-server`

### POS Retail Repo Current State

The feature branch `codex/sale-point-earning` was merged locally into `main`
with a fast-forward merge for testing.

Current repo state when this section was written:

```text
## main...origin/main
 M retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx
```

The only current POS working-tree edit is:

- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

That edit changes the payment modal preview display:

- label changed from `Points Earned` to `Expected Points Earned`
- preview only renders when:
  - `cal.pointsEarned > 0`
  - not `spendMode`
  - `completeDisabled === false`

Meaning: expected points show only when the sale is fully paid and the
`COMPLETE` button is active. A screenshot looked like the label was missing,
but that example had no member attached, so no points were expected.

Verification after this UI edit:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Result: passed.

### Data Server Repo Current State

`/Users/dev/ktpv5/ktpv5-data-server` was inspected and is currently clean:

```text
## main...origin/main
```

Important existing support already present:

- `prisma/schema.prisma` has `RetailSaleInvoice.pointsEarned`
- `prisma/schema.prisma` has `RetailSaleInvoiceRow.isPointExcluded`
- migration exists:
  `prisma/migrations/20260506002302_add_point_fields_to_retail_invoice/migration.sql`
- `src/retail/invoice/invoice.service.ts` persists:
  - invoice `pointsEarned`
  - row `isPointExcluded`
- after a member invoice sync, data-server currently calls CRM `/push` via
  `src/libs/crmClient.ts`.

Current data-server -> CRM push signal is still only:

```ts
{
  companyId,
  memberId,
  invoiceId, // data-server RetailSaleInvoice.id
}
```

Next intended data-server change:

- extend push signal payload to include:
  - `invoiceId` (same meaning: data-server `RetailSaleInvoice.id`)
  - `serial` (receipt/invoice serial)
  - `pointsEarned`

The user explicitly wants this because CRM will own the member point ledger.

### CRM Server Repo Current State

`/Users/dev/ktpv5/ktpv5-crm-server` was inspected and edited. It already had
unrelated user-owned dirty files before CRM schema work:

```text
## main...origin/main
 M package.json
 M prisma/schema.prisma
?? src/scripts/
```

Treat these as user-owned and do not revert:

- `package.json`
- `src/scripts/`

Codex changed only:

- `prisma/schema.prisma`

CRM schema updates now in the working tree:

- `Member.cash_spend` changed from `Float` to `Int`
- `Member.credit_spend` changed from `Float` to `Int`
- `Member.points` changed from `Float` to `Int`
  - user said all three fields currently contain only `0`, so this conversion
    is acceptable.
- added `MemberPointLedgerType`
- added `MemberPointLedger`

Current intended ledger shape:

```prisma
enum MemberPointLedgerType {
  EARN
  REDEEM
  ADJUST
  EXPIRE
  VOID
}

model MemberPointLedger {
  id           String                @id @default(uuid())
  companyId    Int
  memberId     String
  type         MemberPointLedgerType
  pointsDelta  Int
  balanceAfter Int?
  entityType   String
  entityId     String
  entitySerial String
  note         String?
  createdAt    DateTime              @default(now())
  updatedAt    DateTime              @default(now()) @updatedAt

  @@unique([companyId, entityType, entityId, type])
  @@index([memberId])
  @@index([companyId, memberId])
  @@index([companyId, entitySerial])
  @@index([companyId, type, createdAt])
}
```

Rationale:

- One point ledger handles earn, redeem, adjust, expire, and void.
- `Member.points` remains a fast aggregate.
- `pointsDelta` is signed:
  - earn = positive
  - redeem/expire = negative
- `entityType/entityId/entitySerial` generalizes the source/target document.
  Do not hard-code retail invoice columns into the ledger.
- Expected entity examples:
  - retail sale earn:
    - `entityType = "retail-sale-invoice"`
    - `entityId = String(dataServerRetailSaleInvoice.id)`
    - `entitySerial = invoice.serial`
  - points converted to customer voucher:
    - `entityType = "customer-voucher"`
    - `entityId = voucher id`
    - `entitySerial = voucher serial`
- Unique key `companyId + entityType + entityId + type` prevents duplicate
  processing of the same point event.

CRM schema validation was run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npx prisma validate
```

Result: passed.

Important: user said they will handle CRM migrations. Do not create CRM
migration files or regenerate Prisma client unless explicitly asked.

### CRM/Data Communication Findings

There are two existing communication directions:

1. CRM app API pulls invoices from data-server:
   - CRM route: `GET /api/invoice/member`
   - CRM route: `GET /api/invoice/member/:id`
   - CRM internally calls:
     - `POST {DATA_SERVER}/api/invoice/:companyId/member/search`
     - `POST {DATA_SERVER}/api/invoice/:companyId/member/get/:id`
   - request body includes `{ memberId: user.id }`

2. data-server pushes a member invoice signal to CRM:
   - data-server `src/retail/invoice/invoice.service.ts`
   - data-server `src/libs/crmClient.ts`
   - CRM endpoint: `POST /push`
   - signed with `CRM_PUSH_SECRET`
   - headers:
     - `x-ktp-timestamp`
     - `x-ktp-signature`
   - CRM validates in `src/libs/internalSignature.ts`
   - CRM currently sends push notification after re-fetching invoice from
     data-server.

Current CRM `/push` only sends notifications. It does not update
`Member.points` yet.

### Next Session Implementation Plan

Continue in this order:

1. CRM server:
   - update `/push` request parser to accept:
     - `companyId`
     - `memberId`
     - `invoiceId`
     - `serial`
     - `pointsEarned`
   - keep HMAC middleware unchanged.
   - add point processing service that transactionally:
     - ignores `pointsEarned <= 0` for ledger/aggregate purposes
     - creates `MemberPointLedger` row:
       - `type = EARN`
       - `pointsDelta = pointsEarned`
       - `entityType = "retail-sale-invoice"`
       - `entityId = String(invoiceId)`
       - `entitySerial = serial`
       - `balanceAfter = previous Member.points + pointsEarned`
     - increments `Member.points` only if the ledger row is newly created
     - treats unique conflict as idempotent duplicate signal
   - decide whether to include points in notification body, e.g.
     `Purchase - $74.30 (+74 pts)`.

2. data-server:
   - extend `InvoicePushSignal` in `src/libs/crmClient.ts`
   - send `serial` and `pointsEarned` from
     `src/retail/invoice/invoice.service.ts`
   - preserve best-effort behavior for now.

3. CRM types:
   - update `src/api/invoice/invoice.type.ts` so `RetailSaleInvoice` includes
     `pointsEarned`
   - consider adding row `isPointExcluded` if CRM UI may inspect rows later.

4. POS retail:
   - keep current PaymentModal UI edit or commit it with the broader point
     work.

5. Verification:
   - CRM: `npm run build`
   - data-server: `npm run build`
   - POS app: `npm run build` if PaymentModal remains changed
   - POS server: `npm run build` if sync payload changes require type updates

## Current State

The sale point earning feature is implemented and committed on
`codex/sale-point-earning`.

Working tree was clean before this handover document was created.

The feature adds member-only point earning for completed `SALE` invoices:

- `SALE` earns points only when a member is attached.
- `REFUND`, `SPEND`, and repay replacement `SALE` invoices earn `0`.
- Item rows with `isPointExcluded = true` do not contribute to the point base.
- Cash and non-cash portions use `StoreSetting.cash_point_rate` and
  `StoreSetting.other_point_rate`.
- Cash-only AU rounding down is treated as cash, not as a tiny "other" base.
- Receipt print and invoice viewer show persisted `pointsEarned`.

## Design And Plan Docs

- Spec: `docs/superpowers/specs/2026-05-06-sale-point-earning-design.md`
- Plan: `docs/superpowers/plans/2026-05-06-sale-point-earning.md`

The implementation plan was updated during review to cover:

- repay replacement rows
- cash-only rounding-down allocation
- local POS migration
- cloud sync payload fields

## Commits On Branch

From oldest to newest, relative to `main`:

```text
b9d7d9b docs: plan sale point earning
9c466c9 feat: add point snapshots to sale schema
664c6b1 chore: track generated prisma client
733a561 feat: carry point exclusion through sale payload
72296e6 fix: carry point exclusion into invoice rows
0bc8185 docs: update point earning plan for repay
e693022 feat: preview member points during sale payment
99e69ec fix: zero point bases when points are ineligible
02dcd1b fix: treat rounded cash sales as cash points
02212fd docs: update point earning plan for cash rounding
22958ac feat: calculate sale points on server
1d3cfe4 docs: update point earning plan for sync
3e704eb fix: sync sale point snapshots
4193f70 feat: show earned points on sale receipts
f358e72 fix: preserve point exclusion on spend rows
```

This handover document is not included in the list above unless the next session
commits it.

## Main Files Changed

Client:

- `retail_pos_app/src/renderer/src/types/sales.ts`
- `retail_pos_app/src/renderer/src/types/models.ts`
- `retail_pos_app/src/renderer/src/libs/item-utils.ts`
- `retail_pos_app/src/renderer/src/libs/sale/points.ts`
- `retail_pos_app/src/renderer/src/libs/sale/payload.types.ts`
- `retail_pos_app/src/renderer/src/libs/sale/build-payload.ts`
- `retail_pos_app/src/renderer/src/libs/sale/invoice-row-to-line.ts`
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/usePaymentCal.ts`
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
- `retail_pos_app/src/renderer/src/components/PaymentModalForRepay/index.tsx`
- `retail_pos_app/src/renderer/src/service/sale.service.ts`
- `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
- `retail_pos_app/src/renderer/src/components/SaleInvoiceViewer.tsx`

Server:

- `retail_pos_server/prisma/schema.prisma`
- `retail_pos_server/prisma/migrations/20260506003000_add_point_fields_to_sale_invoice/migration.sql`
- `retail_pos_server/src/generated/prisma/**`
- `retail_pos_server/src/v1/sale/sale.points.ts`
- `retail_pos_server/src/v1/sale/sale.create.service.ts`
- `retail_pos_server/src/v1/sale/sale.refund.service.ts`
- `retail_pos_server/src/v1/sale/sale.repay.service.ts`
- `retail_pos_server/src/v1/sale/spend.create.service.ts`
- `retail_pos_server/src/v1/sale/sale.types.ts`
- `retail_pos_server/src/v1/cloud/cloud.sync.service.ts`
- `retail_pos_server/.gitignore`

## Data Model

Local POS schema now includes:

```prisma
model SaleInvoice {
  pointsEarned Int @default(0)
}

model SaleInvoiceRow {
  isPointExcluded Boolean @default(false)
}
```

Migration:

```text
retail_pos_server/prisma/migrations/20260506003000_add_point_fields_to_sale_invoice/migration.sql
```

Generated Prisma client output is now tracked. The previous `.gitignore` rule
for `/src/generated/prisma` was removed because the repo imports generated
client files from `src/generated/prisma`.

## Point Math

Client preview helper:

```text
retail_pos_app/src/renderer/src/libs/sale/points.ts
```

Server canonical helper:

```text
retail_pos_server/src/v1/sale/sale.points.ts
```

The intended formula:

```text
eligiblePointBase = sum(line.total where isPointExcluded = false)

if no member or no eligible base:
  pointsEarned = 0

cash-only with cash applied:
  cashPointBase = eligiblePointBase
  otherPointBase = 0

mixed/non-cash:
  cashPointBase = round(eligiblePointBase * cashApplied / linesTotal)
  otherPointBase = eligiblePointBase - cashPointBase

pointsEarned =
  round(cashPointBase * cash_point_rate / 1000)
  + round(otherPointBase * other_point_rate / 1000)
```

Notes:

- `cashApplied` is used, not cash received, so change does not earn.
- Surcharge and rounding are not part of the point base.
- Repay preview is disabled with `hasMember: false` and zero rates.
- Repay replacement invoices are forced to `pointsEarned = 0` server-side.

## Cloud/Data Server Boundary

`retail_pos_server/src/v1/cloud/cloud.sync.service.ts` now sends:

- invoice `pointsEarned`
- row `isPointExcluded`

The sibling data server already had pending matching support when checked:

- `/Users/dev/ktpv5/ktpv5-data-server/prisma/schema.prisma`
- `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/invoice.service.ts`
- `/Users/dev/ktpv5/ktpv5-data-server/prisma/migrations/20260506002302_add_point_fields_to_retail_invoice/migration.sql`

Important: that sibling repo had uncommitted local changes at the time of this
handover. Coordinate deployment of this POS branch with the data-server point
fields/migration.

## Verification Already Run

Fresh verification after the final SPEND-row fix:

```bash
cd retail_pos_server
npm run build
```

Result: passed, `tsc` exit `0`.

```bash
cd retail_pos_app
npm run build
```

Result: passed, `electron-vite build` exit `0`.

Final targeted review found no Critical or Important issues after the SPEND row
snapshot fix.

Known non-blocking caveat:

```bash
git diff --check main..HEAD
```

reports trailing whitespace / blank EOF warnings only inside
`retail_pos_server/src/generated/prisma/**`. These are Prisma-generated files
and were intentionally not hand-edited.

## Review History

Subagent review gates were run per task:

- Task 1 schema/generated client: spec review passed; quality review initially
  flagged generated client still ignored by `.gitignore`; fixed in `664c6b1`.
- Task 2 type/payload propagation: spec review caught missing
  `invoice-row-to-line.ts` mapping; fixed in `72296e6`.
- Task 3 client preview: spec review caught early-return base mismatch; fixed in
  `99e69ec`. Quality review caught cash-only rounding-down leakage; fixed in
  `02dcd1b`.
- Task 4 server canonical calculation: quality review caught missing cloud sync
  fields and missing local migration; fixed in `3e704eb`.
- Final whole-branch review caught SPEND rows losing the point-exclusion
  snapshot; fixed in `f358e72`.

## Suggested Next Session Steps

1. Commit this handover document if desired.
2. Re-run:

```bash
cd retail_pos_server && npm run build
cd retail_pos_app && npm run build
```

3. Decide whether to open a PR from `codex/sale-point-earning`.
4. Coordinate data-server branch/deployment for matching retail invoice point
   fields.
5. Before production rollout, apply migrations on:
   - local POS server DBs
   - data-server DB

## Manual Regression Checklist

When a full local POS + server environment is available:

- No member, eligible item, cash payment: no points shown.
- Member, eligible cash-only sale: cash rate applies.
- Member, eligible credit-only sale: other rate applies.
- Member, mixed cash/credit sale: point base splits by cash-applied share.
- Member, excluded item only: no points shown.
- Member, eligible plus excluded items: only eligible line totals earn.
- Cash received above total: change does not earn.
- Cash-only rounded-down total, e.g. `$10.02` to `$10.00`: full eligible base
  uses cash rate.
- REFUND: `pointsEarned = 0`.
- SPEND: `pointsEarned = 0`, row `isPointExcluded` snapshot persists.
- Repay replacement SALE: `pointsEarned = 0`, row `isPointExcluded` snapshot
  persists.
- Receipt and invoice viewer show `Points Earned` for normal SALE only.
