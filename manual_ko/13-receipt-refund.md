# Refund 영수증

> Refund 영수증을 이해하는 방법입니다.

---

## Sale 영수증과의 차이점

Refund 영수증은 sale 영수증과 유사하지만 주요 차이점이 있습니다:

| 차이점 | 상세 |
|--------|------|
| 배너 | 헤더 아래에 "*** REFUND ***"가 눈에 띄게 인쇄됩니다 |
| ABN 줄 | "TAX INVOICE" 접두사 없이 "ABN xxxxxxx"만 표시 |
| 원본 invoice | 원본 sale의 serial number가 표시됩니다 |
| Surcharge 없음 | Refund에는 credit card surcharge 섹션이 없습니다 |
| Discount 없음 | 전표 할인 섹션이 없습니다 |
| 결제 라벨 | "Cash Paid" / "Credit Paid" 대신 "Cash Refunded" / "Credit Refunded" |
| Footer 문구 | 사용자 정의 문구 대신 "Refund processed" |

---

## 영수증 구성

### 헤더
Sale 영수증과 동일 — 매장명, 주소, ABN, 전화번호, website.

### Refund 배너
```
*** REFUND ***
```

### 메타
| 줄 | 내용 |
|----|------|
| Refund Invoice | 이 refund의 serial number |
| Original Invoice | 원본 sale의 serial number |
| Date | Refund 날짜와 시간 |
| Terminal | Terminal 이름 |

### 상품
각 refund된 상품의 수량과 합계.

### 합계
| 줄 | 내용 |
|----|------|
| ITEMS | 수량 + subtotal |
| Rounding | 5센트 조정 (있는 경우) |
| **REFUND TOTAL** | Refund 금액 |

### 결제
| 줄 | 내용 |
|----|------|
| Cash Refunded | 고객에게 돌려준 cash |
| Credit Refunded | 카드로 환불된 금액 |

### 하단
| 줄 | 내용 |
|----|------|
| GST Included | Refund에 포함된 세금 |
| "Refund processed" | 고정 footer 문구 |
| QR code | Refund serial number를 인코딩 |
| 인쇄 시간 | 인쇄된 시간 |
