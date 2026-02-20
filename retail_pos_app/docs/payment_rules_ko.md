# 결제 규칙

Retail POS가 최종 금액, 세금, 반올림, 거스름돈을 계산하는 방법.

모든 계산은 부동소수점 오류를 방지하기 위해 `decimal.js`를 사용합니다. 모든 금액은 달러 단위입니다.

---

## 계산 흐름

```
subTotal (소계)
  → documentDiscountAmount (전표 할인)
  → exactDue = subTotal - documentDiscountAmount (정확한 결제액)
  → creditSurchargeAmount = creditReceived × 1.5% (카드 수수료)
  → totalDue = exactDue + creditSurchargeAmount (총 결제액)
  → roundedTotalDue = 5센트 단위 반올림 (현금 결제 시에만)
  → taxAmount (반올림 전 금액 기준 세금)
  → remaining = roundedTotalDue - cashReceived - creditReceived (잔액)
```

---

## 단계별 설명

### 1. 소계 (Subtotal)

모든 라인의 합계 (유효 단가 × 수량).

```
subTotal = Σ line.total
```

### 2. 과세 비율 (Taxable Ratio)

소계 중 과세 대상 비율. 세금 계산 시 상품과 수수료에 분배하기 위해 사용.

```
taxableRatio = (Σ 과세 라인 합계) ÷ subTotal
```

소계가 0이면 과세 비율도 0 (0으로 나누기 방지).

### 3. 전표 할인 (Document Discount)

라인별 가격 적용 이후 전체 전표에 적용되는 할인. 두 가지 방식:

| 방식   | 계산                      |
| ------ | ------------------------- |
| 퍼센트 | subTotal × (퍼센트 ÷ 100) |
| 정액   | 고정 달러 금액            |

**소계를 초과할 수 없음** — 할인이 소계를 넘을 수 없으며, 결제액이 음수가 될 수 없습니다.

### 4. 정확한 결제액 (Exact Due)

수수료와 반올림 적용 전 고객이 지불해야 할 금액.

```
exactDue = subTotal - documentDiscountAmount
```

### 5. 카드 수수료 (Credit Card Surcharge)

카드 결제 금액에 1.5% 수수료 부과.

```
creditSurchargeAmount = creditReceived × 0.015
```

수수료는 총 결제액이 아닌, 실제 카드 결제 금액 기준. 예: $100 청구서에서 $50을 카드로 결제하면 수수료는 $50에 대해 계산.

### 6. 총 결제액 (Total Due)

```
totalDue = exactDue + creditSurchargeAmount
```

### 7. 현금 반올림 (호주 5센트 규칙)

호주는 1센트, 2센트 동전을 폐지했습니다. 현금 거래는 스웨덴식 반올림(반올림)으로 5센트 단위 반올림.

| 끝자리        | 반올림 결과     |
| ------------- | --------------- |
| .01, .02      | .00 (내림)      |
| .03, .04, .05 | .05 (올림/유지) |
| .06, .07      | .05 (내림)      |
| .08, .09      | .10 (올림)      |

**현금 결제가 포함된 경우에만 반올림 적용.** 전액 카드 결제는 반올림하지 않음.

```
if cashReceived > 0:
  roundedTotalDue = totalDue를 0.05 단위로 반올림 (ROUND_HALF_UP)
else:
  roundedTotalDue = totalDue
```

반올림 조정액은 영수증에 별도 표시:

```
cashRounding = roundedTotalDue - totalDue
```

양수(올림) 또는 음수(내림)가 될 수 있으며, 영수증에 한 줄로 표시.

### 8. 세금 (GST)

모든 가격은 GST 포함가 (10% GST). 세금은 추가가 아닌 추출.

```
GST = (과세 금액) ÷ 11
```

세금은 **반올림 전** 금액 기준으로 계산 (반올림이 세금 수치에 영향을 주지 않도록):

```
taxableGoods = exactDue × taxableRatio
taxableSurcharge = creditSurchargeAmount × taxableRatio
taxAmount = (taxableGoods + taxableSurcharge) ÷ 11
```

카드 수수료는 과세 상품 비율에 따라 GST가 부과됩니다.

### 9. 잔액 / 거스름돈

```
remaining = roundedTotalDue - cashReceived - creditReceived
```

| remaining | 의미                         |
| --------- | ---------------------------- |
| > 0       | 고객이 아직 지불해야 할 금액 |
| = 0       | 결제 완료                    |
| < 0       | 거스름돈 (절대값)            |

---

## 총 할인 (영수증 요약)

영수증의 "절약 금액" 항목을 위해, 라인별 할인과 전표별 할인을 합산:

```
originalSubTotal = Σ (line.unit_price_original × line.qty)
totalDiscountAmount = (originalSubTotal - subTotal) + documentDiscountAmount
```

- `originalSubTotal - subTotal` = 모든 라인별 절약 (가격 수정, 프로모 가격, 라인 할인)
- `+ documentDiscountAmount` = 전표 할인

---

## 결제 수단

| 수단        | 수수료           | 반올림              |
| ----------- | ---------------- | ------------------- |
| 현금만      | 없음             | 5센트 반올림 적용   |
| 카드만      | 1.5%             | 반올림 없음         |
| 현금 + 카드 | 카드 부분에 1.5% | 총액에 5센트 반올림 |

---

## 예시

장바구니: 3개 상품 합계 $47.83 (그 중 $32.00 과세 대상).

전표 할인: 5% → $2.39.

```
subTotal         = $47.83
taxableRatio     = 32.00 ÷ 47.83 = 0.6690...
documentDiscount = 47.83 × 0.05 = $2.39
exactDue         = 47.83 - 2.39 = $45.44
```

고객이 $20.00 카드 + 나머지 현금으로 결제:

```
creditSurcharge  = 20.00 × 0.015 = $0.30
totalDue         = 45.44 + 0.30 = $45.74
roundedTotalDue  = $45.75 (5센트 단위 올림)
cashRounding     = 45.75 - 45.74 = +$0.01
```

세금:

```
taxableGoods     = 45.44 × 0.6690 = $30.40
taxableSurcharge = 0.30 × 0.6690 = $0.20
taxAmount        = (30.40 + 0.20) ÷ 11 = $2.78
```

고객이 현금 $30 지불:

```
remaining = 45.75 - 30.00 - 20.00 = -$4.25 (거스름돈)
```

영수증 표시:

```
소계:              $47.83
할인 (5%):         -$2.39
카드 수수료:        $0.30
현금 반올림:       +$0.01
─────────────────────────
합계:              $45.75
  카드:            $20.00
  현금:            $30.00
  거스름돈:         $4.25
─────────────────────────
GST 포함:           $2.78
절약 금액:          $X.XX
```
