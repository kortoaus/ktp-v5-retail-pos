# 결제 규칙

POS가 최종 금액, 세금, 반올림, 거스름돈을 계산하는 방법.

모든 계산은 부동소수점 오류를 방지하기 위해 `decimal.js`를 사용합니다. 모든 금액은 달러 단위입니다.

---

## 계산 흐름

```
subTotal (소계)
  → documentDiscountAmount (전표 할인)
  → exactDue = subTotal - documentDiscountAmount (정확한 결제액)
  → roundedDue = exactDue를 5센트 단위로 반올림
  → hasCash = 현금 결제 존재 여부
  → effectiveDue = hasCash ? roundedDue : exactDue (실제 청구액)
  → effectiveRounding = hasCash ? (roundedDue - exactDue) : 0
  → 카드 결제 건별 수수료 = r2(카드 결제액 × 1.5%)
  → totalSurcharge = Σ 건별 수수료
  → totalEftpos = totalCredit + totalSurcharge
  → taxAmount (반올림 전 exactDue + totalSurcharge 기준 세금)
  → remaining = effectiveDue - totalCash - totalCredit (잔액)
```

핵심 설계: **수수료는 판매 총액과 분리됩니다.** 청구서는 `effectiveDue`입니다. 수수료는 EFTPOS 기기를 통해 별도로 수금됩니다. `cashPaid + creditPaid = total`이 항상 성립합니다.

---

## 단계별 설명

### 1. 소계 (Subtotal)

모든 라인의 합계 (유효 단가 × 수량).

```
subTotal = Σ line.total
```

### 2. 과세 비율 (Taxable Ratio)

소계 중 과세 대상 비율.

```
taxableRatio = (Σ 과세 라인 합계) ÷ subTotal
```

소계가 0이면 과세 비율도 0.

### 3. 전표 할인 (Document Discount)

라인별 가격 적용 이후 전체 전표에 적용되는 할인. 두 가지 방식:

| 방식 | 계산 |
|------|------|
| 퍼센트 | subTotal × (퍼센트 ÷ 100) |
| 정액 | 고정 달러 금액 |

결제 시 검증: 할인이 소계를 초과할 수 없음.

### 4. 정확한 결제액 (Exact Due)

반올림 전 고객이 지불해야 할 금액.

```
exactDue = subTotal - documentDiscountAmount
```

### 5. 반올림 (호주 5센트 규칙)

호주에서는 1센트, 2센트 동전이 폐지되었습니다. 반올림은 **현금 결제가 포함된 경우에만** 적용됩니다. 카드 단독 결제는 정확한 금액을 사용합니다.

| 끝자리 | 반올림 결과 |
|--------|------------|
| .01, .02 | .00 (내림) |
| .03, .04, .05 | .05 (올림/유지) |
| .06, .07 | .05 (내림) |
| .08, .09 | .10 (올림) |

```
roundedDue = exactDue를 0.05 단위로 반올림 (ROUND_HALF_UP)
rounding = roundedDue - exactDue

hasCash = totalCash > 0
effectiveDue = hasCash ? roundedDue : exactDue
effectiveRounding = hasCash ? rounding : 0
```

요약 화면에서는 결제 수단에 관계없이 항상 `roundedDue`를 "Cash Total"로 표시하여 캐셔가 참고할 수 있도록 합니다.

### 6. 분할 결제 (Split Payments)

결제는 결제 라인의 순서 목록으로 저장됩니다. 각 라인에는 유형과 금액(판매 잔액에 적용되는 금액)이 있습니다.

```
Payment = { type: "cash" | "credit", amount: number }
```

**일반 흐름** (대부분의 거래): 캐셔가 카드/현금 금액을 입력 후 결제 버튼을 누르면 입력값에서 결제 라인이 자동 생성됩니다.

**분할 흐름** (드문 경우): 금액 입력 → "Add Payment" 탭 → 결제 목록에 커밋되고 입력이 초기화됩니다. 필요한 만큼 반복. 결제 버튼을 누르면 커밋된 라인과 현재 입력값이 합쳐져 최종 결제가 됩니다.

### 7. 카드 수수료 (건별 적용)

1.5% 수수료가 **카드 결제 건별**로 적용되며, 각각 독립적으로 소수점 2자리 반올림됩니다.

```
각 카드 결제 건에 대해:
  surcharge = r2(amount × 0.015)
  eftpos = amount + surcharge

totalSurcharge = Σ 건별 수수료
totalEftpos = totalCredit + totalSurcharge
```

수수료는 **판매 총액에 포함되지 않습니다.** EFTPOS 기기를 통해 수금됩니다. 카드 기기는 건별로 `eftpos`를 청구합니다.

