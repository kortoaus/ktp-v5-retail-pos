# Handover — End of 2026-04-23 session

**Written**: 2026-04-23 end-of-session
**Branch**: `main` (uncommitted changes — see `git status`)
**Next session's task**: **Repay feature** (§4-1) → Shift-close re-aggregation → Cloud sync push → Receipt polish.

Greet in Korean, say "읽고 왔습니다", ask which thread to pick up first.

---

## 1. Read in this order — before anything else

1. **`~/.claude/CLAUDE.md`** — global (한국어 요청 → 한국어 대답).
2. **`CLAUDE.md`** (project root) — units / pipeline / conventions.
3. **`docs/sale-domain.md`** ⭐ — D-1 … D-36 locked decisions. **§6 rewritten 2026-04-23** (Interpretation A + drift absorption).
4. **`refund-plan.md`** — refund design decisions from 2026-04-23 (reference).
5. **Memory**: `~/.claude/projects/-Users-dev-ktpv5-ktpv5-pos-retail/memory/MEMORY.md` + linked files.
6. **`retail_pos_server/prisma/schema.prisma`** — all Draft blocks migrated and live.

---

## 2. What's done — as of end of 2026-04-23

### Refund flow (end-to-end, full — added this session)

#### Server
- `src/v1/sale/sale.refund.service.ts` (신규). Headers 주석에 **Interpretation A 분리 저장 + drift-absorbing 수식** 명시 — 잊지 말 것.
  - Validate: 원본 `type=SALE`, customer-voucher 차단 (D-21), per-row cap, per-tender/per-voucher-entity cap.
  - Drift absorbing: 각 원본 row 마다 `priorRefund{Product,Surcharge}` 집계 → remaining 기반 계산. `refund_qty === remainingQty` 이면 잔량 전부 → drift 자동 흡수.
  - Split storage: `refund_row.total` = product 만, `surcharge_share` = surcharge 분리. Invoice 레벨 `linesTotal = Σ product`, `creditSurchargeAmount = Σ surcharge`, `total = linesTotal + rounding + creditSurchargeAmount` (D-12 유지).
  - Cash-only refund 시 자체 5¢ rounding (D-30 동일 로직).
  - Transaction: DocCounter R-prefix serial → REFUND invoice nested create → 원본 row `refunded_qty += refund_qty` → user-voucher `VoucherEvent.REFUND +amount` + `Voucher.balance += amount` (`validTo` / `status` 변경 안 함). Shift 집계 increment 안 함 (D-34).
- `sale.controller.ts` + `sale.router.ts` — `POST /api/sale/refund` (scope `refund`).
- `sale.types.ts` — `RefundCreatePayload`, `RefundRowPayload`.
- `sale.query.service.ts` — `getSaleInvoiceByIdService` 에 refunds children include (cap 계산 원천).

#### Client
- Routing: `/manager/refund` (picker) → `/manager/refund/:invoiceId` (detail). HomeScreen 에 버튼.
- `components/SaleInvoiceSearchPanel.tsx` (신규) — 기존 `SaleInvoiceSearchScreen` 에서 filter+list+pagination+QR 스캔 추출. Props: `onSelect`, `lockedTypeFilter`, `emptyLabel`.
- `screens/SaleInvoiceSearchScreen.tsx` — 얇은 wrapper 로 refactor (viewer 팝업 유지).
- `screens/SaleRefundPickerScreen.tsx` (신규) — panel 을 `lockedTypeFilter="SALE"` 로 사용, row 클릭 시 `/manager/refund/:invoiceId` 로 navigate.
- `screens/SaleRefundDetailScreen/index.tsx` (신규):
  - URL param `:invoiceId` 로 로드. CRM customer-voucher 검출 시 상단 배너 + submit disabled (D-21).
  - Row qty 입력: `NORMAL` Numpad 정수 / `WEIGHT` Numpad 소수 / `PREPACKED`·`WEIGHT_PREPACKED` 토글 (0↔cap). "All {cap}" 퀵버튼.
  - Tender allocator: flat per-tender/per-voucher-entity 입력 (cap 표시). "Fill" 버튼이 cash-only 모드면 `round5(subtotal)` 주입 (PaymentModal EXACT 와 동일 원리, D-30).
  - Summary pane — receipt 스타일 (Subtotal / Surcharge / Rounding / REFUND TOTAL / GST / Paid / Remaining).
  - **COMPLETE REFUND 는 2-단계 confirm** — Review 모달 → Final 모달 ("REFUND NOW"). 그 뒤 `createRefundInvoice` → `getSaleInvoiceById` → drawer kick (cash refund 있으면) → `printSaleInvoiceReceipt` → `/manager/refund` 로 navigate.
