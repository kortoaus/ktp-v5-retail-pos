# Fast Checkout 태블릿 (Expo Android) — 설계 (2026-08-13)

정본 결정 원장: `ktpv5-api-docs/BACKLOG.md` §Z. 조사 근거: 2026-08-13 세션
Explore 전수 보고(SaleScreen 의존성) — 요지는 §Z 와 이 문서에 압축됨.

## 목적 (오너)

바쁠 때 들고 다니는 **크레딧 카드 전용 fast checkout 보조 단말**. 블루투스
2D 바코드 스캐너 1대가 유일한 주변기기. retail_pos_server(2200, LAN)의
**신규 순수 HTTP 클라이언트** — 서버 변경 없음(전 구간 기존 API 검증 완료).

## 확정 결정 (전부 오너 재가, §Z)

1. **시프트 = 자체 터미널 + 자체 시프트.** 크레딧 온리라 현금 시재 전면
   생략: open 은 `POST /api/shift/open` body `cashInDrawer: 0` 고정(입력 UI
   없음, 버튼 1개), close 는 `POST /api/shift/close` body
   `{ closedNote, endedCashActual: 0 }` — **노트만 입력**. 기대현금 0 이라
   시재차액 항상 0, 태블릿 Z리포트는 크레딧 매출만. 서버 페이로드 검증 통과
   확인됨.
2. **스캐너 2D** — 멤버 QR(`member%%%id[%%%level]`)·PP 바코드(`00:<json>`)
   경로 유지.
3. **weight 상품 미지원** — `type === "weight"`(스케일 필요 open-weight)
   스캔 시 "미지원 — 메인 계산대 이용" 안내. **weight-prepacked(가격내장
   2/02-prefix)는 정상 판매**(스케일 불요 — 바코드가 최종 가격, qty 1000).
4. **수식 공유 = sync 스크립트 카피** (EAS build only → 앱 폴더 밖 참조
   불가): **정본 = retail_pos_app**, `scripts/sync-sale-core.mjs` 가 지정
   파일을 태블릿 `src/shared/sale-core/` 로 복사 + "DO NOT EDIT — copied
   from retail_pos_app/... by sync-sale-core" 헤더 자동 삽입 + `--check`
   모드(원본-사본 diff, 다르면 exit 1)를 태블릿 prebuild/EAS 훅에 연결.
5. **결제 = CREDIT 단일 텐더.** exact-tender 라 라운딩 0 강제,
   서차지 = `storeSetting.credit_surcharge_rate`(퍼밀, 기본 15) 자동.
   현금/바우처/기프트카드/SPEND/환불 전부 미탑재.
6. **영수증 = 기본 없음, 예비만**: 네트워크 ESC/POS 설정(`{host, port}`)이
   있으면 완료 화면에 수동 "Print receipt" — **escpos 네이티브 커맨드 모드
   한정**(raster 는 DOM 캔버스 의존이라 제외), 인코딩 `ascii-replace` 고정.
   `POST /api/printer/print?ip=&port=` (서버가 TCP 소유) 재사용.
7. **빌드 = EAS build only** (Android). 위치: 리포 내 `retail_pos_tablet/`
   (독립 package.json — 리포의 무워크스페이스 관례 유지).

## 아키텍처

```
retail_pos_tablet (Expo, Android)
  ├─ src/shared/sale-core/   ← sync-sale-core 사본 (정본: retail_pos_app)
  │    SalesStore.helper(recalculateLine·resolveDiscountedPrice — uuid 만 폴리필),
  │    usePaymentCal, build-payload(+payload.types), points,
  │    member-level-estimate, pp-barcode, scan-utils(embededPriceParser),
  │    member-qr, item-utils(generateSaleLineItem·getItemType), constants
  ├─ 자체 코드: api 클라이언트, config 저장, 스캐너 훅, 화면 5, 카트 store
  └─ HTTP → retail_pos_server :2200 (헤더 ip-address = 고정 식별 문자열)
```

- **터미널 바인딩**: `ip-address` 헤더는 IP 가 아니라 조회 문자열
  (`Terminal.ipAddress`, 유니크 제약 없음). 태블릿 config 에 **고정 식별
  문자열**(예: `tablet-1`) 저장, 기기 실제 IP 절대 사용 금지(DHCP 무관화).
  Terminal 행은 DB 수동 INSERT(셀프 등록 없음 — dev 는 psql, 프로드는 운영
  절차).
- **인증**: 스태프 코드 로그인 `GET /api/user/code?code=` →
  `Bearer ${user.id}%%%${Date.now()}` (기존 관례), scope `sale|admin` 요구.
  expo-secure-store 에 저장.
- **config**(AsyncStorage/SecureStore): `{ server: {host, port},
  terminalIdentity: string, receiptPrinter?: {host, port} }`. 서버 설정
  화면에서 `GET /health` 프로브 후 저장(ServerSetupScreen 관례).

## API 사용 (전부 기존, 서버 무변경)

