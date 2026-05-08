# 판매 영수증 ESC/POS 커맨드 모드 설계

날짜: 2026-05-08
상태: 구현 계획 작성 승인됨

## 목표

기존 canvas raster 영수증 출력 방식을 기본 fallback으로 유지하면서, 판매
영수증에 ESC/POS 커맨드 기반 출력 모드를 추가한다.

1차 구현 범위는 판매 영수증만이다.

- 결제 직후 최초 판매 영수증
- 사본/재출력 영수증
- 환불 영수증
- repay 흐름의 영수증
- 부모 invoice와 child invoice를 함께 뽑는 reprint chain

Shift settlement/Z-report 영수증은 이번 범위에서 제외하고 기존 raster 출력
경로를 유지한다.

## 범위 제외

- 아직 raster 영수증 경로를 제거하지 않는다.
- 영수증 계산, sale/refund/repay 데이터, payment invariant, cloud sync는
  변경하지 않는다.
- 별도 ESC/POS 프린터 라이브러리를 추가하지 않는다.
- 1차 구현에서는 바코드 출력을 추가하지 않는다. 현재 판매 영수증은 바코드가
  아니라 QR을 사용한다.
- 모든 프린터에서 한글 출력을 보장하는 것은 1차 목표가 아니다. 기본 ESC/POS
  모드에서는 지원하지 않는 문자를 `?`로 치환할 수 있다.

## 현재 구조

판매 영수증은 Electron renderer에서 576px canvas로 렌더링된다.

- `retail_pos_app/src/renderer/src/libs/printer/sale-invoice-receipt.ts`
- `retail_pos_app/src/renderer/src/libs/printer/escpos.ts`
- `retail_pos_app/src/renderer/src/libs/printer/print.service.ts`

renderer는 canvas를 ESC/POS raster image command로 변환한 뒤 기존
`printESCPOS()` transport로 raw bytes를 보낸다. 이 transport는 이미 아래
두 경로를 지원한다.

- serial printer: Electron IPC `escpos:print`
- network printer: local POS server `/api/printer/print`

따라서 새 기능은 transport를 새로 만들지 않고, 판매 영수증용 ESC/POS byte
builder만 추가한다.

## 설정 설계

app device config에 영수증 출력 모드와 텍스트 인코딩 설정을 추가한다.

```ts
type ReceiptPrintMode = "raster" | "escpos";
type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";

interface DeviceConfig {
  // existing fields...
  receiptPrintMode: ReceiptPrintMode;
  receiptTextEncoding: ReceiptTextEncoding;
}
```

기존 config에는 새 값이 없으므로 migration/default는 아래처럼 처리한다.

- `receiptPrintMode: "raster"`
- `receiptTextEncoding: "ascii-replace"`

Interface Settings의 ESC/POS Printer 섹션에 아래 컨트롤을 추가한다.

- Receipt Mode: Raster Image / ESC/POS Command
- Text Encoding: ASCII replace / CP949 / EUC-KR

Text Encoding은 주로 ESC/POS Command 모드에서 사용된다. 다만 나중에 한글
내장 프린터를 테스트할 때 설정 구조를 다시 바꾸지 않도록 mode selector와
같이 저장한다.

## 출력 흐름

`printSaleInvoiceReceipt()`와 `printSaleInvoiceReprint()`는 byte를 만들기
전에 app config를 읽고 mode에 따라 분기한다.

Raster mode:

```text
invoice -> renderSaleInvoiceReceipt(canvas) -> buildPrintBuffer(canvas) -> printESCPOS(bytes)
```

ESC/POS command mode:

```text
invoice -> buildSaleInvoiceEscposReceipt(invoice, options) -> printESCPOS(bytes)
```

Reprint chain은 아래처럼 처리한다.

- Raster mode는 현재 `buildMultiReceiptBuffer(canvases)` 동작을 유지한다.
- ESC/POS mode는 invoice별 receipt body를 순서대로 만들고, receipt 사이에는
  feed를 넣고, 마지막에만 cut command를 붙인다.

## ESC/POS Builder

renderer 쪽에 판매 영수증 전용 helper를 추가한다.

```text
retail_pos_app/src/renderer/src/libs/printer/sale-invoice-escpos.ts
```

builder는 아래 ESC/POS byte를 직접 만든다.

