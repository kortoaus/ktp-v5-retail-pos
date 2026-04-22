# Handover — End of 2026-04-22 session

**Written**: 2026-04-22 end-of-session
**Branch**: `main` (uncommitted changes — see `git status`)
**Next session's task**: Refund service + UI (RefundScreen), Cloud sync push, Shift-close re-aggregation.

Greet in Korean, say "읽고 왔습니다", ask which thread to pick up first.

---

## 1. Read in this order — before anything else

1. **`~/.claude/CLAUDE.md`** — global (한국어 요청 → 한국어 대답).
2. **`CLAUDE.md`** (project root) — units / pipeline / conventions. Updated today.
3. **`docs/sale-domain.md`** ⭐ — D-1 … D-36 locked decisions. **Multiple revisions today** (see §3).
4. **Memory**: `~/.claude/projects/-Users-dev-ktpv5-ktpv5-pos-retail/memory/MEMORY.md` + linked files.
5. **`retail_pos_server/prisma/schema.prisma`** — all Draft blocks migrated and live. `DocCounter`, Voucher domain applied.

---

## 2. What's done (end-to-end sale flow works)

### Server
- `src/v1/sale/` rebuilt from scratch:
  - `sale.create.service.ts` — 1. voucher 검증 → 2. 금액 invariant 검증 → 3. transaction (DocCounter upsert for serial → invoice+rows+payments nested create → voucher REDEEM for user-voucher payments). Shift 집계 increment 제거 (D-34).
  - `spend.create.service.ts` — SPEND 전용. 금액 전부 0, payments empty, row 가격 강제 0.
  - `sale.query.service.ts` — 리스트 (keyword / from-to / memberId / minTotal / maxTotal / type), by id, latest for terminal.
  - `sale.controller.ts` + `sale.router.ts` — `POST /`, `POST /spend`, `GET /`, `GET /latest`, `GET /:id`.
- `src/v1/voucher/` — 이전 세션에서 만든 `/daily` (list + issue) 유지.
- `src/router.ts` — `/voucher`, `/sale` 마운트 완료.
- Serial format (D-28): `{shift.id}-{YYYYMMDD}-{S|R|P}{seq6}` via `DocCounter.upsert(date-scoped atomic increment)`. Two-phase write 폐기.

### Schema (모두 migrate 됨)
- `TerminalShift`: 오타/중복 정리 + giftcard/surcharge 필드 (D-33). `startedCach → startedCash`, `cashIn/Out` 제거, `salesGiftcard/refundsGiftcard/salesCreditSurcharge/refundsCreditSurcharge` 추가.
- `SaleInvoice`: `lineTax`, `surchargeTax` 추가 (D-27).
- `SaleInvoiceRow`: `surcharge_share` 유지 (row-total 단위), `rounding_share` 제거 (D-26).
- `SaleInvoicePayment`: `@@index([invoiceId])`, `@@index([type, createdAt])` (D-36).
- `DocCounter` 신규 (D-28).
- `Staff` 삭제 (D-35, 빈 테이블이었음).

### Client
- `libs/sale/payload.types.ts` + `build-payload.ts` — `SaleCreatePayload` (SALE/SPEND 공유 shape). `buildSalePayload` / `buildSpendPayload`. CASH 는 단일 payment 로 집약 (D-32). Staged non-cash 도 ready 면 포함 (1-step complete flow).
- `PaymentModal/usePaymentCal.ts` — 8단계 섹션 구조 재정리 (LINES / PAYMENT INTENT / ROUNDING / INVOICE TOTALS / TAX BREAKDOWN / CASH APPLICATION / FIFO / PAID-REMAINING). `lineTax`/`surchargeTax` 분리 노출.
- `PaymentModal/index.tsx`:
  - CASH / CREDIT (surcharge 포함) / GIFTCARD / USER_VOUCHER input 전부 구현.
  - Rounding 은 cash-only mode 에서만 (D-30). EXACT 버튼이 `round5(left)` 주입.
  - Summary 패널 receipt-like (SUBTOTAL / GST / LINES TOTAL / ROUNDING / SURCHARGE / **TOTAL** / Payments by tender / PAID / REMAINING / CHANGE).
  - Complete Sale flow: createSale → getSaleInvoiceById → **drawer kick 먼저** (cashIntent > 0) → **printSaleInvoiceReceipt** → change overlay or auto-clear.
  - **SPEND toggle** (D-29) — picker 맨 아래 orange 버튼. ON 시 tender picker disabled + keypad 영역 black/50 overlay + Complete 자리에 `RECORD SPEND` 버튼 교체. Toggle 할 때마다 staged/committed/voucher 전부 리셋.
  - Voucher 중복 선택 차단 (D-31) — Search modal 에서 "In use" disabled.
  - Change overlay — `Open Drawer` / `Reprint` / `Done` 버튼. Reprint 는 `isCopy=true` 로 "** COPY **" 표기.
