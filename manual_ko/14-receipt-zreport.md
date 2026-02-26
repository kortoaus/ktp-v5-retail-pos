# Z-Report (Shift 정산 영수증)

> Shift 마감 시 인쇄되는 정산 영수증을 이해하는 방법입니다.

---

## 인쇄 시점

Z-report는 shift 마감 시 자동으로 인쇄됩니다. 프린터가 실패해도 shift는 마감됩니다 — 인쇄는 best-effort입니다.

---

## 영수증 구성

### 헤더
```
SHIFT SETTLEMENT
Z-REPORT
```

### 메타

| 줄 | 내용 |
|----|------|
| Shift ID | Shift의 데이터베이스 ID |
| Day | 요일 (예: Mon, Tue) |
| Opened By | Shift를 시작한 사용자 |
| Opened At | Shift 시작 날짜와 시간 |
| Closed By | Shift를 마감한 사용자 |
| Closed At | Shift 마감 날짜와 시간 |

### Sales

| 줄 | 내용 |
|----|------|
| Cash | Sale로 받은 cash 합계 |
| Credit | Sale로 받은 credit card 결제 합계 |
| GST | Sale에서 징수한 세금 |

### Refunds

| 줄 | 내용 |
|----|------|
| Cash | Refund로 돌려준 cash 합계 |
| Credit | Refund로 돌려준 credit 합계 |
| GST | Refund에 포함된 세금 |

### Cash In / Out

| 줄 | 내용 |
|----|------|
| Cash In | 서랍에 추가된 cash 합계 |
| Cash Out | 서랍에서 제거된 cash 합계 |

### Cash Drawer

| 줄 | 내용 |
|----|------|
| Started | Shift 시작 시 센 cash |
| Expected | 계산값: started + sales cash − refunds cash + cash in − cash out |
| Actual | Shift 마감 시 센 cash |
| **Difference** | Actual − Expected |

### 하단
| 줄 | 내용 |
|----|------|
| 인쇄 시간 | Z-report가 인쇄된 시간 |

---

## 모든 금액

Z-report의 모든 금액은 **달러**로 표시됩니다 (shift의 센트 값을 100으로 나눈 값).