- `libs/refund/compute.ts` — prior-refund 인지 + drift absorbing 수식 (서버와 동일). `computeTenderCaps`, `hasCustomerVoucherPayment`, `rowRefundable`, `rowRefundAmount`, `refundRowComputed`, `computeInvoice`.
- `libs/refund/payload.types.ts` + `build-payload.ts`.
- `service/sale.service.ts` — `createRefundInvoice` 추가. `SaleInvoiceDetail` 에 `refunds?: SaleInvoiceRefundChild[]` 필드.
- `components/SaleInvoiceViewer.tsx` — SALE invoice 에 refund children 이 있으면 상단에 `PARTIALLY REFUNDED` / `FULLY REFUNDED` 배너 + children serial 리스트 (receipt 자체에는 안 들어감).

### Docs
- `docs/sale-domain.md` §6 대폭 rewrite — Interpretation A 로 확정, drift-absorbing 수식 전체 서술. D-26 에 revised note.
- `refund-plan.md` (2026-04-23 생성) — 설계 과정 기록 (reference).

---

## 3. Major decisions locked this session

### §6 refund_row.total — Interpretation A (split storage)

§6 literal 의 `refund_row.total = round((row.total + surcharge_share) × qty / row.qty)` 은 **문자 그대로 저장하지 않는다**. 이유:
- 저장 시 surcharge 가 row.total 에 들어가면 invoice `creditSurchargeAmount` 와 이중 계산 → D-12 invariant 깨짐
- SALE/REFUND 간 `row.total` 의미 비대칭 → 모든 쿼리/receipt/cloud sync 가 type 분기 필요 (영구 부채)

대신 **분리 저장**:
- `refund_row.total` = 상품 부분만 (SALE 과 동일 의미)
- `refund_row.surcharge_share` = surcharge 부분 별도
- Invoice `linesTotal = Σ product`, `creditSurchargeAmount = Σ surcharge`, `total = linesTotal + rounding + creditSurchargeAmount` (D-12)
- Receipt 에 보이는 per-row 환불 금액 = `total + surcharge_share` (UI/receipt 관점 표시용)

§6 문구는 "per-row refund 개념값" 의 표현이었던 것. 저장 레이어와 분리해서 해석 — `sale-domain.md` §6 revised 참조.

### Drift-absorbing 수식

Naive `round(row.surcharge_share × refund_qty / row.qty)` 는 여러 번 나눠 환불 시 drift 누적. 해결: **row 별** prior refund 합 기반으로 remaining 계산, `refund_qty === remainingQty` 이면 잔량 전부 가져감 → drift 자동 흡수. 서버 `sale.refund.service.ts` 헤더 주석에 자세히. 클라이언트 `compute.ts` 도 동일 수식.

### CRM customer-voucher refund 차단 (D-21)

현재 CRM online check 미구현 (redeem 쪽도 아직). Customer-voucher payment 가 포함된 invoice 는 **refund 전면 차단** — UI 배너 + server `loadOriginalOrThrow` 에서 거부. Phase 4 에서 CRM API 붙으면 해제.

### Confirm twice

Refund 는 되돌리기 어려우므로 COMPLETE REFUND → Review 모달 → Final 모달 두 번 확인.

