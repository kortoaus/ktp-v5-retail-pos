# Invoice Search

> 과거 sale 및 refund 검색, 상세 조회, 영수증 재인쇄 방법입니다.

---

## 접근 방법

Home 화면에서 **Invoice Search**를 누릅니다. 언제든지 사용 가능합니다 — shift가 열려 있지 않아도 됩니다.

---

## 검색

### 필터

| 필터 | 설명 |
|------|------|
| **Keyword** | Serial number, 회사명, 상품명 (영어/한국어), barcode 검색 |
| **날짜 범위** | 기본값은 최근 1년. 캘린더 선택기로 사용자 지정 범위 설정 가능 (Today, This Week, This Month, This Year 프리셋) |
| **Member** | 특정 member로 필터링 |

**Search** 버튼을 눌러 적용합니다. Serial number 형식 (예: `1-5-2-123`)과 일치하는 barcode를 스캔하면 자동 검색됩니다.

### 결과

왼쪽 패널에 일치하는 invoice가 표시됩니다:
- 유형 배지 (sale 또는 refund)
- Serial number
- 날짜와 시간
- 합계 금액

위/아래 버튼으로 페이지를 이동합니다 — 스크롤 없음.

---

## Invoice 조회

목록에서 invoice를 누릅니다. 오른쪽 패널에 QR 코드를 포함하여 인쇄될 그대로의 영수증 미리보기가 표시됩니다.

---

## 재인쇄

선택한 invoice의 영수증을 인쇄하려면 **Reprint**를 누릅니다.

연결된 refund가 있는 sale invoice의 경우:
- 시스템이 원본 sale과 모든 refund invoice를 조회합니다
- 순서대로 모두 인쇄합니다 (sale 영수증 먼저, 각 refund 영수증 순서대로)
- 연속 인쇄를 사용합니다 (영수증 사이 용지 절단 없이, 마지막에 한 번 절단)

---

## 검색 규칙

- Keyword는 공백으로 분리됩니다 — 모든 단어가 일치해야 합니다 (AND 논리)
- 각 단어는 serial number, 회사명, 상품명 (영/한), barcode에서 검색됩니다
- 날짜 범위는 `from` (당일 시작)과 `to` (당일 종료)를 epoch 숫자로 사용합니다
- 결과는 날짜순 정렬 (최신순)
- 페이지당 10건으로 페이지네이션됩니다
