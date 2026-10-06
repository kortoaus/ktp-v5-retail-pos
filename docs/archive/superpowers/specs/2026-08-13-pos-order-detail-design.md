# POS 주문 수신함 슬라이스 B — 디테일 + 전이 + 고객 푸시 (2026-08-13)

슬라이스 A(수신함, `2026-08-10-pos-order-inbox-design.md`) 후속. 정본 결정:
`ktpv5-api-docs/BACKLOG.md` §X-14 (A), §X-13 (전이 = 현장 전용), §X-1 (상태 모델).

## 범위 (오너 확정)

- POS 디테일 화면(Viewer) + 전이(접수/준비완료/거절) + 전이 시 고객 Expo 푸시.
- **제작 상품 구분(오너)**: 라인에 **선택된 옵션이 1개라도 있으면 제작
  (Made to Order), 없으면 단순 피킹(Picking)** — 주문 시점 스냅샷 기준, 불변.
  슬라이스 C 인쇄 2종(작업지시서 ZPL vs 피킹 리스트 ESC/POS)의 대상 집합과 1:1.
- **범위 외(기록)**: COLLECTED 전이 + Sale Screen 로드 + `SaleInvoice.
  externalOrderId`(= 슬라이스 E, 결제 성공 훅 전용 — §X-4), dmarket-app 푸시
  딥링크 소비, Operations 앱 전이, 인쇄(슬라이스 C), Scale(슬라이스 D).
- A+B 묶음으로 프로드 배포 조건 충족(접수로 알림을 멈출 수 있음).

## UI 원칙 (오너 지시 — 구현자는 위반 금지)

- **1366×768**(구세대 POS 터미널) 전제.
- **기능 우선, 장식 최소**: 앞으로 들어갈 요소가 많고 계속 수정된다.
  섹션은 단순 세로 스택(빡빡한 픽셀 그리드 금지), 스타일은 기본 여백·구분선·
  상태 배지·대형 터치 버튼(h-14, 터치는 기능)까지만. 색·타이포 튜닝,
  카드 중첩, 애니메이션 금지. 컴포넌트는 섹션 단위로 잘게 쪼개 교체 쉽게.
- `onPointerDown`만 사용(스캐너 Enter 트랩), disabled 는 in-flight 공유
  boolean 하나(v1 관례).

## 전이 정책 (crm 정본, 앱은 버튼 노출용 복사본 — 픽업 1차 관례)

```
PLACED   → ACCEPTED | REJECTED
ACCEPTED → READY | REJECTED
READY    → REJECTED (admin 스코프 필요 — v1 의 manager 게이트 계승)
COLLECTED / CANCELLED / REJECTED / EXPIRED → 전이 없음 (종결)
```

- 유효하지 않은 전이 버튼은 **미표시**(비활성 아님).
- REJECTED 는 사유 필수: trim 후 1~200자. `RetailOrder.rejectReason` +
  이벤트 `note` 기록.
- 낙관잠금: 클라이언트가 상세의 `version` 을 body 로 전송. crm 은
  `updateMany { id, companyId, status: <from>, version }` 원자 가드(소비자
  취소 `order-cancel.service.ts` 패턴) + 해당 상태 타임스탬프 + `version
  increment`. count 0 → **409 `TRANSITION_CONFLICT` 단일 코드**(not-found/
  상태 불일치/버전 낡음 비구분 — 앱은 상세 재조회로 실상태 학습).
- 이벤트 append: `actorType: "DEVICE"`, `actorLabel` = 디바이스명
  (res.locals device), reject 는 `note` = 사유. 응답은 갱신된 상세 DTO 전체.

## 계약

### crm-server (`src/device/order/` 확장)

- `GET /device/order/:id` — 상세. `mapRetailOrderAdminDetail` 재사용 +
  `dueAt` 추가(A 의 computeOrderDueAt). 404 "Order not found".
- `POST /device/order/:id/accept` — body `{ version }`.
- `POST /device/order/:id/ready` — body `{ version }`.
- `POST /device/order/:id/reject` — body `{ version, reason }`.
- 전이 로직은 `src/device/order/order-transition.service.ts`
  (order-cancel.service 미러: $transaction + updateMany 가드 + 이벤트 +
  상세 재조회 반환, dbClient DI).
- **푸시는 트랜잭션 밖, best-effort**: 전이 커밋 후 `getPushTokens(companyId,
  memberId)` → 비면 skip → `sendPushNotification(tokens, title, body,
  { type: "order", id })`. 실패해도 전이 성립(try/catch console.error).
  문구(영문 리터럴, 기존 관례): accept "Order accepted" / "Your order
  {orderNo} has been accepted.", ready "Order ready" / "Your order {orderNo}
  is ready for collection.", reject "Order declined" / "Sorry, your order
  {orderNo} was declined. {reason}". 빌더는 순수 함수로 분리(테스트).