---

## 4. Known gaps / next session's focus

### 4-1. Repay feature ⭐ (내일 우선)

**Context**: 가끔 손님이 결제 끝났는데 "가방에서 cash 찾았어" / "이 카드 아니고 cash 로 낼게" / "이 돈 다른 데 써야 해" 같은 이유로 tender 를 바꾸고 싶어함. 현재는 refund → new sale 로 two-invoice 처리되는데, 같은 shift 안에서 refund 기록도 없는 invoice 면 그냥 SaleScreen **페이 직전 상태로 되돌리는** "repay" 가 깔끔.

**Entry 조건** (둘 다 만족):
1. `invoice.refunds.length === 0` (refund 기록 없음)
2. `currentShiftId === invoice.shiftId` (같은 shift 안)

**동작**:
1. 서버 — 전체 환불 (모든 row 전량, 모든 tender cap 풀로) **없이** SaleInvoice 자체를 삭제/void 하는 별도 endpoint 고려. Refund path 를 타면 refund invoice 가 남아 "기록 없음" 조건을 깨뜨리게 됨. 그래서 "repay" 는 refund 와 별개 path:
   - `POST /api/sale/:id/repay` — transaction:
     - 조건 재검증 (refunds.length=0, shiftId=current)
     - Payments 복원 (voucher redeem 되돌리기 — `VoucherEvent.ADJUST` 로 REDEEM 을 상쇄 + balance 복구)
     - SaleInvoice 삭제 (rows, payments cascade). DocCounter counter 는 되돌리지 않음 (serial gap 생김 — 허용).
     - 응답: 원본 invoice 의 rows + member snapshot (서버에서 rows 복원용)
   - 또는 soft-delete 플래그 (`voided: Boolean`, `voidedAt`) 추가 대안 — audit 측면 장점. 선택 필요.
2. 클라이언트 — `SaleInvoiceViewer` 에서 "Repay" 버튼 (조건 만족 시만 표시):
   - 버튼 클릭 → confirm 모달 → `POST /api/sale/:id/repay` 호출
   - 응답에서 rows + member 받아 **SaleScreen 의 `SalesStore` active cart 에 주입** → PaymentModal 열기 직전 상태.
   - Invoice viewer 닫기 + `/sale` 로 navigate.

**설계 포인트**:
- Voucher redeem 되돌리기: 원본 SaleInvoicePayment 중 `VOUCHER + user-voucher` 마다 balance 복구 + `VoucherEvent.ADJUST` (원 REDEEM 을 반대 부호로 상쇄). REFUND 이벤트 로그 달면 "refund 기록 없음" 조건과 혼동될 수 있어 별도 이벤트 타입 (`REPAY_REVERT`?) 고려할지 결정.
- Customer-voucher 포함 시 → repay 도 차단? 혹은 허용? **CRM 에 REDEEM 이미 기록됐을 수도 있어서** 차단이 안전. D-21 연장 적용.
- Member / discount / promo 스냅샷 복원: SaleLineType 에 저장된 field 들 중 ppMarkdown, adjustments, unit_price_adjusted 등 전부 원본대로. PaymentModal 재진입 시 금액 invariant 가 원본과 일치해야 함.
- SPEND 는 repay 안 됨 (같은 논리는 안 맞음). SALE 만.
- Hard-delete vs soft-delete — audit trail 관점에서 soft-delete (voided flag) 가 안전할 수도. 결정 필요.

### 4-2. Shift close 재작성 (D-34)

현재 `closeShift` 서비스가 increment cache 기반 (추정). D-34 대로 **SUM() 재집계**:
- `salesCash/Credit/Voucher/Giftcard` = `SUM(amount) GROUP BY type` from SaleInvoicePayment where invoiceId in (SALE invoices for shift)
- `refundsCash/...` 동일 (REFUND invoices)
- `salesTax` / `refundsTax` = Σ (invoice.lineTax + invoice.surchargeTax)
- `salesCreditSurcharge` / `refundsCreditSurcharge` = Σ invoice.creditSurchargeAmount
- `totalCashIn/Out` = SUM(CashInOut amount) group by type
- Drawer 차이 = `endedCashActual − endedCashExpected`