건별 반올림으로 인해 `totalSurcharge`는 `totalCredit × 0.015`와 1센트 차이가 날 수 있습니다.

결제 시 검증: 총 카드 금액이 `effectiveDue`를 초과할 수 없음.

### 8. 세금 (GST)

모든 가격은 GST 포함가 (10% GST). 세금은 추가가 아닌 추출.

```
GST = (과세 금액) ÷ 11
```

세금은 **반올림 전** 금액 기준으로 계산:

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = totalSurcharge × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

카드 수수료는 과세 상품 비율에 따라 GST가 부과됩니다.

### 9. 잔액 / 거스름돈

```
remaining = effectiveDue - totalCash - totalCredit
```

| remaining | 의미 |
|-----------|------|
| > 0 | 고객이 아직 지불해야 할 금액 |
| = 0 | 결제 완료 |
| < 0 | 거스름돈 (절대값) |

거스름돈 표시는 총 현금 수령액으로 제한됩니다 (현금보다 많은 거스름돈을 줄 수 없음):

```
displayedChange = min(changeAmount, totalCash)
```

---

## 총 할인 (영수증 요약)

영수증의 "절약 금액" 항목:

```
originalSubTotal = Σ (line.unit_price_original × line.qty)
totalDiscountAmount = (originalSubTotal - subTotal) + documentDiscountAmount
```

---

## 결제 수단

| 수단 | 수수료 | 반올림 |
|------|--------|--------|
| 현금만 | 없음 | 5센트 반올림 적용 |
| 카드만 | 건별 1.5% (EFTPOS 경유) | 반올림 없음 |
| 현금 + 카드 | 카드 건별 1.5% (EFTPOS 경유) | 5센트 반올림 적용 |

---

## 페이로드 (OnPaymentPayload)

데이터베이스에 저장되는 값:

| 필드 | 값 |
|------|-----|
| subtotal | Σ line.total |
| documentDiscountAmount | 전표 할인 금액 |
| creditSurchargeAmount | Σ 건별 카드 수수료 |
| rounding | effectiveRounding (카드 단독 시 0) |
| total | effectiveDue (현금 시 반올림, 카드 단독 시 정확한 금액) |
| taxAmount | GST 추출액 |
| cashPaid | 청구서에 적용된 현금 |
| cashChange | 거스름돈 |
| creditPaid | 총 카드 결제액 (수수료 제외) |
| totalDiscountAmount | 라인 + 전표 할인 합계 |
| payments | `{ type, amount, surcharge }[]` 결제 건별 |

항등식: `cashPaid + creditPaid = total`

유도 가능: `cashReceived = cashPaid + cashChange`, 카드 건별: `eftpos = amount + surcharge`

---

## 예시

장바구니: 3개 상품 합계 $47.83 (그 중 $32.00 과세 대상).

전표 할인: 5%.

```
subTotal         = $47.83
taxableRatio     = 32.00 ÷ 47.83 = 0.6690...
documentDiscount = 47.83 × 0.05 = $2.39
exactDue         = 47.83 - 2.39 = $45.44
roundedDue       = $45.45 (올림)
rounding         = +$0.01
```

고객이 카드 2건 ($15 + $10)과 나머지 현금으로 결제:

```
결제 건 1: 카드 $15.00 → 수수료 = r2(15.00 × 0.015) = $0.23 → EFTPOS $15.23
결제 건 2: 카드 $10.00 → 수수료 = r2(10.00 × 0.015) = $0.15 → EFTPOS $10.15
결제 건 3: 현금 $25.00

totalCash      = $25.00
totalCredit    = $25.00
totalSurcharge = $0.23 + $0.15 = $0.38
totalEftpos    = $25.00 + $0.38 = $25.38
```

현금이 포함되어 있으므로: `effectiveDue = roundedDue = $45.45`, `effectiveRounding = +$0.01`.

```
remaining = 45.45 - 25.00 - 25.00 = -$4.55 (거스름돈)
```

세금:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.38 × 0.6690 = $0.25
taxAmount        = (30.40 + 0.25) ÷ 11 = $2.79
```

영수증:

```
소계:              $47.83
할인 (5%):         -$2.39
반올림:            +$0.01
─────────────────────────
합계:              $45.45
Cash Total:        $45.45
  카드:            $25.00
  현금:            $25.00
  거스름돈:         $4.55
─────────────────────────
카드 수수료:        $0.38
EFTPOS 합계:       $25.38
─────────────────────────
GST 포함:           $2.79
절약 금액:          $X.XX
```
