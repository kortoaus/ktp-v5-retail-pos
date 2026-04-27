# Handover — End of 2026-04-24 session

Historical note: this was an end-of-session snapshot. The current source of
truth is `README.md`, `AGENTS.md`, and `docs/sale-domain.md`. Use this file only
for background on how D-38 cloud sync was introduced.

**Written**: 2026-04-24 end-of-session
**Branch**: `main` (커밋은 사용자가 단계별로 수행 중)
**Next session's task**: **없음 — Phase 3 사이클 종료**. 사용자가 다른 서버(main api /
data-server 배포) 쪽 작업 중. POS 쪽은 안정화 단계 → 다음 이슈가 올라올 때까지 대기.

Greet in Korean, say "읽고 왔습니다", 다음 작업 확인 후 착수.

---

## 1. Read in this order — before anything else

1. **`~/.claude/CLAUDE.md`** — global (한국어 요청 → 한국어 대답).
2. **`CLAUDE.md`** (project root) — units / pipeline / conventions.
3. **`docs/sale-domain.md`** ⭐ — D-1 … **D-38** locked decisions. **D-38
   (Cloud sync push)** 이 이번 세션의 핵심.
4. **Memory**: `~/.claude/projects/-Users-dev-ktpv5-ktpv5-pos-retail/memory/MEMORY.md` + linked files.
5. **`retail_pos_server/prisma/schema.prisma`** — live. `SaleInvoice` /
   `TerminalShift` 의 `synced`/`syncedAt` 삭제, `cloudId Int?` 단일 플래그.
6. **`/Users/dev/ktpv5/ktpv5-data-server/prisma/schema.prisma`** — mirror
   저장소. `RetailSaleInvoice` / `RetailTerminalShift` `@@unique([deviceId,
   localId])` + D-34 전체 필드 + `InvoiceType` enum.
7. `refund-plan.md`, `eftpos-plan.md`, `linkly.md` (reference).

---

## 2. What's done — as of end of 2026-04-24

### Cloud sync push (§4-3 — FULL)

D-38 전체 참조. 간단 요약:

#### Schema — POS side
- `SaleInvoice.synced` / `syncedAt` 제거, `cloudId Int?` 단일 플래그.
  `@@index([cloudId])` 추가.
- `TerminalShift` — 기존에 없던 `cloudId Int?` 추가 (D-38 원칙 1). 동시에
  `synced`/`syncedAt` 제거. `@@index([cloudId])`.

#### Schema — data-server side (`/Users/dev/ktpv5/ktpv5-data-server`)
- `@@unique([deviceId, localId])` — `RetailSaleInvoice`, `RetailTerminalShift`
  양쪽. Upsert 시 idempotency 확보.
- `enum InvoiceType { SALE REFUND SPEND }` 신규, `RetailSaleInvoice.type`
  String → enum.
- `RetailTerminalShift.createdAt` / `updatedAt` 신규. `openedNote` /
  `closedNote` nullable 화.
- `RetailSaleInvoice` 에서 POS-local 개념 오복사였던 `synced` / `syncedAt` /
  `cloudId` 삭제. `serial` 을 nullable 로 맞춤 (POS 와 대칭).
- Deprecated 섹션 (`TerminalShift`, `SaleInvoice`, `SaleInvoiceRow`,
  `SaleInvoicePayment`, `SaleInvoiceDiscount`) 은 기존 데이터 보존을 위해
  **건드리지 않음** (사용자 명시).

#### Server — data-server sync services (전면 재작성)
- `src/retail/invoice/invoice.service.ts` — `syncRetailSaleInvoice(dto)`
  - DTO 는 새 POS schema 와 1:1 (linesTotal, creditSurchargeAmount, 없는
    `discounts` / `surcharge` on payment, InvoiceType/PaymentType 등).
  - `findUnique({ deviceId_localId })` 로 idempotent 체크 → 없으면 nested
    create (rows + payments).
  - 응답: `{ ok, msg, result: { id } }`. 이미 있으면 기존 `id` 반환.
  - `pushSignal(memberId)` 은 CRM 적립 신호 best-effort (실패해도 sync ok).
