# POS 주문 수신함 슬라이스 A — 알림 + 목록 (2026-08-10)

S2(POS 수신) 분할의 첫 슬라이스. 정본 결정 원장: `ktpv5-api-docs/BACKLOG.md` §X
(특히 §X-4 개정 — 전이는 현장 POS+Operations 전용, §X-13 어드민 조회 완료).

## 슬라이스 시퀀싱 (오너 확정 2026-08-10)

- **A (이번)**: POS 수신 알림 + 주문 목록. 디테일 화면 없음, 전이 없음.
- **B**: 디테일 화면 + 전이(접수/준비완료/거절).
- **C**: POS 인쇄 2종 — ① 챙길 품목 리스트(ESC/POS) ② 주문생산 작업지시서(ZPL).
- **D**: Scale 단말로 최소 기능 이식(수신 동일, 라벨 2종 성격).

**⚠️ 배포 커플링**: A에는 접수 수단이 없어(어드민도 조회 전용) 알림을 멈출 방법이
없다 — PLACED 가 영원히 울린다. **프로드 배포는 B와 묶어서**. dev QA 는 무관.

## 알림 룰 (오너 확정)

- 기준: **미접수(PLACED) 주문이 1건이라도 존재하는 동안** 반복 차임.
- 주기: **차임 2분 간격** + 신규 도착(카운트 증가) 감지 시 즉시 1회.
- **폴링 1분**: retail_pos_server 가 crm 을 60초마다 폴링, Socket.IO 로 전 단말
  브로드캐스트. (픽업 1차의 pending-count 브로드캐스터 부활 — 단 1차를 죽여놨던
  `CRON_INSTANCE` 게이트는 없이 무조건 시작.)
- **차임은 지정 터미널만**: 다중 터미널 매장에서 전부 울리면 노이즈(오너).
  로컬 `Terminal.orderChimeEnabled Boolean @default(false)` 신설,
  `/manager/store` `StoreSettingScreen`에 터미널 목록 + 차임 토글 섹션 추가.
  SaleScreen 버튼(밀도)·인터페이스 설정(스텝 과다)은 기각된 대안.
- 수신 표시(배지·배너·목록)는 **전 터미널 정상 동작** — 차임만 게이트.
- 설정 변경 실시간 반영: 브로드캐스트 페이로드에 `chimeTerminalIds` 포함,
  각 앱이 자기 터미널 id 로 판단(재시동 불요).

## 계약

### crm-server: `/device/order/*` (신설, 기존 device 표면)

기존 `src/device/{member,customer-voucher}` 관례. deviceMiddleware(device-key →
api-server `/device/me` 패스스루)로 companyId 확보. 리터럴 라우트가 `/:id` 보다
먼저 — 단 이번 슬라이스엔 `/:id` 자체가 없음.

- `GET /device/order/pending-count` → `{ ok, result: { count } }` — 회사의
  PLACED 건수. 브로드캐스터 전용 경량 쿼리.
- `GET /device/order?preset=&fulfillment=&page=&limit=` → 어드민 internal 요약
  DTO 와 동일 형(`RetailOrderAdminSummaryDto` 재사용) **+ `dueAt: string | null`**
  (ISO). paging `{page,limit,total,totalPages}`.
  - `dueAt` 계산(시드니, 서버 단일 소스 — POS 재계산 금지):
    C&C = `pickupDate` + `pickupSlotMinutes` 의 정확한 시각.
    DELIVERY = `deliveryEtaDate` 00:00 (날짜 단위 — 표시도 날짜만).
  - `preset` (기본 `active`):
    - `new` — PLACED. 정렬 placedAt **asc** (오래 방치된 것 먼저).
    - `dueSoon` — 활성(PLACED/ACCEPTED/READY) ∧ (C&C: dueAt ≤ now+120분 —
      **과기한 포함** / DELIVERY: etaDate ≤ 오늘). 정렬 dueAt asc.
    - `today` — 활성 ∧ (C&C pickupDate = 오늘 ∨ DELIVERY etaDate = 오늘).
      정렬 dueAt asc.
    - `active` — PLACED/ACCEPTED/READY 전체. 정렬 dueAt asc.
    - `history` — COLLECTED/CANCELLED/REJECTED/EXPIRED. 정렬 placedAt desc.
  - `fulfillment` = CLICK_AND_COLLECT | DELIVERY (선택).
  - 잘못된 preset/fulfillment → 400.

### retail_pos_server

