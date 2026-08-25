# S3-b — 세일스크린 온라인 주문 검색 + 로드 정책 개정 (2026-08-26)

정본: BACKLOG §AC-9(S3) 후속. 선행: S3 `2026-08-21-pos-order-load-collect-design.md`
(QR 스캔·뷰어 로드, collect 훅). 변경 범위: crm-server / retail_pos_app.
retail_pos_server 는 쿼리스트링 통과라 **무변경**.

배경(오너 2026-08-26): ① 직원이 주문을 열어보는 행위가 상태를 바꾸면
안 된다 — **로드는 순수 읽기**, 유일한 전이는 결제 완료 시 COLLECTED.
② 어르신 손님은 QR·앱을 못 쓰므로 멤버 검색처럼 **온라인 주문 검색
모달**이 세일스크린에 필요. ③ 끝자리 검색은 영업일이 쌓일수록 페이지가
폭발 — 멤버 검색의 exact-phone 게이트와 같은 **앞단 게이트** 필수.

## 1. 로드 정책 (`retail_pos_app/src/renderer/src/hooks/useOrderLoad.ts`)

| 상태 | 동작 | 문구 |
|---|---|---|
| PLACED | `confirm` 후 로드, 라인 qty = 주문 qty | "This order hasn't been accepted yet. Load it anyway with the ordered quantities?" |
| ACCEPTED | `confirm` 후 로드, 주문 qty | "This order hasn't been picked yet. Load it with the ordered quantities?" |
| READY | 즉시 로드, qty = `pickedQty`(0·null 라인 제외). 전 라인 `pickedQty == null` 이면 `confirm` 후 주문 qty | "Picking wasn't recorded for this order. Load it with the ordered quantities?" |
| COLLECTED | 차단 | "This order has already been paid and collected." |
| CANCELLED / REJECTED / EXPIRED | 차단 | "This online order can't be loaded — it's been cancelled." |
| `paymentStatus === PAID` | 차단(기존) | "This order was already paid online." |
| DELIVERY | 차단(기존) | "Delivery orders can't be loaded at the till." |

- 기존 한국어 병기 문구 제거. 나머지 가드(빈 카트, 중복 로드, 로컬 아이템
  부재, 멤버 교체 차단, 스냅샷 가격·taxable) 전부 유지.
- **로드는 crm 에 어떤 쓰기도 하지 않는다.** OrderViewer "Load to Sale"
  버튼 노출 조건도 `PLACED | ACCEPTED | READY` ∧ C&C 로 맞춘다.

## 2. crm `POST /device/order/:id/collect` 가드 확장

`status IN (ACCEPTED, READY)` → **`IN (PLACED, ACCEPTED, READY)`**. 결제
완료 = COLLECTED + PAID + posInvoiceSerial (기존). 이벤트 `COLLECTED` 의
note 에 이전 상태를 남긴다(예: `serial=…; from=PLACED`) — 접수 없이 수령된
주문을 감사 이력에서 구분. 멱등(동일 serial 200)·409 규칙 기존 그대로.

## 3. crm `GET /device/order` — `keyword` 파라미터

- `keyword` 가 있으면 `preset` 은 **무시**하고 `status IN (PLACED, ACCEPTED,
  READY)` 를 서버가 고정한다(종결 제외는 클라이언트가 못 넓힘).
  `fulfillment` 필터는 그대로 AND.
- 해석 순서(공백 trim 후):
  1. `/^\d{6}-\d+$/` → `orderNo` 정확 일치. (전화 게이트가 하이픈을 벗기므로
     반드시 전화보다 먼저 판정)
  2. 포맷 문자 제거 후 숫자만이고 `sanitizePhone` 이 완전한 번호를 반환 →
     `hashPhone` 으로 `Member`(companyId, archived:false) 1명 조회 →
     `memberId` 필터. 멤버 없으면 **빈 결과**(폴백 없음).
  3. 숫자만인데 완전한 번호가 아님 → `ok:false`,
     msg `"Enter the full phone number, order number or customer name"`.
  4. 문자 포함, 길이 ≥ 2 → `memberName contains` (insensitive).
  5. 길이 1 → 3 과 같은 거부.
- 정렬 `placedAt desc`, 페이징 기존 `page/limit`, 응답 DTO 기존 리스트
  summary 그대로(status·orderNo·memberName·memberPhoneLast3·total 포함 확인).
- 해석 로직은 순수 함수(`buildDeviceOrderKeywordFilter` 계열)로 분리해
  단위 테스트.

## 4. POS `OrderSearchModal` (`retail_pos_app/src/renderer/src/components/orders/OrderSearchModal.tsx`)

- **진입**: SaleScreen 상단바 `TopBarButton` "Online Order" (Member 버튼
  옆). 활성 카트가 이미 주문 연결(`externalOrderId`)이면 비활성.
- **틀**: `MemberSearchModal` 과 동일 관례 — 고정 backdrop, 좌 결과·우
  `OnScreenKeyboard`(initialLayout english, `onEnter`=검색), 모든 조작
  `onPointerDown`, 물리 키보드 미사용(스캐너 Enter 트랩 회피).
- **열면 즉시** `GET /api/order?preset=active&fulfillment=CLICK_AND_COLLECT&page=1&limit=5`
  목록. 키워드 검색 시 `keyword=…` 추가(preset 은 보내도 서버가 무시).
  서버 `ok:false` 는 `msg` 를 그대로 안내문으로 표시.
- **행(5슬롯 고정, 페이징 Prev/n·total/Next)**:
  `StatusBadge | orderNo | memberName | ***{memberPhoneLast3} | $total`.
  기존 `StatusBadge` 재사용, 금액은 기존 cents 포맷터.
- **선택**: 모달 닫고 `loadOrder(id)` — 확인 다이얼로그·가드는 §1 훅이
  그대로 담당. 로드 실패 시 모달은 닫힌 상태 유지(알럿이 이미 뜸).
- 서비스: `service/order.service.ts` `getOrders(qs)` 재사용(파라미터
  `keyword` 추가만).

## 5. 테스트

- crm: keyword 해석 5분기(주문번호·완전 전화 hit/miss·불완전 숫자 거부·
  이름 2자·1자 거부) + keyword 시 종결 상태 제외 강제 + collect PLACED 전이
  + 이벤트 note from 기록. 기존 스위트(703)에 TDD 로 추가, 전체 그린.
- POS 앱: `useOrderLoad` 상태 분기(PLACED confirm OK/취소, 종결 차단 문구,
  READY pickedQty) 단위 테스트; 모달은 `tsc` + dev 수동(기존 3건 tsc 에러는
  무관 — 늘리지 말 것).

## 6. 비고

- 검색 모달은 MemberSearchModal·SearchItemModal 에 이은 세 번째 복붙 형제.
  공통 추출은 클린업 패스 후보(BACKLOG 기록만).
- 8/24 pos-retail v1.7.3 에 S3 코드가 crm·api 보다 먼저 매장 릴리스됨
  (한글 ZPL 폰트 기능 실기기 테스트 목적). 온라인 주문 라인이 소비자
  미공개라 실해 없음 — 오너가 8/26 밤 crm→api 배포로 정상화 예정.