- `src/retail/shift/shift.service.ts` — `syncRetailTerminalShift(dto)`
  - D-34 모든 필드 (split voucher, giftcard, lineTotals/rounding/counts,
    spendCount/spendRetailValue, repayCount) 포함한 DTO.
  - 동일 upsert 패턴.

#### Server — POS sync client (신규 `cloud.sync.service.ts`)
- `syncAllSaleInvoices()` — `cloudId IS NULL AND serial IS NOT NULL` 을
  id ASC 로 순회, `originalInvoiceId` 있으면 로컬 parent 의 `cloudId`
  lookup 해서 payload 에 cloud id 로 주입, POST
  `/device/sync/retail/sale-invoice`. 성공 시 로컬 `cloudId` 업데이트.
  실패/parent 미싱크 시 **break** (종속성 보호).
- `syncAllShifts()` — `cloudId IS NULL AND closedAt IS NOT NULL` 을 id ASC
  순회, POST `/device/sync/retail/terminal-shift`. 실패 시 break.
- `triggerSyncAllSaleInvoices()` / `triggerSyncAllShifts()` — fire-and-forget
  래퍼. Module-level flag (`invoiceSweepRunning` / `shiftSweepRunning`) 으로
  동시 sweep race 방지.
- Payload 에 `deviceId` 없음 — main api 가 주입. POS 는 모름.

#### Server — trigger 배선
- `sale.create.service.createSaleService` — create 후 `triggerSyncAllSaleInvoices()`
- `sale.refund.service.createRefundService` — 동일
- `sale.repay.service.createRepayService` — 동일 (refund + new sale 두 건을
  한 sweep 이 처리)
- `shift.service.closeTerminalShiftService` — close 후
  `triggerSyncAllSaleInvoices()` + `triggerSyncAllShifts()` 순차 (invoice 먼저
  cloud id 확보 → shift push)
- `index.ts` — `httpServer.listen` 콜백에 양쪽 trigger (서버 재기동 catch-up)
- **Cron / interval scheduler 없음** (사용자 결정) — 다음 sale 이 어차피
  sweep 돌리므로 실운영 커버 충분.

#### 부수 정리
- `terminal.middleware.ts` — 제거된 `synced: false` 필터 삭제 (open shift
  lookup).
- 클라 `types/models.ts` `TerminalShift` — `synced`/`syncedAt` 제거,
  `cloudId?: number | null` 추가.
- 핸드오버 §4-6 dead files (`newSalesStore.helper.ts`,
  `NewSaleScreen/DocumentMonitor.tsx`, `NewSaleScreen/InvoiceReceiptViewer.tsx`,
  `NewSaleScreen` 폴더 전체) 이미 삭제된 상태 확인.
- `retail_pos_server/src/app.ts` 의 `userVoucher`/`userVoucherHistory` 참조 —
  검증 결과 stale 참조 없음 (현재 `userVoucher` 문자열은 전부 D-20
  `entityType === "user-voucher"` 관련 변수/필드).

### Transport 계약 (확정)

- POS → `API_URL` (main api) → data-server.
- Endpoint: `/device/sync/retail/sale-invoice`,
  `/device/sync/retail/terminal-shift`.
- 인증: `device-api-key` 헤더 + `Authorization: Bearer dk_<API_KEY>`
  (`libs/cloud.api.ts`).
- Main api 가 `device-api-key` → `deviceId` resolve 해서 body 에 주입 →
  data-server 로 forward.
- Data-server 응답 `{ ok, msg, result: { id } }` → POS 가 `result.id` 를
  로컬 `cloudId` 에 저장.

---

## 3. Major decisions locked this session

### D-38 (see sale-domain.md §7 Repay + Cloud sync)

4가지 원칙:
1. `cloudId != null ⟺ synced` (single flag).
2. id-ASC sweep, 실패 시 break (repay chain 보호).
3. Fire-and-forget, no cron (다음 sale 이 sweep 재트리거).
4. `originalInvoiceId` 는 push 전 cloud id 로 resolve.

### Idempotency