- `libs/printer/sale-invoice-receipt.ts` — 80mm thermal canvas renderer. `wrapText`, prefix (`^` changed / `#` GST / `!` saved) legend, SALE/REFUND/SPEND 분기, Vouchers Used 섹션, QR code (`receipt%%%<serial or INV-id>` placeholder until serial stabilises).
- `components/SaleInvoiceViewer.tsx` — 동일 80mm layout 모달. Sticky `Print Copy` 버튼.
- `components/PrintLatestInvoiceButton.tsx` — `getLatestSaleInvoice` 연결. 없으면 alert.
- `screens/SaleInvoiceSearchScreen.tsx` — 필터 (keyword / date range / member / min-max total / type) + 페이징 + row click → viewer. **QR 스캔 자동 검색** (한글 IME 대응 — `useBarcodeScanner` 를 `e.code` 기반으로 전면 교체). `/manager/invoices` 활성화, HomeScreen 에 버튼 추가.

### Docs
- `docs/sale-domain.md` 오늘 대폭 업데이트 — §6 refund math 재작성, §7 D-26 ~ D-36 신규 추가, §8 open questions 갱신.
- `CLAUDE.md` — SalesStore rename / pipeline 구조 반영 / sale-domain.md 참조 추가.

### Tooling
- `retail_pos_server/scripts/safe-reset.sh` — drift 난 로컬 dev DB 를 데이터 유지하며 reset (pg_dump data-only exclude `_prisma_migrations` → migrate reset --force → user 테이블 truncate → psql restore). libpq 모르는 Prisma 쿼리 파람 화이트리스트 필터 포함.

---

## 3. Major revisions this session (중요)

**Q5 폐기** (sale-domain.md §6) — REFUND 의 `creditSurchargeAmount = 0` 이 아니라 **비례 환불**. GST 대칭 / EFTPOS 정산 대칭 / 소비자 공정. Row 의 `surcharge_share` 비율로 refund_row 에 포함.

**`rounding_share` 삭제** (D-26) — 금액이 너무 작아 row 배분 무의미. Refund invoice 가 자체 rounding 재계산.

**Surcharge GST** (D-27) — `surchargeTax = round(creditSurchargeAmount / 11)`. Invoice 에 `lineTax` + `surchargeTax` 두 컬럼.

**Serial via DocCounter** (D-28) — two-phase write 폐기.

**TerminalShift 정리** (D-33) — 오타 / 중복 / giftcard / surcharge.

**No increment cache for shift** (D-34) — sale create 에서 `terminalShift.update({increment})` 제거. Close 시 재집계.

---

## 4. Known gaps / next session's focus

### 4-1. Refund flow (uppermost)
- `POST /api/sale/refund` 서비스 **미구현**.
- `RefundScreen` / Viewer 에서 refund 진입 버튼 **미구현**.
- 구현 시 필요:
  - Per-row refund qty 선택 UI (original row 의 `refunded_qty` 기반 cap)
  - Payment matching (원본 tender 합 ≥ refund total 체크, voucher 는 VoucherEvent REFUND + balance increment)
  - Surcharge 비례 환불 수식 (D-26) 적용
  - Refund invoice 의 자체 cash rounding (CASH tender 일 때만)
  - Serial prefix `R`
  - CRM voucher 포함 시 오프라인 거부 (D-21)
