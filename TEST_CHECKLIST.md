# Test Checklist

> 모든 금액은 cents, 수량은 ×1000 기준. 표시는 dollars/실수량.

---

## 1. 시프트

- [ ] Open Shift — CashCounter로 금액 입력, 서버에 cents 저장 확인
- [ ] Close Shift — Summary 금액 정확, 서버에 cents 저장, 영수증 인쇄
- [ ] Shift Settlement 영수증 — 금액 표시 정상 (dollars)

---

## 2. 일반 판매 (Normal)

### 스캔
- [ ] GTIN 바코드 스캔 → 라인 추가, 가격 정상
- [ ] PLU 바코드 스캔 → 라인 추가
- [ ] 동일 아이템 재스캔 → 라인 머지 (qty +1)
- [ ] SearchItemModal → 아이템 선택 → 라인 추가
- [ ] CloudHotkey 클릭 → 라인 추가

### 라인 편집
- [ ] +1 / -1 버튼 → qty 변경
- [ ] Change Qty 모달 → 수량 직접 입력
- [ ] Override Price 모달 → 가격 직접 입력, `*` 표시
- [ ] Clear Override Price → `*` 제거, 원래 가격 복원
- [ ] Discount $ 모달 → 금액 할인 적용
- [ ] Discount % 모달 → 퍼센트 할인 적용
- [ ] Remove → 라인 삭제

### 표시
- [ ] U. Price = effective, original과 다르면 취소선
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

### 고정중량 (weight 없음)
- [ ] `00:{"01":"barcode","02":[prices],"03":[]}` 스캔 → normal처럼 추가
- [ ] 가격 = prices[memberLevel], 프로모 있으면 promoPrices 중 최저

### Weight-Prepacked (weight 있음)
- [ ] `00:{"01":"barcode","02":[...],"03":[...],"04":weight}` 스캔
- [ ] qty = weight, measured_weight = weight
- [ ] U. Price = effective/kg (promo 반영)
- [ ] Total = effective × weight / 1000
- [ ] `0.XXXkg × $XX.XX/kg` 상세 표시

### 마크다운
- [ ] `"05":1,"06":100` (pct 10%) → adjusted = effective × 90%
- [ ] `[10% OFF]` name prefix 표시
- [ ] U. Price = adjusted, `*` 표시, original 취소선
- [ ] Total 정확

### 멤버 + PP 마크다운
- [ ] 멤버 없이 PP 스캔 → original 기준 마크다운
- [ ] 멤버 설정 → promo/level 가격 기준으로 마크다운 재계산
- [ ] 멤버 해제 → original 기준으로 복원

---

## 6. 프로모션

- [ ] BUY_MORE_SAVE_MORE 조건 충족 → useCartDiscounts에 할인 표시
- [ ] Discounts 버튼 하이라이트
- [ ] DiscountListModal 열림, 할인 내역 표시
- [ ] DocumentMonitor DUE = lineTotal - promotionDiscount
- [ ] 조건 미충족 시 할인 자동 제거
- [ ] 커스터머 화면에 할인 표시

---

## 7. 결제 (PaymentModal)

### 기본
- [ ] Pay 버튼 → 모달 열림
- [ ] Subtotal 정확 (lineTotal - promotionDiscount)
- [ ] Cash 입력 → remaining 업데이트
- [ ] Credit 입력 → surcharge 표시 (permille 기준)
- [ ] Note 버튼 ($100, $50...) → cents로 정확히 추가
- [ ] Add Payment → committed에 추가
- [ ] Remove Payment → 삭제
- [ ] Voucher 선택 → remaining 차감

### 할인
- [ ] Discount % → documentDiscountAmount 정확
- [ ] Discount $ → cents 정확

### 라운딩
- [ ] Cash 있을 때 → 5c 라운딩 적용
- [ ] Cash 없을 때 → 라운딩 없음

### 결제 완료
- [ ] Pay 클릭 → 인보이스 생성
- [ ] discount_amount 라인별 배분 정확
- [ ] tax_amount_included 라인별 배분 정확 (과세/비과세 구분)
- [ ] total = subtotal - docDiscount + rounding + surcharge
- [ ] 영수증 인쇄 정상
- [ ] Cash → 서랍 킥
- [ ] 거스름돈 화면 표시 → Close → 카트 클리어

### 클라우드 싱크
- [ ] 인보이스 생성 후 클라우드 싱크 호출
- [ ] discount_amount 포함 확인

---

## 8. 영수증 표시

### 판매 영수증 (ESC/POS + 화면)
- [ ] 아이템 라인: `qty @ effective` (normal)
- [ ] 아이템 라인: `weight × effective/kg` (weight/weight-prepacked)
- [ ] priceChanged → `(original)` 취소선 + `(!$saved)`
- [ ] 프로모 할인 표시
- [ ] Subtotal, Discount, Surcharge, Rounding 순서
- [ ] TOTAL = 고객 실제 지불액 (surcharge 포함)
- [ ] Cash Received / Cash Paid / Change
- [ ] Credit Paid = credit + surcharge
- [ ] GST Included / You Saved

### 환불 영수증
- [ ] REFUND 배너
- [ ] 아이템 라인 동일 패턴
- [ ] REFUND TOTAL 정확

---

## 9. 환불 (RefundScreen)

### 인보이스 검색
- [ ] 인보이스 검색 → 선택 → RefundPanels 표시
- [ ] 바코드 스캔 (receipt%%%) → 자동 검색

### 라인 선택
- [ ] 라인 클릭 → 전체 수량 환불 (qty=1 또는 weight-prepacked)
- [ ] 부분 수량 → RefundQtyModal (float 입력 → ×1000)
- [ ] 이미 선택된 라인 재클릭 → 경고
- [ ] 완전 환불된 라인 → 경고

### discount_amount 반영
- [ ] remainingTotal = total - discount_amount - 기존환불 (서버)
- [ ] 부분 환불: appliedTotal = netTotal × inputQty / qty
- [ ] RefundableRowCard: discount_amount > 0이면 net 표시 + 원가 취소선

### 결제
- [ ] Cash/Credit cap 정확 (원래 결제 수단 기준)
- [ ] Voucher cap 정확
- [ ] BALANCED 확인 → Process Refund
- [ ] 환불 인보이스 생성
- [ ] 영수증 인쇄
- [ ] Cash → 서랍 킥
- [ ] 클라우드 싱크

---

## 10. PP 라벨 프린팅 (WeightLabelScreen)

- [ ] 아이템 스캔/검색
- [ ] 저울 읽기 (weight 아이템)
- [ ] Markdown % / $ 입력
- [ ] QR 바코드 `00:{...}` 생성 확인
- [ ] 라벨 프린트 (SLCS QR)
- [ ] 출력된 QR을 POS에서 스캔 → 정상 인식

---

## 11. 카트

- [ ] 카트 1~4 전환
- [ ] 각 카트 독립 (라인, 멤버)
- [ ] Clear Cart → 확인 후 클리어
- [ ] 커스터머 화면에 실시간 반영 (BroadcastChannel)

---

## 12. 기타

- [ ] LabelingScreen — 가격 표시 정상 (cents → dollars)
- [ ] LabelingScreen — 가격 오버라이드 입력
- [ ] StoreSettingScreen — surchargeRate permille, voucherDefault cents
- [ ] InvoiceSearchPanel — 목록 total 정확
- [ ] Reprint 버튼 → 최근 영수증 인쇄
- [ ] Kick Drawer 버튼
- [ ] Sync 버튼 → 클라우드 다운로드 + 업로드
- [ ] Back 버튼 → 홈으로