Data-server `@@unique([deviceId, localId])` + findUnique check. 네트워크
재시도 시 중복 생성 불가능. POS 쪽 `cloudId` 도 한 번 세팅되면 덮어쓰기 대상
아님 (다음 sweep 쿼리가 `cloudId: null` 만 pick).

### Retry 전략

별도 cron 없음. 다음 sale/refund/repay/shift close 이벤트가 일어나면 그때
`syncAll*()` 이 다시 밀린 것부터 재시도. 서버 재기동도 catch-up 포인트.
운영상 "판매가 멈춘 매장은 어차피 sync 지연 허용" 이라는 가정.

---

## 4. Known gaps / next session's focus

### 4-1. (없음 — Cloud sync 끝남)

### 4-2. Linkly / GiftCard provider API (Phase 4) — `eftpos-plan.md` / `linkly.md`
현재 전부 manual (EFTPOS / GiftCard 단말 사람이 키인). Phase 4 에서
CRM customer-voucher redeem/refund 도 D-21 해제.

### 4-3. D-6 LineAdjustment enum redesign (deferred)
현재 `LineAdjustment[]` 는 단순 string enum. 향후 `{ type, reason?,
authorizedByUserId? }[]` 구조화 검토. 급하지 않음.

### 4-4. Manager override — CRM offline 시 강제 refund, voucher balance 수동
조정. Scoping + audit 미결.

### 4-5. Goodwill voucher "consideration received" ATO 해석 — 급하지 않음.

---

## 5. DO-NOTs (carried over + D-38)

1. Do NOT reintroduce `documentDiscountAmount`, `SaleInvoiceDiscount`,
   cart-level promotion engine, or per-payment `surcharge` column.
2. Do NOT push implementation when user's mental model is unclear —
   redesign or explain first (feedback memory).
3. Do NOT `git push` or open PRs without explicit request.
4. Do NOT run `prisma migrate dev` unattended. `safe-reset.sh` 만 사용자가
   직접. Prod 직전 user 가 reset 예정.
5. Do NOT invoke gstack skills unless explicitly asked.
6. Do NOT revert D-26 (surcharge 비례 환불) — GST 대칭 / EFTPOS 정산 대칭이 근거.
7. Do NOT increment-cache `TerminalShift.salesX` in sale/refund/repay create —
   D-34 위반 (aggregateShift 만 신뢰).
8. Do NOT store `refund_row.total` as (product + surcharge) 합산 —
   Interpretation A 위반, D-12 invariant 깨짐.
9. Do NOT use naive `round(× qty / row.qty)` for refund math — drift 누적.
   항상 remaining-based + last-absorbs 수식 사용.
10. Do NOT modify `Voucher.validTo` / `Voucher.status` during refund —
    balance 복구만. Expired 여도 그대로 둠.
11. Do NOT iterate `invoice.refunds` without `type === "REFUND"` filter —
    repay 가 새 SALE 을 같은 relation 에 남기므로.
12. Do NOT bypass 10분 / same-shift / no-refund / customer-voucher 제약 for
    repay — UX 편의지만 회계 경계 넘지 말 것.
13. Do NOT store dollar-scaled money in any `amount` field — 전부 cents.
    CashIO 가 이것 때문에 버그였음.
14. **Do NOT add cron/interval scheduler to `cloud.sync.service.ts`** —
    D-38 원칙 3. 트리거 기반으로 충분하다는 사용자 결정.
15. **Do NOT send POS payload as `{ data: payload }` wrapped** — main api 가
    자체 wrap 추가하므로 POS 는 flat `payload` 전송이 contract.
    (현재 구현은 `apiService.post(url, { data: payload })` — main api proxy
    구성에 따라 달라질 수 있음. 2026-04-24 시점 endpoint 는
    `/device/sync/retail/...` 로 정착.)

---

## 6. First message to user

Korean, brief. Confirm read of:
- This handover
- `docs/sale-domain.md` (D-38 포함)
- `CLAUDE.md`
- Memory files
- `schema.prisma` (POS + data-server 양쪽)

POS 쪽은 안정화 단계라 구체적 next task 없음. 사용자에게 이번 세션에서
무엇을 할지 확인 후 착수.
