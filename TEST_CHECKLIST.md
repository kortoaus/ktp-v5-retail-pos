# Test Checklist

> 모든 금액은 cents, 수량은 ×1000 기준. 표시는 dollars/실수량.
> 도메인 결정사항은 `docs/sale-domain.md` 참조 (D-1 … D-36).

---

## 1. 시프트

- [ ] Open Shift — CashCounter 로 금액 입력, 서버에 cents 저장
- [ ] Close Shift — Summary 금액 정확 (SUM 재집계, D-34), cents 저장, 영수증 인쇄
- [ ] Shift Settlement 영수증 — tender 별 매출/환불 표시 (Cash/Credit/Voucher/GiftCard), surcharge 별도 라인

---

## 2. 일반 판매 (Normal)

### 스캔
- [ ] GTIN 바코드 스캔 → 라인 추가, 가격 정상
- [ ] PLU 바코드 스캔 → 라인 추가
- [ ] 동일 아이템 재스캔 → 라인 머지 (qty +1)
- [ ] SearchItemModal → 아이템 선택 → 라인 추가
- [ ] CloudHotkey 클릭 → 라인 추가
- [ ] 한글 IME 켜진 상태에서도 스캔 정상 작동 (`e.code` 기반)

### 라인 편집
- [ ] +1 / -1 버튼 → qty 변경
- [ ] Change Qty 모달 → 수량 직접 입력
- [ ] Override Price 모달 → 가격 직접 입력, `^` 표시
- [ ] Clear Override Price → `^` 제거, 원래 가격 복원
- [ ] Discount $ 모달 → 금액 할인 적용 (라인 unit_price_adjusted)
- [ ] Discount % 모달 → 퍼센트 할인 적용 (라인 unit_price_adjusted)
- [ ] Remove → 라인 삭제

### 표시
- [ ] U. Price = effective, original 과 다르면 취소선
- [ ] Qty = 실수량 (1, 2, 3...)
- [ ] Total = effective × qty

---

## 3. 멤버

- [ ] 멤버 바코드 스캔 → 멤버 설정, 버튼 하이라이트
- [ ] MemberSearchModal → 멤버 선택
- [ ] 멤버 설정 후 → 기존 라인 가격 재계산 (discounted 적용)
- [ ] 멤버 해제 → 가격 원복
- [ ] 멤버 변경 → PP 마크다운 라인도 재계산

---

## 4. Weight (저울)

- [ ] Weight 아이템 스캔 → WeightModal 열림
- [ ] 저울 읽기 → 무게 표시
- [ ] 확인 → 라인 추가 (qty = weight ×1000, measured_weight 설정)
- [ ] U. Price = effective/kg
- [ ] `0.XXXkg × $XX.XX/kg` 상세 표시
- [ ] Total = effective × weight / 1000

---

## 5. PP 바코드 (QR)

### 고정중량
- [ ] `00:{"01":"barcode","02":[prices],"03":[]}` 스캔 → normal 처럼 추가
- [ ] 가격 = prices[memberLevel], 프로모 있으면 promoPrices 중 최저

### Weight-Prepacked
- [ ] `00:{...,"04":weight}` 스캔
- [ ] qty = weight, measured_weight = weight
- [ ] U. Price = effective/kg (promo 반영)
- [ ] Total = effective × weight / 1000

### 마크다운
- [ ] `"05":1,"06":100` (pct 10%) → adjusted = effective × 90%
- [ ] `[10% OFF]` name prefix 표시
- [ ] U. Price = adjusted, `^` 표시, original 취소선

### 멤버 + PP 마크다운
- [ ] 멤버 없이 PP 스캔 → original 기준 마크다운
- [ ] 멤버 설정 → promo/level 가격 기준으로 마크다운 재계산
- [ ] 멤버 해제 → original 기준으로 복원

---

## 6. 아이템 레벨 프로모 가격 (PromoPrice)

- [ ] 유효기간 내 PromoPrice 있는 아이템 스캔 → `prices[level]` 과 `promoPrice[level]` 중 최저가 적용
- [ ] 유효기간 밖이면 promoPrice 무시
- [ ] 멤버 레벨 변경 시 라인 재계산 반영

> Note: 카트 / 문서 레벨 promotion 및 `documentDiscountAmount` 는 제거됨 (D-17).
> 할인은 전부 line-level (unit_price_adjusted).

---

## 7. 결제 (PaymentModal)

### 기본 UX
- [ ] Pay 버튼 → 모달 열림, Lines 패널에 cart 표시 (스크롤 정상)
- [ ] Summary 에 SUBTOTAL / GST / LINES TOTAL / TOTAL 정확
- [ ] Payments 리스트 스크롤 정상

### CASH
- [ ] 숫자 입력 → RECEIVED 표시
- [ ] Denomination 버튼 ($100, $50 ...) → 누적
- [ ] EXACT 버튼 → cash-only 면 `round5(left)`, mixed 면 `left` 그대로
- [ ] Multi-cash split → 각 cash row 할당 금액 FIFO
- [ ] ADD CASH PAYMENT → committed 에 추가
- [ ] Cash staged 만 있어도 Complete 가능 (ADD 없이)

### CREDIT
- [ ] BILL portion 입력 → EFTPOS = bill × (1 + surcharge rate/1000) 표시
- [ ] Pending list 에 `$bill` / `($eftpos)` 두 줄 표시
- [ ] Credit 입력만으로 Complete (ADD 없이 바로)

### GIFT CARD
- [ ] 금액 입력 → surcharge 없음, 그대로 payment.amount
- [ ] EXACT 버튼 = `left`