- READY→REJECTED 의 admin 게이트는 **crm 이 아니라 pos_server/앱 몫**
  (crm 은 device-key 하나로 유저를 모름 — 정책 map 은 crm 도 동일하게
  강제하되 스코프 판정은 로컬).
- 라우트 순서: `/pending-count` 리터럴 유지, `GET /:id` 는 마지막.

### retail_pos_server (`src/v1/order/` 확장)

- `GET /api/order/:id` 프록시, `POST /api/order/:id/accept|ready|reject`
  프록시(body 패스스루, requireOk 매핑). 전부 `userMiddleware +
  scopeMiddleware("sale")`.
- READY→REJECTED 는 서버에서도 가드: 현재 상세를 먼저 조회하지 않고,
  **앱이 보낸 body 의 `fromStatus`(선택)로 판정하지 않는다** — 단순화:
  서버는 스코프 게이트만 앱 요청 헤더의 유저 scope 로 수행하되, READY 발
  reject 인지 여부는 crm 409 가 최종 방어선이므로 서버 측 추가 조회는
  하지 않는다(관대). 앱이 admin 스코프 없으면 버튼 자체를 안 그린다.
- 상태 전이 정책 순수 모듈 `order.status-policy.ts` (v1 부활판): map +
  `getVisibleOrderStatusActions(from, scopes)` + assert 계열. 서버·앱
  각 1부 복사(공유 금지 — v1 관례, 리포 내 두 패키지가 빌드 독립).

### retail_pos_app

- `service/order.service.ts` 확장: `getOrder(id)`, `acceptOrder(id,
  version)`, `readyOrder(id, version)`, `rejectOrder(id, version, reason)`.
- **`components/orders/OrderViewer.tsx`** — SaleInvoiceViewer 관례:
  항상 마운트 + `{ orderId: number | null, onClose, onChanged }`,
  백드롭 `fixed inset-0 bg-black/50` + `onPointerDown` 닫기 + 내부
  stopPropagation, 자체 fetch/loading/error.
  - 레이아웃(느슨하게): 패널 `w-full max-w-5xl max-h-[92vh] overflow-auto`
    + 헤더(주문번호·상태 배지·닫기) + **세로 스택 섹션**:
    ① 요약(수령방식·기한 dueAt·멤버 …전화3·placedAt)
    ② **Made to Order 섹션**(옵션 보유 라인 — 라인명·수량 + 옵션
    그룹/선택/수량 브레이크다운 항상 펼침, 건수 표기)
    ③ **Picking 섹션**(옵션 없는 라인 — 한 줄: 명칭·수량·금액, 건수 표기)
    ④ 금액(subtotal / surcharge / deliveryFee / total)
    ⑤ (있으면) 거절 사유
    ⑥ 하단 액션 바: `getVisibleOrderStatusActions` 결과만 h-14 버튼으로.
  - 전이 confirm 1회(문구에 "Customer will be notified" 포함). Reject 는
    사유 입력 모달(백드롭 형제 렌더 — v1 탭 관통 방지 트릭) + 기존
    OnScreenKeyboard 사용.
  - 409 시: "Order was updated elsewhere" 알림 + 상세 재조회.
  - 전이 성공 시: 상세 갱신(응답 DTO) + `onChanged()`(목록 재조회) +
    **PLACED 발 전이면 orderInboxStore 카운트 로컬 -1**(브로드캐스터 다음
    틱까지의 차임 갭 제거 — 다음 틱이 정본으로 덮음).
- `OrderSearchPanel` 행 탭 활성화 → `onSelect(order.id)` → Screen 이
  Viewer 를 연다(Screen+Panel+Viewer 완성).
- 상태 정책 클라 복사본 `components/orders/order-status-policy.ts` +
  콜로케이트 순수 테스트(`*.test.mjs` — v1 이 하던 방식).

## 테스트 / 게이트

- crm: 전이 가드(각 from→to 성공/실패), 409 단일화, reason 검증(빈/공백/
  201자), 이벤트 append(actorType/label/note), 타임스탬프, 푸시 best-effort
  (실패 주입 시 전이 성립·푸시 빌더 순수 테스트), 상세 dueAt. 전체 스위트
  그린 + build.
- pos_server: status-policy 순수 테스트 + requireOk 매핑, `npm run build`
  + node:test.
- 앱: status-policy `*.test.mjs`, tsc(기존 3에러 제외 신규 0) + build.
