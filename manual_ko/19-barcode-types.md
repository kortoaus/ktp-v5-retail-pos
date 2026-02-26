# Barcode 종류

> 시스템이 다양한 barcode 형식을 읽고 해석하는 방법입니다.

---

## 지원 형식

| 유형 | 설명 | 예시 |
|------|------|------|
| **RAW** | 일반 텍스트 barcode — 직접 매칭 | `ABC123` |
| **GTIN** | Global Trade Item Number — 14자리로 정규화 | `00012345678905` |
| **PLU** | Price Look-Up code — 02로 시작하는 7자리 코드 | `0200001` |
| **UPC** | Universal Product Code — GTIN의 하위 집합 | `012345678905` |
| **EAN** | European Article Number — GTIN의 하위 집합 | `4901234567890` |

---

## Barcode 조회 방법

Barcode가 스캔되면 시스템은 다음 순서로 상품을 찾습니다:

### 1. GTIN 조회 (최우선)
Raw barcode를 14자리 GTIN으로 정규화합니다. 상품의 `barcodeGTIN`이 일치하면 반환합니다.

### 2. PLU 조회 (차순위)
Barcode가 `02` 또는 `2`로 시작하고 14자리 미만인 경우:
- 시스템이 7자리 PLU 후보를 추출합니다 (처음 7자리, 앞에 0 패딩)
- 상품의 `barcodePLU`가 일치하면 반환합니다

PLU barcode는 일반적으로 **저울 상품**에 사용됩니다 — barcode가 상품 식별과 가격/무게를 모두 인코딩합니다.

### 3. Raw Barcode 조회 (폴백)
시스템이 raw barcode가 스캔된 텍스트를 **포함**하는 상품을 검색합니다 (대소문자 무시).

---

## 내장 가격 Barcode

Prepacked 및 weight-prepacked 상품의 경우 barcode에 가격이 포함됩니다:

```
02 IIIII PPPPP C
│  │     │     └─ 체크 디지트
│  │     └─ 가격 (5자리, ÷ 100 = 달러)
│  └─ 상품 코드 (PLU)
└─ PLU 접두사
```

예시: `0200001012505`
- 상품 PLU: `0200001`
- 내장 가격: `01250` → $12.50
- 체크 디지트: `5`

시스템이 이 가격을 추출하여 줄 합계를 계산합니다 (prepacked 상품 가격은 [가격 & 할인](./06-pricing.md) 참조).

---

## Barcode 정규화

상품이 cloud에서 동기화될 때 barcode가 정규화됩니다:
- Raw barcode는 그대로 저장
- GTIN은 14자리로 정규화 (왼쪽에 0 패딩)
- Barcode가 02 접두사 패턴과 일치하면 PLU 추출

이 정규화는 동기화 시점에 발생하며, 스캔 시점이 아닙니다 — 빠른 조회를 위해서입니다.