### USER VOUCHER
- [ ] Search Voucher → modal → 유저 목록 + 각 voucher 상태
- [ ] voucher 있고 balance>0 → 녹색 버튼 선택
- [ ] balance=0 → "$0.00" disabled
- [ ] voucher 없음 → Issue 버튼 → 서버 발행 → auto-select
- [ ] 이미 committed 된 voucher → "In use" disabled (D-31)
- [ ] Amount cap = min(left, voucher.balance)
- [ ] ADD USER VOUCHER → committed

### 라운딩 (D-30)
- [ ] Cash-only mode + cashIntent >= roundedCashTarget → 5¢ rounding 적용
- [ ] Mixed tender (non-cash 있음) → rounding 없음 (exact)
- [ ] Card-only → rounding 없음
- [ ] ROUNDING 라인 0 이면 Summary 에서 숨김

### SPEND toggle (D-29)
- [ ] Picker 맨 아래 SPEND 버튼 클릭 → toggle ON
- [ ] ON 시 tender picker 4 개 disabled, keypad 영역 overlay
- [ ] ON 시 payments 리스트 비어있음 (리셋됨)
- [ ] Complete 자리에 `RECORD SPEND` (orange) 버튼 표시
- [ ] OFF 전환 시 staged / payments / voucher 모두 리셋

### 결제 완료
- [ ] COMPLETE SALE → `POST /api/sale` → 성공 시:
  - [ ] cashIntent > 0 면 drawer 먼저 kick
  - [ ] 영수증 인쇄 (80mm thermal, `^#!` 범례, QR)
  - [ ] change > 0 면 ChangeOverlay (Open Drawer / Reprint / Done)
  - [ ] change = 0 면 자동 cart clear + modal close
- [ ] Serial 형식: `{shift.id}-{YYYYMMDD}-S{seq6}`
- [ ] RECORD SPEND → `POST /api/sale/spend` → 영수증 "*** INTERNAL ***"

### 오류
- [ ] Voucher balance 부족 → 서버 400, alert
- [ ] 금액 invariant 깨짐 (클라 버그) → 서버 400, alert
- [ ] Print 실패해도 거래는 저장됨 (invoice 재출력 가능)

---

## 8. 영수증 표시 (Sale/Spend/Refund)

### SALE / REFUND / SPEND 공통
- [ ] Store snapshot (companyName/address/ABN/phone)
- [ ] Invoice serial (placeholder `#id` → serial)
- [ ] Date / Terminal / Cashier / Member
- [ ] Rows — `^#` prefix, `qty @ $effective`, `(was $original)` + `(!$saved)` 가격 변경 시
- [ ] Legend: `^ = price changed  # = GST applicable  ! = Saved`
- [ ] QR payload `receipt%%%<serial>`

### SALE
- [ ] SUBTOTAL / Card Surcharge / Rounding / **TOTAL**
- [ ] Cash Received / Cash Paid / Change (현금 시)
- [ ] Credit Paid / Voucher Paid / Gift Card Paid
- [ ] GST Included (lineTax + surchargeTax)
- [ ] You Saved (line-level 절약 합)
- [ ] Vouchers Used 섹션 — entityLabel 리스트
- [ ] 푸터 "Thank you!"

### REFUND
- [ ] `*** REFUND ***` 헤더 + `Refund of #N`
- [ ] tender 라벨 `Cash Refunded` / `Credit Refunded` / `Voucher Refunded` / `Gift Card Refunded`
- [ ] REFUND TOTAL

### SPEND
- [ ] `*** INTERNAL ***` 헤더
- [ ] Totals / Payments / GST 섹션 생략
- [ ] 푸터 "Internal consumption - no payment"

---

## 9. 환불 (미구현 — 차후)

> `POST /api/sale/refund` + RefundScreen 은 아직. D-26 (surcharge 비례 환불) 반영 필요.

---

## 10. Invoice Search (`/manager/invoices`)

- [ ] Keyword (serial / companyName / memberName / row name / barcode) — 공백 분리 AND
- [ ] Date range filter
- [ ] Member filter (MemberSearchModal)
- [ ] Min/Max total filter (MoneyNumpad)
- [ ] Type filter: ALL / SALE / REFUND / SPEND
- [ ] Paging
- [ ] Row click → SaleInvoiceViewer (80mm thermal layout)
- [ ] Viewer 의 Print Copy 버튼 → `isCopy=true` 로 "** COPY **"
- [ ] 바코드 스캔 (`receipt%%%` prefix) → 자동 검색, 1건이면 viewer 자동 open
- [ ] 한글 IME 스캔 대응

---

## 11. 기타 화면

- [ ] PriceTagScreen — 아이템 가격 태그 인쇄
- [ ] StoreSettingScreen — surchargeRate permille, voucherDefault cents
- [ ] PrintLatestInvoiceButton — 현재 terminal 의 마지막 invoice 재출력
- [ ] Kick Drawer 버튼
- [ ] Sync 버튼 (파랑) → 클라우드 다운로드 + 업로드
- [ ] Sync 버튼 (빨강) → 다른 터미널 sync 완료 시
- [ ] Back 버튼 → 홈

---

## 12. 카트

- [ ] 카트 1~4 전환
- [ ] 각 카트 독립 (라인, 멤버)
- [ ] Clear Cart → 확인 후 클리어
- [ ] 커스터머 화면 BroadcastChannel 실시간 반영

---

## 13. PP 라벨 프린팅 (WeightLabelScreen)

- [ ] 아이템 스캔/검색
- [ ] 저울 읽기 (weight 아이템)
- [ ] Markdown % / $ 입력
- [ ] QR 바코드 `00:{...}` 생성
- [ ] 라벨 프린트 (SLCS QR)
- [ ] 출력된 QR 을 POS 에서 스캔 → 정상 인식
