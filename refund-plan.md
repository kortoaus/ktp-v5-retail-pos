# Refund Plan — ktpv5-pos-retail

Working plan for the refund domain build-out. Supplements `docs/sale-domain.md`
§6 + D-21 / D-26 / D-28 / D-34 with the UI/flow decisions made in this session.

---

## 0. Scope

- **Partial + Full** refund 모두 지원.
- Cap rule: 각 refund tender 금액 ≤ 원본 invoice 의 해당 tender 금액.
  - 예시: 원본 Cash $50 + Credit $20. 전액 환불 → Cash $50 + Credit $20.
  - 예시: 원본 Cash $50 + Credit $20, 부분 환불 $30 → cashier 가 cap 안에서
    자유 배분 (Cash $30 / Cash $10+Credit $20 / Cash $25+Credit $5 …).
- Row cap: `refund_qty ≤ row.qty − row.refunded_qty`.

---

## 1. 이미 확정 (prior decisions)

| 항목 | 참조 |
|---|---|
| Refund math (surcharge 비례, rounding 독립) | §6 / D-26 |
| `refund_row.total = round((row.total + row.surcharge_share) × refund_qty / row.qty)` | §6 |
| Taxable 분기 GST | §6 |
| Serial prefix `R` via DocCounter | D-28 |
| Shift 집계: refund → current shift, close 시 SUM 재집계 | D-34 |
| `row.refunded_qty` — running counter on SALE row | D-18 |
| CRM customer-voucher offline → 전체 refund 거부 | D-21 |

---

## 2. 이번 세션 결정

### 2-1. Cap 계산은 실시간, 저장 안 함

원본 invoice 로드 시 server 가 refund children 까지 include 해서 내려줌. Client
가 다음 세 가지 cap 을 계산:

- **Per-tender cap** (CASH / CREDIT / GIFTCARD):
  `원본.payment.amount − Σ(prior REFUND 자식의 해당 type 결제 amount)`
- **Per-voucher-entity cap** (USER_VOUCHER / CUSTOMER_VOUCHER):
  `(entityType, entityId)` 조합별로 위와 동일.
- **Per-row cap**: `row.qty − row.refunded_qty` (refunded_qty 는 이미 저장됨,
  refresh 시 최신).

> 저장된 per-tender 누적 refund 컬럼 안 만듦. Source-of-truth 는 원본+children.

### 2-2. UI flow — 별도 screen

```
HomeScreen → [Refund] 버튼
         → /manager/refund                       (SALE invoice picker)
         → /manager/refund/:invoiceId            (refund detail)
```

Picker 는 `SaleInvoiceSearchScreen` 의 검색 panel 을 재활용 (type filter 는 SALE
고정). Detail 은 신규 화면.

### 2-3. Tender allocator — flat per-tender input

PaymentModal 의 staged → commit 패턴 X. Cap 이 정해져 있기 때문에 각 tender
당 **amount input 하나씩** 표시:

```
CASH           $___ / $50.00
CREDIT         $___ / $20.00
GIFTCARD       $___ / $0.00      (cap 0 → disabled)
USER_VOUCHER — Kim Staff Daily   $___ / $10.00
USER_VOUCHER — Goodwill #42      $___ / $5.00
CUSTOMER_VOUCHER — Welcome $5    $___ / $5.00
```

합산이 refund total 과 같아져야 submit 허용. Cap 초과 불가.

### 2-4. Voucher refund 동작

| Tender | 동작 |
|---|---|
| USER_VOUCHER | `VoucherEvent.REFUND +amount`, `Voucher.balance +=`. `validTo` / `status` 수정 안 함. Expired 상태여도 balance 복구는 되지만 사용 불가. |
| GIFTCARD | EFTPOS 단말 수동 처리. POS 는 amount 만 기록 (CREDIT 과 동일 shape, 엔티티 없음). |
| CUSTOMER_VOUCHER | CRM 필수. Offline 시 **invoice 전체 refund 거부** (D-21). |

### 2-5. Refund invoice rounding — 자체 재계산

- 모든 refund tender 가 CASH 인 경우에만 refund 자체의 5¢ rounding 적용
  (`Math.round(refund_total / 5) * 5` 로 round, delta 는 `invoice.rounding`).
- Non-cash tender 하나라도 있으면 rounding = 0, refund_total 그대로.
- 원본 invoice 의 rounding 은 refund 에 반영 안 함 (§6 rule).

### 2-6. Payload 계약 — server 가 canonical

Client 는 **refund 의도** 만 보냄. Server 가 D-26 수식으로 refund_row.total /
lineTax / surchargeTax / refund_total / rounding 을 재계산해서 저장.