- initialize printer
- alignment
- bold on/off
- header/total 강조용 size mode
- line feed
- QR code command sequence
- final paper cut

builder는 비즈니스 로직을 소유하지 않는다. 현재 canvas 영수증이 사용하는
invoice snapshot 필드를 같은 방식으로 포맷해서 출력만 담당한다.

판매 영수증 내용은 실용적으로 가능한 선에서 기존 raster 영수증과 맞춘다.

- company/store header
- tax invoice/refund/internal header
- invoice id 또는 serial
- date, terminal, cashier, member
- item row와 영어 item name wrap
- quantity/price/line total
- subtotal, card surcharge, rounding, total
- tender summary
- GST included, saved amount, points earned
- voucher detail
- legend
- footer text
- QR payload
- copy marker
- printed timestamp

## 인코딩

기본 command-mode 인코딩은 `ascii-replace`다.

`ascii-replace`는 지원하지 않는 문자를 byte 전송 전에 `?`로 바꾼다. 이것이
이번 1차 배포 요구사항이다. 멤버 이름이 한국어인 경우 replacement character로
출력되어도 영수증 출력 자체는 막지 않는다.

`cp949`와 `euc-kr`는 이미 프로젝트에 있는 `iconv-lite` dependency를 사용해
text bytes를 인코딩한다. 이 옵션은 지금 추가해두고, 나중에 한글 내장 프린터를
테스트할 때 사용자 설정 계약을 바꾸지 않도록 한다.

QR payload는 ASCII이므로 receipt text encoding의 영향을 받지 않는다.

## 프린터 코드페이지

1차 구현에서는 기본적으로 한글 code page select command를 보내지 않는다.

이유: ESC/POS code page 번호는 프린터 모델과 firmware마다 다를 수 있다.
인코딩 선택은 지금 넣어두는 것이 유용하지만, 실제 프린터 모델이 확인되기 전
`ESC t n`을 강제로 보내면 현재 잘 동작하는 프린터를 깨뜨릴 수 있다.

builder는 나중에 필요할 때 text 출력 전에 `ESC t n`을 보낼 수 있도록 구조만
열어둔다.

## QR Code

QR은 raster QR 대신 ESC/POS native QR command를 사용한다.

- QR model 선택
- module size 설정
- error correction level 설정
- payload store
- QR symbol print

payload는 현재 receipt search flow와 동일하게 유지한다.

```text
receipt%%%${invoice.serial ?? `INV-${invoice.id}`}
```

## 에러 처리

기존 transport-level 에러 처리는 유지한다.

- ESC/POS printer config가 없으면 operator에게 alert
- serial IPC failure는 기존 serial error message 사용
- network print failure는 기존 server/fetch error message 사용

ESC/POS builder가 잘못된 입력을 받으면 `printESCPOS()` 호출 전에 일반 error를
throw한다. 호출하는 receipt 함수는 error를 log하고, 현재 UX와 맞는 짧은 print
failure alert를 보여준다.

## 검증

POS app에는 설정된 automated test runner가 없다. 구현 후 검증은 아래를
포함한다.

- `cd retail_pos_app && npm run build`
- Interface Settings 수동 확인:
  - 기존 config가 Raster Image + ASCII replace로 로드된다.
  - 저장 시 기존 ESC/POS printer 설정이 보존된다.
  - mode/encoding 변경이 앱 reload 후에도 유지된다.
- 출력 수동 확인:
  - raster 판매 영수증이 기존처럼 출력된다.
  - ESC/POS 판매 영수증이 text, total section, QR, cut을 출력한다.
  - copy/reprint에 copy marker가 찍힌다.
  - refund receipt가 refund label을 출력한다.
  - repay/reprint chain이 하나의 물리 strip으로 출력되고 마지막에만 cut된다.
  - Korean member name이 ASCII replace mode에서 replacement text로 출력된다.

## 후속 작업

- 대상 한글 내장 프린터 모델과 code page 번호가 확인되면 code page 선택을
  추가한다.
- 판매 영수증 ESC/POS 모드가 안정화되면 shift settlement/Z-report도 command
  mode로 옮길지 검토한다.
- production에서 ESC/POS command mode가 승인되면 판매 영수증 raster mode를
  제거한다.
