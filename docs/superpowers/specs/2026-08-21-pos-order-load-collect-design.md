# S3 — 세일스크린 주문 로드 + 결제 → COLLECTED (구 슬라이스 E)

2026-08-21. 정본: BACKLOG §X-8(S2 원안의 E 부분)·§AC-1·/ecommerce phase-3 S3.
선행 완료: S2(러너 접수·피킹 확정 — `RetailOrderLine.pickedQty`), 픽업리스트
QR `order%%%<orderId>`(슬라이스 C 가 인쇄, 소비자는 이번에 신설).
변경 범위: crm-server / pos-retail(retail_pos_server + retail_pos_app + prisma)
/ api-server(싱크 DTO 1필드). 목적: **C&C 주문의 정상 종결 경로** — 결제가
곧 수령 확정이고, 주문은 스스로 닫힌다.

## 1. 흐름 (오너 확정 반영)

1. **진입 2경로**: ① SaleScreen 스캔 디스패치에 `order%%%<id>` 분기 추가
   (우선순위: member%%% → **order%%%** → PP `00:` → 상품 바코드) ② OrderViewer
   에 "Load to Sale" 버튼(활성 상태에서만).
2. **상태별 로드 정책(오너 2026-08-21)**:
   - `READY` → 즉시 로드, 라인 수량 = **pickedQty**(0 라인은 제외).
   - `ACCEPTED` → **컨펌 다이얼로그** 후 로드: 문구 "This order hasn't been
     picked yet. Load with ordered quantities?" (한국어 병기: "아직 피킹 확정
     전 주문입니다. 주문 수량으로 불러올까요?"). 라인 수량 = 주문 qty,
     캐셔가 카트에서 조정.
   - `PLACED` → 차단 + "접수 먼저" 안내(러너/수신함). 종결 상태 → 차단
     (COLLECTED 는 "이미 결제 완료" 문구 — 중복 결제 방지 1차).
3. **로드 동작(§X-8 관례)**: 빈 카트(4개 중 활성)가 아니면 차단("빈 카트에서
   로드"). **멤버 먼저 부착**(주문 스냅샷 memberId+이름 — §Y hold 스타일 최소
   멤버, 적립은 업싱크가 처리) → 라인 주입: 로컬 Item 을 `sourceItemId` 로
   조회(로컬 id=클라우드 id, 다운싱크 upsert 관례), `unit_price_adjusted =
   주문 라인 unitPrice`(옵션 포함 실효단가 — 스냅샷 가격이 로컬 카탈로그를
   이긴다), qty = 위 정책 × QTY_SCALE. 로컬에 없는 아이템 라인은 로드 중단
   + 안내(부분 로드 금지 — 금액 정합). 카트에 `externalOrderId` 마킹 +
   주문번호 표시.
4. **로드 후는 일반 판매와 완전 동일** — 라인 추가/조정/삭제 자유(추가 구매
   대응), PaymentModal 그대로(현금/카드/분할). 같은 externalOrderId 를 다른
   카트에 중복 로드 금지.
5. **결제 성공 훅(서버)**: sale 생성 트랜잭션 커밋 후 retail_pos_server 가
   crm `POST /device/order/:id/collect` 호출(§2) — **best-effort**: 실패해도
   판매는 성립, 미전이 인보이스는 스윕이 재시도(§4).

## 2. crm-server 계약

- `POST /device/order/:id/collect` (device-key). Body:
  `{ posInvoiceSerial: string }` — **version 없음**(결제 성립이 권위,
  UI 낙관잠금과 무관).
- 가드: 회사 스코프 ∧ `status IN (ACCEPTED, READY)` 를 `updateMany` 원자
  조건으로 — 실패(타사/부재/PLACED/종결)는 409 `TRANSITION_CONFLICT` 단일
  코드(§X-15 관례). **멱등 예외**: 이미 COLLECTED ∧ 동일 posInvoiceSerial
  이면 200(스윕 재시도 안전).
- 성공 기록: `status=COLLECTED, collectedAt, version+1` +
  `paymentStatus=PAID` + `posInvoiceSerial` 역기록(§X-13 결정) + 이벤트
  `COLLECTED`(actorType DEVICE, note 에 serial) + 고객 Expo 푸시 best-effort
  ("주문 수령이 완료되었습니다" 계열 — 기존 buildOrderPushMessage 확장).
- DTO: 상세에 collectedAt·posInvoiceSerial 은 기존 노출 유지.

## 3. pos-retail

- **retail_pos_server**: ① prisma `SaleInvoice.externalOrderId String?` +
  `externalOrderCollectSyncedAt DateTime?` + **부분 유니크 인덱스**
  (`externalOrderId WHERE NOT NULL` — 같은 주문 이중 인보이스 서버 차단.
  단 REFUND/재판매 흐름과 충돌 없게 SALE 타입 한정 여부는 구현 시 스키마
  제약으로 가능한 형태 선택, 불가하면 서비스 검증으로) ② sale 생성 서비스:
  페이로드의 externalOrderId 저장 + 커밋 후 crm collect 호출, 성공 시
  `externalOrderCollectSyncedAt=now`. ③ **collect 스윕**(§4).
  ④ 기존 order 프록시에 로드용 변경 없음(상세는 기존 GET 재사용).
- **retail_pos_app**: 스캔 분기·뷰어 버튼·로드 훅(`useOrderLoad` — 조립
  원칙: SaleScreen 은 배선만), 카트 마킹 표시(주문번호 배지), build-payload
  에 externalOrderId, 결제 완료 화면에 "주문 #N 수령 완료/전이 실패(자동
  재시도)" 상태 표시.
- 409(레이스: 결제 중 러너가 REJECT 등) 시: 판매 성립 유지 + 뷰어/알럿으로
  운영 충돌 고지(환불은 기존 REFUND 플로우 — 자동화 안 함).

## 4. 오프라인/실패 재시도 (기존 업싱크 패턴 준용)

`externalOrderId IS NOT NULL AND externalOrderCollectSyncedAt IS NULL` 인
SaleInvoice 를 기존 업싱크 트리거(판매 생성·클라우드 마이그레이트·서버
부팅·시프트 마감)에서 스윕 — 멱등(§2)이라 중복 안전. 영구 409(주문이
REJECTED 로 닫힘)는 `externalOrderCollectSyncedAt=now` + 로그로 종료(무한
재시도 방지), 사람 처리.

## 5. api-server

`/device/sync/retail/*` 인보이스 업싱크 DTO 에 `externalOrderId` 통과 +
저장 컬럼(마이그레이션, nullable) — 어드민/리포트가 나중에 주문↔인보이스
역추적 가능. §X-8 "3곳" 의 세 번째.

## 6. 범위 외 (기록)

부분 피킹 소비자 노출(§AC-6 별도 브레인스토밍) / Stripe 선결제(S3 후속,
paymentStatus 축은 이번에 PAID 기록으로 정렬됨) / Operations 전이 표면 /
DELIVERY 주문의 배송 출발 흐름(READY 이후 — 별도 논의).

## 7. 게이트

crm 전체 테스트 그린(672+신규) · pos_server build+테스트 · 앱 tsc(기존 3
에러 외 신규 0)+빌드 · api 테스트 그린. dev 체인 실동작: 주문→피킹→READY→
**QR 스캔 로드→결제→COLLECTED 자동 전이→앱/어드민 반영** 관통. 배포 순서:
**crm → api → pos-retail**(§AC-6 순서 결합에 합류. pos 는 서버 reload +
틸 릴리스 태그).
