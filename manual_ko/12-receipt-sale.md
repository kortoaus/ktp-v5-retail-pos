# Sale 영수증

> Sale 영수증의 각 섹션이 의미하는 바를 설명합니다.

---

## 영수증 구성 (위에서 아래)

### 헤더

| 줄 | 내용 |
|----|------|
| 1 | **매장명** (굵은 큰 글씨) |
| 2-3 | Address line 1, Address line 2 |
| 4 | Suburb, State, Postcode |
| 5 | "TAX INVOICE - ABN xxxxxxx" (ABN 없으면 "TAX INVOICE"만) |
| 6 | 전화번호 |
| 7 | Website ("https://..."로 인쇄) — 설정된 경우만 |

### 메타

| 줄 | 내용 |
|----|------|
| Invoice | Serial number (예: 1-5-2-123) |
| Date | Sale 날짜와 시간 |
| Terminal | Terminal 이름 |
| Member | Member 레벨 (member가 연결된 경우만) |

### 상품

각 상품은 다음과 같이 표시됩니다:
```
[^][#]상품명
  수량 @ $단가                    $합계
```

| 기호 | 의미 |
|------|------|
| **^** | 가격이 변경됨 (할인 또는 override — effective ≠ original) |
| **#** | GST 해당 (상품이 taxable) |

Weight 상품: `0.500kg @ $5.99/kg`
Prepacked 상품: `1 @ $12.50`
가격이 변경된 경우 괄호 안에 원가 표시: `(원가)`

### 합계

| 줄 | 내용 |
|----|------|
| SUBTOTAL | 상품 수 + 줄 합계의 합 |
| Discount | 전표 할인 (있는 경우, 음수로 표시) |
| Card Surcharge | Credit card surcharge (있는 경우, 양수로 표시) |
| Rounding | 5센트 반올림 조정 (+ 또는 −) |
| **TOTAL** | Surcharge를 포함한 최종 금액 |

**TOTAL 참고**: 영수증의 TOTAL은 surcharge를 포함합니다. `sale total + credit surcharge`로 EFTPOS 기기의 합계와 일치합니다.

### 결제

| 줄 | 내용 |
|----|------|
| Cash Received | 고객이 준 cash 총액 |
| Cash Paid | 청구서에 적용된 cash |
| Change | 돌려준 거스름돈 |
| Credit Paid | Surcharge를 포함한 카드 결제액 |

### 하단

| 줄 | 내용 |
|----|------|
| GST Included | 총 GST 금액 |
| You Saved | 총 할인 금액 (줄 할인 + 전표 할인) — 0보다 클 때만 |
| 범례 | "^ = price changed  # = GST applicable" |
| Footer 문구 | Store Settings의 receipt_below_text (기본값: "Thank you!") |
| QR code | Serial number를 인코딩 |
| COPY 마커 | "** COPY **" — 재인쇄 시에만 |
| 인쇄 시간 | 영수증이 인쇄된 시간 |
