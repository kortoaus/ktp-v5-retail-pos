# Refund

> Invoice 찾기, 상품 선택, 반품 처리 방법입니다.

---

## 필요 조건

- Shift가 열려 있어야 합니다
- **refund** 권한이 필요합니다

---

## 전체 순서

1. 원본 sale invoice 검색
2. Refund할 상품 선택 (전체 또는 부분)
3. Refund 요약 확인
4. Refund 결제 처리

---

## 1단계: Invoice 찾기

1. Home 화면에서 **Refund**를 누릅니다.
2. **Search Invoice**를 누릅니다.
3. Serial number, 상품명 또는 barcode로 검색합니다.
4. Invoice를 선택합니다 — **sale** 유형의 invoice만 refund할 수 있습니다.

시스템이 해당 invoice의 모든 상품을 불러오고 아직 refund 가능한 수량을 계산합니다 (이전 부분 refund 고려).

---

## 2단계: 상품 선택

화면에 세 개의 패널이 표시됩니다:

| 패널 | 설명 |
|------|------|
| **Invoice Lines** (왼쪽) | 원본 상품과 남은 refund 가능 수량 |
| **Refunded Lines** (가운데) | 이번 refund에 선택한 상품 |
| **Summary** (오른쪽) | 누적 합계와 refund 버튼 |

### Refund에 상품 추가

왼쪽 패널에서 상품을 누릅니다:

| 상황 | 동작 |
|------|------|
| Weight-prepacked 상품 | 자동 추가 (전량 또는 불가) |
| 수량 = 1 | 자동 추가 (하나만 refund 가능) |
| 남은 수량 = 1 | 자동 추가 (하나만 남음) |
| 남은 수량 = 0 | 차단 — 이미 전량 refund됨 |
| 수량 > 1이고 남은 수량 > 1 | 수량 입력 모달 표시 — refund할 수량 입력 |

### 부분 수량 Refund

수량을 입력할 때:
- 남은 수량을 초과할 수 없습니다
- Refund 금액은 비례적으로 계산됩니다: `refund 합계 = (수량 ÷ 원본 수량) × 원본 합계`
- 세금도 비례적으로 배분됩니다

### Refund에서 상품 제거

가운데 패널 (Refunded Lines)에서 상품을 눌러 제거합니다. 확인 대화상자가 표시됩니다.

---

## 3단계: Refund 결제

Summary 패널에서 **Refund**를 누릅니다. Refund Payment Modal이 열립니다.

### 결제 한도

Refund 결제는 원본 결제 방식에 의해 **한도가 제한**됩니다:

```
최대 cash refund = 원본 cash 결제액 − 이미 refund된 cash
최대 credit refund = 원본 credit 결제액 − 이미 refund된 credit
```

예를 들어 원본 sale이 $50 cash + $30 credit이고 이미 $20 cash가 refund되었다면, 남은 cash 한도는 $30입니다.

### Surcharge 없음

Refund에는 credit card surcharge가 **적용되지 않습니다**.

### 반올림

Refund 합계에 5센트 반올림이 적용됩니다 (sale과 같은 규칙).

---

## 저장되는 내용

Refund는 다음을 포함하는 새 invoice를 생성합니다:
- Type = **"refund"**
- `original_invoice_id`를 통해 원본 invoice에 연결
- 각 refund된 row가 원본 row에 연결
- Store settings의 매장 정보 (sale과 동일)
- Sale과 같은 형식의 serial number

---

## Server 검증

Server가 모든 refund를 트랜잭션에서 검증합니다:

1. **원본 invoice 존재** 여부 및 "sale" 유형 확인
2. **Row별 수량 확인** — refund 수량 ≤ 남은 수량 (원본 − 이미 refund됨)
3. **Cash 결제 한도** — cash refund ≤ 남은 cash (원본 cash − 이미 refund된 cash)
4. **Credit 결제 한도** — credit refund ≤ 남은 credit

검사에 실패하면 전체 refund가 거부됩니다.

---

## Refund 후

- Refund 영수증이 자동으로 인쇄됩니다 ([Refund 영수증](./13-receipt-refund.md) 참조)
- 원본 invoice의 남은 수량에서 refund된 수량이 차감됩니다
- 같은 invoice에 대한 이후 refund 시도 시 업데이트된 남은 수량이 표시됩니다
- Refund는 현재 shift와 terminal에 연결됩니다

---

## 복수 부분 Refund

하나의 invoice를 여러 번 refund할 수 있습니다:
- 각 refund가 남은 수량을 줄입니다
- 모든 상품이 전량 refund되면 더 이상 refund가 불가능합니다
- 각 부분 refund는 자체 invoice와 serial number를 받습니다