- `sale.refund.service.ts` 파일이 예전 스키마 기반으로 broken 상태로 남아있음 — 새로 쓰기.

### 4-2. Cloud sync push
- `SaleInvoice.synced`/`syncedAt`/`cloudId` 컬럼 있음, `createSaleService` 에 TODO 주석만.
- `retail_pos_server/src/v1/cloud/cloud.sync.service.ts` 기존 파일도 스키마 drift 상태.
- Shift / Invoice 별 push + 재시도 로직 필요.

### 4-3. Shift close 재작성
- 현재 `closeShift` 서비스가 increment cache 기반 (옛 코드 예상).
- D-34 대로 **SUM() 재집계** 방식으로 재작성:
  - `salesCash/Credit/Voucher/Giftcard` = `SUM(amount)` per tender from SaleInvoicePayment where invoiceId in (SALE invoices for shift)
  - `refundsCash/...` 동일 (REFUND invoices)
  - `salesTax` = Σ invoices.lineTax + surchargeTax
  - `salesCreditSurcharge` / `refundsCreditSurcharge` = Σ invoices.creditSurchargeAmount
  - `totalCashIn/Out` = SUM(CashInOut amount group by type)

### 4-4. Linkly / GiftCard provider API (Phase 4)
- 현재 전부 manual (EFTPOS / GiftCard 단말 사람이 키인).
- `eftpos-plan.md` / `linkly.md` 에 plan 있음.

### 4-5. Minor
- SaleScreen 의 `PrintLatestInvoiceButton` 실제 어디 mount 돼있는지 확인 필요 (컴포넌트만 살려둠).
- `retail_pos_server/src/v1/sale/` 내 **잔존 broken 파일** (예: `sale.refund.service.ts`) diagnostic 뜨는 중 — refund 작업 때 같이 정리.
- Invoice viewer 에서 refund 상태 표시 (원본 row.refunded_qty > 0 이면 "partially refunded" 뱃지).
- Receipt 에 `storeSetting.receipt_below_text` 반영 (`belowText` 인자로 전달 중, 호출부가 default "Thank you!" 써서 아직 영향 없음).

---

## 5. DO-NOTs (carried over)

1. Do NOT reintroduce `documentDiscountAmount`, `SaleInvoiceDiscount`, cart-level promotion engine, or per-payment `surcharge` column.
2. Do NOT push implementation when user's mental model is unclear — redesign or explain first (feedback memory).
3. Do NOT `git push` or open PRs without explicit request.
4. Do NOT run `prisma migrate dev` unattended. `safe-reset.sh` 만 사용자가 직접.
5. Do NOT invoke gstack skills unless explicitly asked.
6. Do NOT revert D-26 (surcharge 비례 환불) — GST 대칭 / EFTPOS 정산 대칭이 근거.
7. Do NOT increment-cache `TerminalShift.salesX` in sale create — D-34 위반.

---

## 6. First message to user

Korean, brief. Confirm read of:
- This handover
- `docs/sale-domain.md` (§6 refund math revised, D-26~D-36 신규)
- `CLAUDE.md` (pipeline 업데이트)
- Memory files
- `schema.prisma`

그리고 제안:
- **(a)** Refund service + UI (`POST /api/sale/refund` + RefundScreen). sale-domain.md §6 + D-26 준수.
- **(b)** Shift close 재작성 (D-34 재집계 방식).
- **(c)** Cloud sync push (`createSaleService` TODO 제거).
- **(d)** Receipt 세부 조정 (refund 원본 invoice 의 `refunded_qty` 연동, receipt_below_text 반영).

추천 순서: **(a) → (b) → (c) → (d)**. Refund 가 domain 완성도에 가장 크고, shift close / cloud 는 연쇄적.
