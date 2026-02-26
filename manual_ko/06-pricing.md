# 가격 & 할인

> 상품 가격 결정 방식 — member 가격, promo 가격, override 포함.

---

## 가격 구조

각 상품은 다음을 가질 수 있습니다:

| 가격 유형 | 출처 | 설명 |
|-----------|------|------|
| **기본 가격** | Price 테이블, 레벨 0 | 표준 소매가 |
| **레벨 가격** | Price 테이블, 레벨 1+ | Member 레벨별 가격 (예: 레벨 1 = 도매가) |
| **Promo 가격** | PromoPrice 테이블 | 유효 기간이 있는 프로모션 가격 |

### 가격 저장 방식

가격은 **member 레벨별 인덱스 배열**로 저장됩니다:

```
prices[0] = 기본 가격 (모든 사람)
prices[1] = 레벨 1 가격
prices[2] = 레벨 2 가격
...
```

일반 가격과 promo 가격 모두 같은 배열 구조를 사용합니다.

---

## 가격 결정

상품이 cart에 추가될 때 시스템은 세 가지 가격을 결정합니다:

### 1. 원가 (항상 기준으로 사용)
```
unit_price_original = prices[0]
```
Member 레벨에 관계없이 항상 표준 소매가입니다.

### 2. 할인가 (member가 연결된 경우)
시스템이 확인하는 것:
- 일반 가격 테이블의 `prices[memberLevel]`
- Promo 가격 테이블의 `promoPrice.prices[memberLevel]` (유효 기간 내인 경우)

이 둘 중 **가장 낮은** 가격을 선택하되, **원가보다 낮은 경우에만** 적용합니다. 둘 다 낮지 않으면 할인이 없습니다.

### 3. 유효 가격 (고객이 실제 지불하는 가격)
```
effective = adjusted price ?? discounted price ?? original price
```

우선순위:
1. **Adjusted price** — 직원이 수동으로 override한 가격 (최우선)
2. **Discounted price** — member 레벨 또는 promo에서
3. **Original price** — 기본 소매가 (폴백)

---

## 줄 합계 계산

```
줄 합계 = 유효 단가 × 수량
```

소수점 2자리로 반올림됩니다.

### 세금 (GST)

호주 GST는 **포함가** — 가격에 이미 세금이 포함되어 있습니다.

```
세금 = 합계 ÷ 11
```

**taxable**로 표시된 상품에만 계산됩니다. 비과세 상품은 세금이 0입니다.

```
subtotal = 합계 − 세금
```

---

## Prepacked 상품 가격

Barcode에 가격이 내장된 상품의 경우:

| 상황 | 원가 | 수량 |
|------|------|------|
| 일반 prepacked (시스템 가격 있음) | 시스템 가격 (prices[0]) | barcodePrice ÷ 시스템 가격 |
| 공급자 prepacked (시스템 가격 없음) | Barcode 가격 | 1 |

이는 prepacked 상품이 barcode의 실제 중량/금액을 나타내기 위해 소수 수량을 사용한다는 의미입니다.

---

## Member 레벨 변경

Member를 연결하거나 해제할 때:
- **현재 cart의 모든 줄**이 새 member 레벨로 재계산됩니다
- 각 줄이 member 레벨에 따른 새 할인가를 받습니다
- 수동 price override가 있는 줄은 **영향받지 않습니다** — override가 우선합니다
- 공급자 prepacked 상품 (시스템 가격 없음)은 **영향받지 않습니다**

---

## Price Override

직원이 줄의 가격을 override할 수 있습니다:

1. 줄을 눌러 선택합니다
2. **Override Price**를 누릅니다
3. 새 가격을 입력합니다
4. 줄의 adjustments에 "PRICE_OVERRIDE"가 표시됩니다

Override를 제거하려면:
- 줄을 누르고 **Clear Override Price**를 누릅니다
- 줄이 계산된 가격 (할인가 또는 원가)으로 복원됩니다

---

## 전표 할인 (Document Discount)

Payment 시점에 전체 sale에 할인을 적용할 수 있습니다:

| 방법 | 설명 |
|------|------|
| **퍼센트** | 예: subtotal의 10% 할인 |
| **고정 금액** | 예: $5.00 할인 |

이는 줄 합계가 계산된 후, 반올림과 결제 전에 적용됩니다.

이것이 최종 금액에 어떻게 영향을 미치는지는 [Payment](./07-payment.md)를 참조하세요.

---

## 요약

```
각 줄:
  원가 = prices[0]
  할인가 = min(prices[level], promoPrice[level]) (원가보다 낮은 경우만)
  유효 가격 = override ?? 할인가 ?? 원가
  합계 = 유효 가격 × 수량 (2자리 반올림)
  세금 = 합계 ÷ 11 (taxable인 경우)
  subtotal = 합계 − 세금

전체 sale:
  subtotal = Σ 줄 합계
  전표 할인 = subtotal × 퍼센트 또는 고정 금액
  결제액 = subtotal − 전표 할인
```