| 용도 | 라우트 |
|---|---|
| 부팅/바인딩 확인 | `GET /api/terminal/me` (404 = Not Registered) |
| 스토어 설정(서차지율·포인트율) | `GET /api/store` |
| 로그인 | `GET /api/user/code?code=` → 토큰 합성, `GET /api/user/me` 검증 |
| 시프트 | `GET /api/shift/current` · `POST /api/shift/open`(cash 0) · `POST /api/shift/close`(note, cash 0) |
| 스캔 | `GET /api/item/search/barcode?barcode=` |
| 멤버 QR | `POST /api/crm/member/search/id` (오프라인 시 미검증 부착 폴백 — 기존 SaleScreen 관례 유지) |
| 판매 | `POST /api/sale` (SaleCreatePayload — build-payload 사본 사용) |
| 영수증(예비) | `GET /api/sale/:id` + `POST /api/printer/print?ip=&port=` |

## 화면 5

1. **Setup** — 서버 host/port + terminalIdentity + (예비) 영수증 프린터
   host/port. health 프로브 성공 시 저장.
2. **Login** — 스태프 코드 입력(넘패드). scope sale 검증.
3. **Shift** — 현재 시프트 없으면 "Open shift" 버튼 1개(시재 없음).
   열려 있으면 판매로. 마감은 메뉴에서 노트 입력 → close.
4. **Sale** — 카트 리스트 + 합계. 입력은 스캔 전용(검색 UI 없음 — fast
   checkout). 스캔 디스패치 우선순위(기존 SaleScreen 이식): member%%% →
   PP(00:json) → plain barcode. weight type 은 안내 후 거부. 라인 탭 =
   수량 +1? 아니오 — **qty 스테퍼 + 삭제만**(단순 유지). 멤버 부착 표시.
5. **Pay(CREDIT)** — 표시: linesTotal · surcharge(자동) · **total** ·
   (멤버 시) 예상 포인트. 버튼 1개 "Charge $X.XX" → confirm →
   `POST /api/sale`(payments: [{type:"CREDIT", amount: total}]) → 완료
   화면(주문번호·total, 예비 Print receipt) → 자동 새 판매.

## 스캐너 훅 (RN)

블루투스 HID = 키보드 웨지. **네이티브 keyEvent 방식 권장**(숨김 TextInput
은 소프트 키보드/포커스 싸움) — `react-native-keyevent` 계열로 Activity
dispatchKeyEvent 후킹, 기존 휴리스틱 이식: 키 간격 >50ms 버퍼 리셋, 300ms
유휴 클리어, 최소 3자, Enter 종료, 공백 제거. e.code 대응은 keyCode 매핑.
소프트 키보드(코드/노트 입력) 표시 중엔 스캐너 훅 정지(기존
usePhysicalKeyboard 중재 관례의 RN 판).

## sync-sale-core 스크립트

- 위치 `retail_pos_tablet/scripts/sync-sale-core.mjs` (node 실행, 의존 0).
- 파일 목록은 스크립트 상수로 명시(위 sale-core 목록). 복사 시 헤더 삽입,
  상대 import 경로 재작성 필요분은 목록화(최소화 — 사본 폴더 구조를 원본
  구조와 동일하게 유지해 재작성 0 을 노림).
- `--check`: 헤더 제외 diff, 불일치 시 exit 1 + 파일 목록 출력. package.json
  `prebuild`/`eas-build-pre-install` 훅에 연결.
- 유일 소스 수정: `SalesStore.helper.ts` 의 `crypto.randomUUID()` —
  태블릿 엔트리에서 `react-native-get-random-values` 폴리필 import 로 해결
  (원본 무수정).

## 비범위

환불/리페이/SPEND/현금/바우처/기프트카드, 스케일, 고객 디스플레이, 핫키,
주문 수신함(POS 전용 유지), 오프라인 판매 큐(로컬 서버가 이미 오프라인
경계 — 태블릿은 LAN 필수), 자동 영수증, iOS.

## 게이트

- sync 스크립트 `--check` 그린 + 사본 순수 로직 테스트(원본 테스트가 있는
  모듈은 사본에서도 실행 가능해야 — 최소 usePaymentCal·build-payload·
  scan-utils 스모크).
- `npx tsc --noEmit` 그린, EAS 빌드(preview) 성공.
- 수동 QA(오너): 실기기 + 블루투스 스캐너 — 스캔→카트→크레딧 결제→
  POS 인보이스 검색에서 확인, 시프트 열기/마감 Z리포트, 멤버 QR 적립.

## 구현 순서 (새 세션 진입점)

1. Expo 스캐폴드(`retail_pos_tablet/`, TS strict) + config/Setup 화면
2. sync-sale-core 스크립트 + 사본 반입 + 스모크 테스트
3. api 클라이언트(ip-address 헤더·토큰) + Login/Shift 화면
4. 스캐너 훅 + Sale 화면(카트 store — zustand, 4카트 불요·1카트)
5. Pay 화면 + POST /api/sale + 완료 화면
6. (예비) 영수증 escpos 네이티브 경로
7. dev QA → EAS preview 빌드
