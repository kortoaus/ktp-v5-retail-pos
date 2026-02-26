# Sale 진행

> 상품 스캔, cart 관리, 결제 준비 방법입니다.

---

## 필요 조건

- Shift가 열려 있어야 합니다 ([Shift 시작](./04-shift-open.md) 참조)
- Home 화면에서 **Sale**을 누릅니다

---

## 화면 구성

| 영역 | 위치 | 용도 |
|------|------|------|
| 상단 바 | 상단 | Back, Search Item, Member, Invoices, Cash I/O, Sync, Cart Switcher |
| Line viewer | 왼쪽 | 현재 cart의 상품 표시 |
| Line paging | 중앙(좁음) | 위/아래 버튼으로 줄 이동 (터치 버튼, 스크롤 없음) |
| Function panel / Hotkeys | 오른쪽 | 줄 선택 시 상품 작업, 또는 빠른 접근 hotkey 그리드 |
| Document monitor | 오른쪽 하단 | 누적 합계 표시 |
| Clear Cart / Pay | 오른쪽 하단 | Cart 비우기 또는 결제 진행 |

---

## 상품 추가

### Barcode 스캔

Barcode를 스캔하기만 하면 됩니다. 시스템이:
1. GTIN, PLU, raw barcode 순서로 상품을 조회합니다
2. 상품 유형을 결정합니다 (아래 참조)
3. Cart에 추가합니다

### 상품 검색

1. 상단 바에서 **Search Item**을 누릅니다.
2. 이름, barcode 또는 코드를 입력합니다.
3. 상품을 눌러 추가합니다.

### Hotkey 사용

줄이 선택되지 않은 상태에서 오른쪽 패널에 **Hotkey 그리드**가 표시됩니다 — 자주 판매하는 상품에 대한 사전 설정 버튼입니다. 상품을 눌러 추가합니다.

---

## 상품 유형

| 유형 | 조건 | 동작 |
|------|------|------|
| **Normal** | 일반 상품 | 수량 1로 추가. 다시 스캔하면 수량 증가. |
| **Prepacked** | 고정 중량 상품 (barcode에 가격 포함) | Barcode에서 가격 추출. 수량 = barcodePrice ÷ 단가. |
| **Weight-Prepacked** | 중량 상품을 02/2로 시작하는 EAN-13 barcode로 스캔 | Barcode에서 가격 추출. 수량 = 1. 이름에 "(Prepacked)" 표시. |
| **Weight** | 고정 중량 없는 저울 상품 | 무게 모달 표시 — 저울에서 무게를 읽거나 수동 입력. |

### 병합

이미 cart에 있는 **normal** 상품을 동일 가격으로 스캔하면 시스템이 **병합**합니다 — 새 줄을 만들지 않고 기존 줄의 수량이 1 증가합니다.

병합은 다음 조건에서만 발생합니다:
- 상품 유형이 "normal"
- 같은 상품 ID
- 기존 줄에 price override 없음
- 같은 원가와 할인가

---

## 4-Cart 시스템

Terminal은 **4개의 독립적인 cart**를 지원합니다. 오른쪽 상단의 **Cart Switcher**를 사용하여 전환합니다.

각 cart는:
- 자체 상품/줄을 가집니다
- 자체 member를 가집니다 (설정된 경우)

이를 통해 한 고객의 거래를 중단하고 다른 고객을 서비스할 수 있습니다.

---

## Member

**Search Member**를 눌러 현재 cart에 member를 연결합니다. Member는 레벨 기반 가격을 받을 수 있습니다 ([가격 & 할인](./06-pricing.md) 참조).

- Member 배지에 이름과 레벨이 표시됩니다
- Member 배지를 다시 누르면 member가 **해제**됩니다
- 각 cart는 자체 member를 가집니다 — cart를 전환해도 다른 cart의 member에 영향을 주지 않습니다

---

## 줄 작업

Cart에서 줄을 눌러 선택합니다. 오른쪽 패널이 **Function Panel**로 변경됩니다:

| 작업 | 설명 |
|------|------|
| **-1 / +1** | 수량 1 감소 또는 증가 |
| **Change Qty** | 특정 수량 입력 |
| **Discount $** | 이 줄에 고정 금액 할인 적용 |
| **Discount %** | 이 줄에 퍼센트 할인 적용 |
| **Override Price** | 이 줄에 사용자 지정 가격 설정 |
| **Clear Override Price** | Price override 제거 (override된 경우에만 표시) |
| **Remove** | Cart에서 이 줄 삭제 |
| **Close** | 줄 선택 해제, hotkey 그리드로 복귀 |

**수량 변경**은 **normal** 및 **prepacked** 상품에만 허용됩니다. Weight 상품은 수량을 변경할 수 없습니다.

---

## Clear Cart

오른쪽 하단의 빨간색 **Clear Cart** 버튼은 현재 cart의 모든 상품과 member를 제거합니다. 확인 대화상자가 먼저 표시됩니다.

---

## Pay

파란색 **Pay** 버튼을 누르면 Payment Modal이 열립니다 ([Payment](./07-payment.md) 참조). Cart가 비어 있으면 비활성화됩니다.

성공적인 결제 후:
- Server에 invoice가 생성됩니다
- 영수증이 인쇄됩니다
- Cart가 자동으로 비워집니다