- **`src/v1/order/`** (router/controller/service/types) — `GET /api/order` 를
  crm `/device/order` 로 프록시. `crmApiService`(device-key 자동) +
  `getCloudQs` 패스스루 + `requireOk` 헬퍼(customer-voucher 판 복제 — 공용화는
  클린업 패스로 기록만). `userMiddleware` + `scopeMiddleware("sale")`.
  라우터 마운트 `router.use("/order", orderRouter)`.
- **브로드캐스터** `src/v1/order/order.pending-broadcaster.ts` — 60초 간격:
  crm pending-count 조회 + 로컬 `Terminal`(orderChimeEnabled=true) id 목록 조회
  → 전 소켓에 `order:pending-count` `{ ok, count, chimeTerminalIds,
  generatedAt }` 브로드캐스트. 직전 카운트보다 **증가**하면 `order:new`
  `{ count }` 추가 발사. 신규 소켓 접속 시 마지막 페이로드 즉시 1회 전송.
  crm 불통 시 `{ ok: false, count: null, ... }` — 조용히 로그만(fire-and-forget),
  재시도는 다음 틱. 재진입 가드. `src/index.ts` 에서 무조건 시작.
- **Prisma**: `Terminal.orderChimeEnabled Boolean @default(false)` + 마이그레이션.
  `/api/terminal/me` 응답에 포함. 터미널 목록/토글 라우트는 기존 terminal
  모듈 관례를 따라 추가(`GET /api/terminal`, `PATCH /api/terminal/:id/order-chime`
  — 기존 라우트가 있으면 그 관례 우선).
- **로컬 미러 테이블 금지** — 픽업 1차의 `PickupOrder*Cache` 실패 반복 금지,
  목록은 항상 실시간 프록시(§X-4).

### retail_pos_app

- **`OrderNotification`** — `components/Gateway.tsx` 의 `DeviceMonitor` 옆 상주
  (고객 디스플레이는 Gateway 밖이라 자동 제외).
  - 자체 socket.io 클라이언트(구 `PickupPendingCountButton` 관례:
    reconnectionAttempts Infinity, 페이로드 정규화).
  - `count > 0` → 상단 주황 배너 "New orders: N — touch to open" (터치 →
    `/manager/orders`). 소켓 끊김 → 회색 스타일.
  - 차임: 자기 터미널이 `chimeTerminalIds` 에 있을 때만. `order:new` 즉시 1회 +
    `count > 0` 인 동안 120초 간격 반복. 오디오는 `src/renderer/src/assets/`
    번들(WebAudio 생성 톤 또는 짧은 파일), 최초 pointerdown 제스처에서 언락
    (Chromium 자동재생 정책).
- **SaleScreen 상단 배지** — 구 PickupPendingCountButton 부활판 `OrdersPendingButton`:
  "Orders: N" + 연결상태 스타일, 탭 → `/manager/orders`. Top Bar 우측
  (`SyncButton` 옆).
- **`/manager/orders`** — Screen+Panel 관례(뷰어 없음): `OrdersScreen`(스코프
  `sale`, BlockScreen 게이트) + `OrderSearchPanel`(프리셋 탭 New/Due 2h/Today/
  Active/History + C&C/Delivery 토글 + `ServerPagingList` 20행). 행:
  placedAt 시각 · orderNo · C&C/배달 배지 · 멤버명(…전화3) · 품목수+첫품목 ·
  금액 · 수령예정(C&C 슬롯 HH:mm / 배달 ETA 날짜) · 상태 배지. 과기한(dueAt
  경과 ∧ 활성) 빨강 강조. 행 탭 무동작(디테일은 슬라이스 B).
- **StoreSettingScreen** — "Order chime terminals" 섹션: 터미널 목록 + 토글.

## 테스트 / 게이트

- crm: 기존 스위트 + `/device/order` 프리셋→where 매핑·pending-count·400 검증
  단위 테스트(주입 fake, DB 없이 — 관례). `npm test` 전체 그린 + tsc.
- retail_pos_server: 프리셋/브로드캐스터 순수 로직 `node:test` (콜로케이트
  `*.test.ts` → dist 실행 관례), `npm run build` 그린.
- retail_pos_app: `npx tsc --noEmit -p tsconfig.web.json` + `npm run build`.
  수동 QA 는 오너(dev 서버·실기기).

## 명시적 비범위

디테일 화면, 전이, 인쇄 2종, Scale, Operations 푸시, 로컬 캐시/오프라인 큐,
Expo 고객 푸시(슬라이스 B 의 전이와 함께).