Repay 와 상호작용: repay 가 soft-delete 를 쓰면 집계에서 `WHERE voided = false` 필요.

### 4-3. Cloud sync push

`SaleInvoice.synced`/`syncedAt`/`cloudId` 컬럼 있음, `createSaleService` 에 TODO 주석만. `retail_pos_server/src/v1/cloud/cloud.sync.service.ts` 기존 파일 스키마 drift 상태 → 재작성. Shift / Invoice 별 push + 재시도 로직 필요. `createRefundService` 에도 동일 훅 필요.

### 4-4. Receipt 세부

- `storeSetting.receipt_below_text` 반영 (현재 default "Thank you!" 고정)
- Refund receipt 에 원본 invoice 의 refund 상태 요약 포함 여부 결정 (optional)

### 4-5. Linkly / GiftCard provider API (Phase 4)

현재 전부 manual (EFTPOS / GiftCard 단말 사람이 키인). `eftpos-plan.md` / `linkly.md` 에 plan 있음.

### 4-6. Broken / dead files 정리

Pre-session 이전 세션에서 남은 broken 파일들 — diagnostic 덮고 있음:
- `retail_pos_app/src/renderer/src/store/newSalesStore.helper.ts` (renamed to `SalesStore.*` — dead)
- `retail_pos_app/src/renderer/src/screens/NewSaleScreen/DocumentMonitor.tsx`
- `retail_pos_app/src/renderer/src/screens/NewSaleScreen/InvoiceReceiptViewer.tsx`
- `retail_pos_server/src/app.ts` 의 `userVoucher` / `userVoucherHistory` 참조 (Voucher/VoucherEvent 로 재명명됨)
- `retail_pos_server/src/v1/cloud/cloud.sync.service.ts` — 4-3 에서 재작성 예정이니 그때 정리

---

## 5. DO-NOTs (carried over + 추가)

1. Do NOT reintroduce `documentDiscountAmount`, `SaleInvoiceDiscount`, cart-level promotion engine, or per-payment `surcharge` column.
2. Do NOT push implementation when user's mental model is unclear — redesign or explain first (feedback memory).
3. Do NOT `git push` or open PRs without explicit request.
4. Do NOT run `prisma migrate dev` unattended. `safe-reset.sh` 만 사용자가 직접.
5. Do NOT invoke gstack skills unless explicitly asked.
6. Do NOT revert D-26 (surcharge 비례 환불) — GST 대칭 / EFTPOS 정산 대칭이 근거.
7. Do NOT increment-cache `TerminalShift.salesX` in sale/refund create — D-34 위반.
8. **Do NOT store `refund_row.total` as (product + surcharge) 합산 — Interpretation A 위반, D-12 invariant 깨짐.**
9. **Do NOT use naive `round(× qty / row.qty)` for refund math — drift 누적. 항상 remaining-based + last-absorbs 수식 사용.**
10. **Do NOT modify `Voucher.validTo` / `Voucher.status` during refund — balance 복구만. Expired 여도 그대로 둠.**

---

## 6. First message to user

Korean, brief. Confirm read of:
- This handover
- `docs/sale-domain.md` §6 (Interpretation A + drift)
- `CLAUDE.md`
- Memory files
- `schema.prisma`
- `refund-plan.md` (reference — 2026-04-23 설계 기록)

그리고 제안 (권장 순서):
- **(a) Repay** (§4-1) — Context 있는 UX 기능, refund 와는 path 분리. Hard vs soft delete 결정 필요.
- **(b) Shift close 재작성** (§4-2, D-34)
- **(c) Cloud sync push** (§4-3)
- **(d) Receipt 세부** (§4-4)
- **(e) Broken files 정리** (§4-6) — 언제든 끼워넣기 가능.
