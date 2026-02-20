# 결제 규칙

POS가 최종 금액, 세금, 반올림, 거스름돈을 계산하는 방법.

모든 계산은 부동소수점 오류를 방지하기 위해 `decimal.js`를 사용합니다. 모든 금액은 달러 단위입니다.

---

## 계산 흐름

```
subTotal (소계)
  → documentDiscountAmount (전표 할인)
  → exactDue = subTotal - documentDiscountAmount (정확한 결제액)
  → roundedDue = exactDue를 5센트 단위로 반올림 (항상, 결제 수단 무관)
  → rounding = roundedDue - exactDue (반올림 조정)
  → creditSurchargeAmount = creditReceived × 1.5% (총액과 별도)
  → eftposAmount = creditReceived + creditSurchargeAmount (EFTPOS 청구 금액)
  → taxAmount (반올림 전 금액 기준 세금)
  → remaining = roundedDue - cashReceived - creditReceived (잔액)
```

핵심 설계: **수수료는 판매 총액과 분리됩니다.** 청구서는 `roundedDue`입니다. 수수료는 EFTPOS 기기를 통해 별도로 수금됩니다. `cashPaid + creditPaid = total`이 항상 성립합니다.

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

결제 수단과 관계없이 `exactDue`에 **항상 적용**됩니다.

| 끝자리 | 반올림 결과 |
|--------|------------|
| .01, .02 | .00 (내림) |
| .03, .04, .05 | .05 (올림/유지) |
| .06, .07 | .05 (내림) |
| .08, .09 | .10 (올림) |

```
roundedDue = exactDue를 0.05 단위로 반올림 (ROUND_HALF_UP)
rounding = roundedDue - exactDue
```

이것이 **판매 총액** — 고객에게 보여주는 청구 금액입니다.

### 6. 카드 수수료 (별도)

카드 결제 금액에 1.5% 수수료 부과.

```
creditSurchargeAmount = creditReceived × 0.015
eftposAmount = creditReceived + creditSurchargeAmount
```

수수료는 **판매 총액에 포함되지 않습니다.** EFTPOS 기기를 통해 수금됩니다. 카드 기기는 `eftposAmount`를 청구하고, 매장은 `creditReceived`를 수령하며, 수수료는 카드 처리 비용을 상쇄합니다.

결제 시 검증: 카드 금액이 `roundedDue`를 초과할 수 없음.

### 7. 세금 (GST)

모든 가격은 GST 포함가 (10% GST). 세금은 추가가 아닌 추출.

```
GST = (과세 금액) ÷ 11
```

세금은 **반올림 전** 금액 기준으로 계산:

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = creditSurchargeAmount × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

카드 수수료는 과세 상품 비율에 따라 GST가 부과됩니다.

### 8. 잔액 / 거스름돈

```
remaining = roundedDue - cashReceived - creditReceived
```

| remaining | 의미 |
|-----------|------|
| > 0 | 고객이 아직 지불해야 할 금액 |
| = 0 | 결제 완료 |
| < 0 | 거스름돈 (절대값) |

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
| 현금만 | 없음 | 항상 적용 |
| 카드만 | 1.5% (EFTPOS 경유) | 항상 적용 |
| 현금 + 카드 | 카드 부분에 1.5% (EFTPOS 경유) | 항상 적용 |

---

## 페이로드 (OnPaymentPayload)

데이터베이스에 저장되는 값:

| 필드 | 값 |
|------|-----|
| subtotal | Σ line.total |
| documentDiscountAmount | 전표 할인 금액 |
| creditSurchargeAmount | 카드 수수료 (1.5%) |
| rounding | 5센트 반올림 조정 (+/-) |
| total | roundedDue (판매 금액, 수수료 제외) |
| taxAmount | GST 추출액 |
| cashPaid | 청구서에 적용된 현금 |
| cashChange | 거스름돈 |
| creditPaid | 카드 기본 청구액 (수수료 제외) |
| totalDiscountAmount | 라인 + 전표 할인 합계 |

항등식: `cashPaid + creditPaid = total`

유도 가능: `cashReceived = cashPaid + cashChange`, `eftposAmount = creditPaid + creditSurchargeAmount`

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

고객이 $20.00 카드 + 나머지 현금으로 결제:

```
creditSurcharge  = 20.00 × 0.015 = $0.30
eftposAmount     = 20.00 + 0.30 = $20.30 (EFTPOS 청구 금액)
remaining        = 45.45 - 20.00 = $25.45 (현금 필요)
```

고객이 현금 $30 지불:

```
remaining = 45.45 - 30.00 - 20.00 = -$4.55 (거스름돈)
```

세금:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.30 × 0.6690 = $0.20
taxAmount        = (30.40 + 0.20) ÷ 11 = $2.78
```

영수증:

```
소계:              $47.83
할인 (5%):         -$2.39
반올림:            +$0.01
─────────────────────────
합계:              $45.45
  카드:            $20.00
  현금:            $30.00
  거스름돈:         $4.55
─────────────────────────
카드 수수료:        $0.30
EFTPOS 금액:       $20.30
─────────────────────────
GST 포함:           $2.78
절약 금액:          $X.XX
```