```ts
interface RefundCreatePayload {
  originalInvoiceId: number;
  rows: { originalInvoiceRowId: number; refund_qty: number }[];
  payments: {
    type: "CASH" | "CREDIT" | "VOUCHER" | "GIFTCARD";
    amount: number; // cents
    entityType?: "user-voucher" | "customer-voucher";
    entityId?: number;
    entityLabel?: string;
  }[];
  note?: string;
}
```

Server validation 순서:
1. 원본 invoice 존재 + `type=SALE` 확인.
2. Customer-voucher 포함 시 CRM online 확인 (실패 시 reject 전체).
3. 각 row `refund_qty ≤ row.qty − row.refunded_qty`.
4. D-26 수식으로 refund_row.total 계산 → Σ = refund linesTotal.
5. refund 의 surcharge 부분 = Σ (row.surcharge_share × refund_qty / row.qty).
   → creditSurchargeAmount.
6. lineTax, surchargeTax (taxable 분기).
7. Rounding 규칙 (2-5) 적용 → refund_total 확정.
8. Σ payments.amount === refund_total 검증.
9. Per-tender / per-voucher-entity cap 검증 (원본 + 기존 children 조회 기반).
10. Transaction:
    - DocCounter 오늘자 increment → serial `{shiftId}-{YYYYMMDD}-R{seq6}`
    - REFUND SaleInvoice nested create (rows + payments)
    - 원본 각 row `refunded_qty += refund_qty` (update)
    - User-voucher 결제분마다 `VoucherEvent.REFUND` + `Voucher.balance += amount`
    - Shift 집계 increment 안 함 (D-34).

---

## 3. 작업 파트

### Part A — Client refactor (재활용 준비)

- **A1.** `components/SaleInvoiceSearchPanel.tsx` 추출. Props:
  - `onSelect(inv: SaleInvoiceListItem) => void`
  - `lockedTypeFilter?: InvoiceTypeWire`
  - `emptyLabel?: string`
  - QR 스캔, 필터, 페이징 전부 내부.
- **A2.** `SaleInvoiceSearchScreen` 을 panel 사용하는 thin wrapper 로 축소.
  기존 동작 (viewer 팝업) 유지.

### Part B — Server refund endpoint

- **B1.** `sale.query.service.ts` — `getSaleInvoiceByIdService` 에
  `refunds: { include: { rows, payments } }` 추가.
- **B2.** `sale.types.ts` — `RefundCreatePayload` 추가.
- **B3.** `sale.refund.service.ts` — 위 validation + transaction 구현.
- **B4.** `sale.controller.ts` + `sale.router.ts` — `POST /api/sale/refund`
  (scope `refund`).

### Part C — Client RefundScreen

- **C1.** 라우팅 + HomeScreen 버튼.
  - `/manager/refund` → `SaleRefundPickerScreen` (panel + SALE-locked)
  - `/manager/refund/:invoiceId` → `SaleRefundDetailScreen`
- **C2.** `libs/refund/compute.ts` — cap 계산, D-26 refund_row total, tax,
  rounding.
- **C3.** `libs/refund/payload.types.ts` + `build-payload.ts`.
- **C4.** `service/sale.service.ts` — `createRefundInvoice(payload)`.
- **C5.** `SaleRefundDetailScreen` UI — 아래 §4 wireframe 참조.

### Part D — Polish

- **D1.** `SaleInvoiceViewer` "Partially Refunded" 뱃지 + refund children
  요약 링크.
- **D2.** Receipt REFUND 분기 최종 검증 + 실제 프린트 확인.

---

## 4. UIUX — 다음 단계 (여기서 멈추고 잡는다)

`SaleRefundDetailScreen` 의 레이아웃 / 인터랙션을 다음 논의에서 확정. 고려 요소:

- 좌측 row 목록: row 별 qty ± picker, "refundable 3 / 5" 표시, refund_qty 0 인
  row 는 refund 에서 제외.
- 우측 tender allocator: flat input, cap 표시, disabled 조건 (cap=0).
- 하단 summary: refund subtotal / surcharge / tax / rounding / **REFUND TOTAL**
  / PAID / REMAINING.
- COMPLETE REFUND 버튼 활성 조건: `Σ payments == refund_total`, row 하나 이상
  선택, cap 위반 없음.
- Submit → REFUND invoice 생성 → drawer kick (cash refund 있으면) → receipt
  print → picker 로 복귀 or 홈.
- Customer-voucher 원본 invoice 이고 CRM offline 이면 detail 진입 시점에 전체
  비활성 + 안내.

Open — 다음 세션에서 확정:
- Row picker 표현 (qty stepper vs numpad vs 두 개 병용)
- Tender allocator 의 "남은 금액 auto-fill" 버튼 여부
- Refund reason / note 입력 필수 여부
- 확인 다이얼로그 여부 (submit 전 "이 금액을 환불합니다" confirm)
