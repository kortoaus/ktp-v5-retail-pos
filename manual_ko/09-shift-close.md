# Shift 마감

> 근무 종료, cash 세기, 정산 보고서 인쇄 방법입니다.

---

## Shift를 마감할 수 있는 사람

**shift** 권한이 있는 사용자만 shift를 마감할 수 있습니다. 이 terminal에 열린 shift가 있어야 합니다.

---

## 순서

1. Home 화면에서 **Close Shift**를 누릅니다.
2. 시스템이 현재 shift의 모든 sale, refund, cash 이동을 불러옵니다.
3. 왼쪽 패널의 **Shift Summary**를 확인합니다.
4. 권종별 그리드를 사용하여 **서랍의 cash를 세어** 입력합니다.
5. **Expected vs Actual** 차이를 확인합니다.
6. 메모 필드를 눌러 **마감 메모**를 추가합니다 (선택).
7. **Close Shift**를 누릅니다 — 버튼이 **"Tap again to confirm"**으로 변경됩니다.
8. 다시 눌러 확인합니다. Z-report 영수증이 자동으로 인쇄됩니다.

---

## Shift Summary

왼쪽 패널에 shift 중 발생한 모든 내용이 요약됩니다:

| 행 | 설명 |
|----|------|
| Started Cash | Shift 시작 시 서랍에 있던 cash |
| Sales (Cash) | Sale로 받은 cash 합계 |
| Sales (Credit) | Sale로 받은 credit card 결제 합계 |
| Sales Tax | Sale에서 징수한 GST |
| Refunds (Cash) | Refund로 돌려준 cash 합계 (음수로 표시) |
| Refunds (Credit) | Refund로 돌려준 credit 합계 (음수로 표시) |
| Refunds Tax | Refund에 포함된 GST (음수로 표시) |
| Cash In | Shift 중 서랍에 추가된 cash 합계 |
| Cash Out | Shift 중 서랍에서 제거된 cash 합계 (음수로 표시) |

---

## Expected Cash

시스템이 서랍의 예상 cash를 계산합니다:

```
Expected = Started Cash + Sales Cash − Refunds Cash + Cash In − Cash Out
```

이 값은 **편집할 수 없습니다** — shift 중 실제 거래에서 계산됩니다.

---

## 차이 (Difference)

실제 cash를 센 후:

```
Difference = Actual Cash − Expected Cash
```

| 색상 | 의미 |
|------|------|
| 초록색 | 일치 — actual이 expected와 같음 |
| 빨간색 | 부족 — actual이 expected보다 적음 |
| 파란색 | 초과 — actual이 expected보다 많음 |

---

## 이중 확인

Shift 마감은 실수 방지를 위해 **두 번 누르기**가 필요합니다:
1. 첫 번째 누르기 → 버튼 텍스트가 "Tap again to confirm"으로 변경
2. 두 번째 누르기 → shift 마감됨

---

## Z-Report

Shift가 마감되면 **정산 영수증**이 자동으로 인쇄됩니다:

- Shift ID와 요일
- Shift를 시작하고 마감한 사람
- 시작 및 마감 시간
- Sale 내역 (cash, credit, GST)
- Refund 내역 (cash, credit, GST)
- Cash in/out 합계
- 서랍 요약 (started, expected, actual, difference)
- 인쇄 시간

프린터가 실패해도 shift는 마감됩니다 — 인쇄는 best-effort입니다.

---

## 마감 후

- Shift가 영구적으로 기록되며 변경할 수 없습니다
- Home 화면에 **Open Shift**가 다시 표시됩니다
- 필요하면 즉시 새 shift를 열 수 있습니다

---

## 합계 계산 방법

Server가 마감 시점에 shift의 모든 invoice와 cash 이동을 조회합니다:

1. **Sale 합계** — type이 "sale"인 모든 invoice에서 합산 (정밀 decimal 연산 사용)
2. **Refund 합계** — type이 "refund"인 모든 invoice에서 합산
3. **Cash in/out** — 모든 cash in/out 기록에서 합산

이 float 합계는 shift 기록에 저장되기 전에 **센트**로 변환됩니다 (100을 곱하고 반올림).
