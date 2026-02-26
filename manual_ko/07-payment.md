# Payment

> Cash 및 credit 결제 처리, surcharge, 반올림, GST 방법입니다.

---

## Payment 화면 열기

Sale 화면에서 **Pay** (오른쪽 하단)를 누릅니다. Payment Modal이 열리며:

- **왼쪽 패널** — 금액 입력용 numpad + 빠른 지폐 버튼 ($100, $50 등)
- **중앙 패널** — 모든 계산을 보여주는 결제 요약
- **오른쪽 패널** — discount, cash, credit 입력 필드

---

## 결제 흐름

### 1. Document Discount 적용 (선택)

**Discount** 필드를 누르고 할인을 입력합니다:
- **퍼센트 모드** — 예: 10%인 경우 10 입력
- **금액 모드** — 예: $5 할인인 경우 5.00 입력

할인은 subtotal을 초과할 수 없습니다.

### 2. 결제 입력

**Cash** 또는 **Credit**을 눌러 결제 대상을 선택한 다음 numpad로 금액을 입력합니다.

**단축키**: Cash 또는 Credit이 이미 선택되고 금액이 0인 상태에서 다시 누르면 — 시스템이 잔액을 자동으로 채웁니다.

**빠른 지폐**: $100, $50, $20 등을 누르면 해당 금액이 cash 필드에 추가됩니다.

### 3. 분할 결제 (선택)

분할 결제 (cash + credit)의 경우:
1. Cash 금액을 입력하고 **Add Payment**를 누릅니다
2. Credit으로 전환하여 credit 금액을 입력합니다
3. 또는 반대로

여러 결제 건을 등록할 수 있습니다. 등록된 건을 누르면 삭제할 수 있습니다.

### 4. 완료

잔액이 0이 되면 (또는 cash로 초과 지불 시) **Confirm Payment**를 누릅니다.

---

## 합계 계산 방법

```
Subtotal = 모든 줄 합계의 합
Document Discount = subtotal × 퍼센트, 또는 고정 금액
Exact Due = subtotal − document discount
```

### 5센트 반올림 (호주 규칙)

결제에 **cash가 포함**된 경우:
```
Rounded Due = exact due를 5센트 단위로 반올림
Rounding = rounded due − exact due
```

전액 credit card로 결제하는 경우 **반올림이 적용되지 않습니다**.

### Credit Card Surcharge

각 credit 결제 건에 surcharge가 있습니다:
```
Surcharge = credit 금액 × surcharge 비율 (Store Settings에서 설정)
```

기본 비율은 1.5%입니다. Surcharge는 **sale 합계와 별도** — EFTPOS 기기에서 기본 금액 위에 추가로 청구됩니다.

```
EFTPOS 합계 = credit 금액 + surcharge
```

**중요**: Sale 합계 (`cashPaid + creditPaid`)는 항상 surcharge 없이 일치합니다. Surcharge는 별도로 추적됩니다.

---

## GST 계산

호주 GST는 세금 포함가 — 가격에 이미 10% GST가 포함 (÷11).

### 상품 세금
```
과세 비율 = 과세 줄 합계의 합 ÷ subtotal
상품 세금 = exact due × 과세 비율 ÷ 11
```

### Surcharge 세금
```
Surcharge 세금 = 총 surcharge ÷ 11
```

### 총 세금
```
세금 = 상품 세금 + surcharge 세금
```

### 줄별 세금 배분

상품 세금은 **최대 잔여법**을 사용하여 과세 줄에 배분됩니다:

1. 각 과세 줄의 비례 배분 계산: `줄 합계 ÷ 과세 합계 × 상품 세금`
2. 소수점 2자리로 내림
3. 남은 센트를 소수 잔여분이 가장 큰 줄부터 하나씩 배분

이를 통해 줄별 세금의 합이 총 상품 세금과 정확히 일치합니다 — 반올림 오차 없음.

---

## 거스름돈

고객이 cash로 초과 지불한 경우:
```
Change = 총 cash 지불액 − 결제액
```

거스름돈 화면이 표시되어 돌려줄 금액을 보여줍니다. Cash가 접수되면 cash 서랍이 자동으로 열립니다.

---

## 저장되는 내용

Invoice에 기록됩니다:

| 필드 | 값 |
|------|-----|
| Subtotal | 줄 합계의 합 |
| Document Discount | 차감된 금액 |
| Credit Surcharge | 모든 credit surcharge의 합 |
| Rounding | 5센트 조정 (양수 또는 음수) |
| Total | 유효 결제액 (고객이 지불하는 금액, surcharge 제외) |
| Tax Amount | 상품 세금 + surcharge 세금 |
| Cash Paid | 청구서에 적용된 cash (받은 금액 − 거스름돈) |
| Cash Change | 돌려준 거스름돈 |
| Credit Paid | Credit 금액 (surcharge 제외) |
| Total Discount | 줄 할인 + 전표 할인 |
| Payments | 각 결제 건 (유형, 금액, surcharge) |
| Rows | 각 상품 (가격 상세 및 줄별 세금) |

### Serial Number

각 invoice는 serial number를 받습니다: `companyId-shiftId-terminalId-invoiceId`

### 영수증

결제 후 sale 영수증이 자동으로 인쇄됩니다 ([Sale 영수증](./12-receipt-sale.md) 참조). 고객이 cash를 지불한 경우 서랍이 열립니다.

---

## 검증

Server가 저장 전에 검증합니다:
- 최소 하나의 row와 하나의 payment 필요
- Row 합계가 subtotal과 대략 일치해야 함 (2센트 허용 오차)
- Payment 합계가 sale 합계와 대략 일치해야 함
- Total이 subtotal − discount + rounding과 대략 일치해야 함

검증에 실패하면 sale이 거부되고 오류 메시지가 표시됩니다.

---

## 요약

```
subtotal = Σ 줄 합계
discount = subtotal × 퍼센트 또는 고정 금액
exact due = subtotal − discount
rounded due = 5센트 단위 반올림 (cash인 경우)
effective due = cash 있음? rounded due : exact due
surcharge = Σ (credit 금액 × 비율) (credit 건별)
change = max(0, 총 cash − effective due)
cash paid = min(총 cash, effective due − 총 credit)
tax = (exact due × 과세 비율 ÷ 11) + (surcharge ÷ 11)
```
