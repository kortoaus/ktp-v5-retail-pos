# POS 주문 수신함 슬라이스 C — 실물 인쇄 2종 (2026-08-13)

슬라이스 B(`2026-08-13-pos-order-detail-design.md`) 후속. 정본: BACKLOG §X-14~15.

## 개요 (오너 확정)

- **픽업리스트 (ESC/POS 영수증 프린터)** — 주문 단위 1장. 전 상품 체크리스트
  (**제작 상품 포함** — 최종 바구니/어셈블 검수용, 제작 라인엔 "라벨 별도"
  마커), 주문자명·주문 정보, **주문을 바로 불러오는 QR(orderId)**.
- **제작 라벨 (ZPL 100×100)** — 옵션 보유 라인 전용, 주문서+작업지시서+
  상품라벨 3역할. 상품 정보 + 유저 선택 옵션(작업지시 본문), 주문서·주문자
  정보 최소화, 바코드 자리 2종은 **플레이스홀더**.
- **수동 인쇄**(뷰어 버튼), **재인쇄 가능**, **1탭 = 1장**(혼선 방지 — 여러 장
  = 여러 번), **인쇄 여부 기록 필수**.

## 바코드/QR 의미 (오너)

- **QR(픽업리스트)**: content = `order%%%<orderId>` (member%%% 관례 준용,
  스캔 디스패치 충돌 방지). 용도는 슬라이스 E — 현장결제 시 Sale Screen 에
  주문을 복원(일부 취소·변경·추가 구매 대응, 즉시 결제 아님). C 에서는
  인코딩만 하고 스캔 핸들러는 E.
- **라벨 바코드 A(주문서 유니크)**: 자리만. E 에서 확정.
- **라벨 바코드 B(상품 단건 판매용)**: **PP 바코드(`00:<json>`) 형태로만**
  자리 확보. 용도: 주문자가 취소했을 때 제작 상품을 폐기하지 않고 진열
  판매하는 보험. **열린 고민(오너, 기록)**: "남의 주문용으로 만든 라벨"이
  붙은 채 진열되면 곤란 — 실채움 전에 라벨 표기 정책(주문자 흔적 제거 등)
  재논의 필요. 이번엔 PLACEHOLDER 박스만.

## 인쇄 기록 (crm 이 정본)

- `RetailOrderEventType` enum 에 **`PICKLIST_PRINTED`, `LABEL_PRINTED`** 추가
  (마이그레이션 — 이 enum 은 애초에 비상태 이벤트 확장용으로 status enum 과
  분리 설계됨). 이벤트: actorType DEVICE, actorLabel=디바이스명, LABEL 은
  note 에 라인 식별(`line:<lineId> <name_en>`).
- 신규 `POST /device/order/:id/printed` body `{ kind: "picklist" }` 또는
  `{ kind: "label", lineId }` — 이벤트 append 후 **갱신된 상세 DTO 반환**
  (전이 응답과 동일 형). lineId 는 해당 주문의 라인인지 검증(아니면 400).
  상태 전이 아님 — version 불요, 종결 주문에도 인쇄 기록 허용(재인쇄).
- **소비자 노출 차단(필수)**: 소비자 `/api/order/:id` 상세의 events 는
  **상태 이벤트 7종만 필터**해서 반환(인쇄 이벤트는 내부용 — 고객 타임라인에
  새면 안 됨). device/internal(어드민) 상세는 전체 유지.
- POS 쪽 기록은 **best-effort**: 기록 실패가 인쇄를 막지 않는다(인쇄 후
  fire-and-forget, 실패 시 console.error — 기존 인쇄 관례와 동일).

## POS 구현

### retail_pos_server
- `POST /api/order/:id/printed` 프록시 (userMiddleware+scope sale, body
  패스스루, requireOk).

### retail_pos_app — OrderViewer 확장 (장식 최소 원칙 유지)
- **픽업리스트 버튼**(주문 단위, 액션 바 또는 요약 섹션 — 전이 버튼과 구분되는
  secondary 스타일, h-12+): 기존 ESC/POS **raster 파이프라인**(576px 캔버스 →
  `GS v 0`, `libs/printer/` 재사용, qrcode 라이브러리 기존 탑재) 로 렌더:
  헤더(orderNo·주문자명 …전화3·수령방식·기한 dueAt) → 체크리스트 행
  (`□ 상품명 ×qty`, 제작 라인은 `[LABEL]` 마커) → 합계 라인 수 → **QR
  (`order%%%<orderId>`)**. 프린터는 기존 escposPrinter 설정 재사용.
- **라벨 버튼**(제작 라인별, Made to Order 섹션 행에 h-12 버튼): ZPL 생성 →
  기존 `label:print` IPC (`useZplPrinters`), **media 100100** 프린터 대상
  (설정에 100100 프린터 없으면 알럿). 레이아웃(100×100mm, 203dpi 기준):
  상품명 en(크게)+ko → 옵션 브레이크다운(`그룹명: 옵션명 ×qty` 줄들 — 본문)
  → `QTY n` → 하단 소형: orderNo + 수령 기한 → 바코드 플레이스홀더 박스 2개
  ("ORDER QR" / "PP QR" 라벨 텍스트만). 픽업 1차의 work-label 코드
  (`git show a0c9917^` 의 label 관련 libs)를 레이아웃 참고로 활용 가능.
  한글은 기존 라벨 파이프라인의 인코딩 관례를 따른다.
- **Printed 표시**: 상세 events 에서 `PICKLIST_PRINTED` 카운트 → 버튼에
  "Print pick list (2)" 식 표기, `LABEL_PRINTED` 는 note 의 lineId 매칭으로
  라인별 카운트. 인쇄 성공 → printed 기록 POST → 응답 상세로 갱신.
- 인쇄 호출은 전부 try/catch + console.error(판매/전이 흐름을 절대 블로킹
  금지 — 리포 인쇄 관례).

## 테스트 / 게이트

- crm: printed 이벤트(kind 검증·lineId 검증·이벤트 append·디테일 반환),
  **소비자 events 필터**(인쇄 이벤트 미노출), enum 마이그레이션. 전체 그린.
- pos_server: 프록시 + 정책 무변경 확인, build+node:test.
- app: ZPL 빌더·픽업리스트 렌더 데이터 빌더를 **순수 함수로 분리 + 콜로케이트
  테스트**(하드웨어 무접촉), tsc 신규 0 + build. 실물 출력은 오너 QA.

## 범위 외

QR/바코드 스캔 핸들러(E), PP 바코드 실데이터, Scale(D), 자동 인쇄.
