# 오프라인 멤버 포인트 적립 (hold & sync) — 설계

- 날짜: 2026-08-07
- 상태: 승인됨 (owner, 2026-08-07)
- 범위: retail_pos_app, retail_pos_server(타입만), ktpv5-dmarket-app, ktpv5-dmarket-web,
  ktpv5-api-docs(BACKLOG 기록만)

## 문제

매장 인터넷이 끊기면 멤버 QR 스캔(`member%%%<id>`)이 CRM 조회
(`/api/crm/member/search/id` → crm-server) 실패로 끝나 멤버를 카트에 붙일 수 없고,
따라서 포인트 적립이 통째로 유실된다. 판매 자체는 오프라인 완결인데 적립만 온라인
의존이다.

## 핵심 관찰 (조사 결과)

적립 파이프라인은 스캔 이후 전 구간이 이미 비동기·오프라인 허용·검증 내장이다:

1. `calculateInvoicePoints` (`retail_pos_server/src/v1/sale/sale.points.ts`)는 순수
   함수 — member 존재 여부·rows·payments·StoreSetting 적립률만 쓰고 CRM을 안 부른다.
   **member level도 안 쓴다** (level은 가격에만 영향).
2. 인보이스는 `memberId/Name/Level/PhoneLast4` + `pointsEarned` 스냅샷으로 로컬
   Postgres에 저장된다.
3. 업싱크는 `cloudId IS NULL` 스윕으로 인터넷 복구 시 자동 진행된다.
4. api-server `syncRetailSaleInvoice`가 `CrmInvoicePushOutbox`에 적립 이벤트를 적재하고,
   워커가 지수 백오프(최대 10회)로 crm-server에 푸시한다.
5. crm-server `sendInvoicePushController`가 **member 존재 검증 → 멱등 원장 삽입
   (`skipDuplicates`) → 잔액 증가 → 푸시 알림 발송**을 한 요청에서 처리한다.
   member가 없으면 적립 단계에서 throw → 알림도 안 나간다.

따라서 "hold했다가 싱크 시점에 검증 후 적립"은 **이미 존재**한다. 필요한 것은 딱
하나 — 오프라인일 때 스캔한 id로 **미검증 멤버를 카트에 붙이는 것을 허용**하는 것.
POS에 별도 재대조(reconcile) 로직은 만들지 않는다. 검증 지점은 CRM 한 곳으로 유지한다.

## 결정 사항 (owner 확정)

| 결정 | 내용 |
|---|---|
| 등급가(level price) | QR에 level을 실어 오프라인 폴백으로 사용. QR에 level이 없으면 **level 1 고정**. 온라인일 땐 CRM 조회값이 항상 우선(QR level 무시). |
| 바우처 | 오프라인 차단 현행 유지 (이미 구현, D-21). |
| 환불 | **현행 유지** — 일반 환불 오프라인 허용, 고객바우처 인보이스만 차단. 변경 없음. |
| 스캔 UX | 네트워크 실패 시 **자동 부착 + 오프라인 표시** (모달 없음). 온라인인데 "멤버 없음" 응답이면 현행대로 alert 거부. |
| 알림 지연 | 적립·푸시 알림이 인터넷 복구 시점에 도착하는 것을 수용 (메시지에 시제 표현 없음 확인). |

## 설계

### 1. QR 포맷 확장 (dmarket-app / dmarket-web)

`member%%%<id>` → `member%%%<id>%%%<level>`. level = 렌더 시점 멤버의 현재 등급(양의 정수).

- `ktpv5-dmarket-app/components/wallet/formatters.ts` — `buildMemberQrValue(memberId, level)`.
  호출부는 `MembershipCardSheet.tsx` 한 곳 (`user.level` 존재 확인됨, `types/model.ts:11`).
- `ktpv5-dmarket-web/components/auth/MemberQRCard.tsx` — 동일 확장.
  `types/model.ts` `LoggedUser`에 `level: number` 추가. crm-server `/auth/me`는 이미
  `level`을 select해 내려주므로 (`auth.service.ts` `getMeService`) 서버 변경 없음.

### 2. POS 앱 (retail_pos_app)

**파서.** `src/renderer/src/libs/member-qr.ts` 신설:

```ts
parseMemberQr(raw: string): { memberId: string; level: number | null } | null
```

- `member%%%` prefix가 아니면 null. id 빈 문자열이면 null.
- 세그먼트 2가 양의 정수 문자열이면 level, 아니면(없음/쓰레기) null.
- 세그먼트 3 이상은 무시 (전방 호환).

`invoice-search-scan.ts`의 member 분기는 prefix 뒤 전체가 아니라 **첫 세그먼트만**
memberId로 취하도록 수정 (한 줄 split). member-qr.ts를 import하지 않는다 — 이 파일의
node:test가 `--experimental-strip-types` + `.ts` 확장자 직접 임포트로 돌아서, 렌더러의
확장자 없는 상호 임포트를 물고 들어가면 테스트 실행이 깨진다. 한 줄 중복은 수용.

**스캔 분기.** `SaleScreen/index.tsx` `scanCallback`의 member 분기:

- `searchMemberById` 결과 `ok` → 현행대로 검증 멤버 부착.
- `!ok && status === 0` (네트워크 실패 — `libs/api.ts`가 네트워크 오류를
  `{ok:false, status:0}`으로 정규화) → 미검증 부착:
  `{ id, name: null, points: null, level: qrLevel ?? 1, phone_last4: null, unverified: true }`.
  등급가 재계산은 기존 `setMember` 경로 그대로 (level만 소비).
- `!ok && status !== 0` (온라인, 멤버 없음 등) → 현행대로 `alert(msg)` 거부.

**타입.** `SalesStore.helper.ts` `SaleMember`:
`name: string | null`, `points: number | null`, `unverified?: boolean` 추가.
`libs/sale/payload.types.ts` `MemberSnapshotPayload.name: string | null`.

**표시.** SaleScreen 탑바 멤버 버튼 라벨: `name`이 null이면
`Offline ****<id 뒷4자리>`. 그 외 UI는 무변경 —
CustomerScreen은 멤버를 렌더하지 않고, 영수증은 `memberName` null이면 멤버 줄을
생략하는 기존 가드가 있으며, PaymentModal의 `memberPointsBefore`는 이미
`?? null` 처리라 points null이 자연 흡수된다.

### 3. POS 서버 (retail_pos_server)

`src/v1/sale/sale.types.ts` `MemberSnapshotPayload.name: string | null` — 타입만.
생성 서비스는 이미 `payload.member?.name ?? null`이고 DB 컬럼도 nullable. 로직·싱크
무변경. `pointsEarned`는 member 존재만 보므로 미검증 멤버도 정상 계산된다.

### 4. 검증·적립·알림 (무변경)

기존 파이프라인이 그대로 "대조 후 적립"이다. 가짜/오타 id는 crm-server에서
`Member not found`로 거부되고 outbox가 10회 재시도 후 FAILED로 남는다(알림 미발송).

## 롤아웃 순서 (강제)

1. retail_pos_app 릴리즈 + retail_pos_server 배포. 단말은 부팅 시에만 자동 업데이트
   되므로 전 단말 재시작 확인 후 다음 단계로.
2. dmarket-app / dmarket-web에 level 탑재 배포. **순서를 뒤집으면 구버전 POS의
   인보이스 검색이 신형 QR(`id%%%level` 통째로 memberId 취급)에서 깨진다.**
   level 없는 구형 QR·실물 카드는 폴백(level 1)으로 계속 동작하므로 2단계는 급하지 않다.

## 수용한 트레이드오프 / BACKLOG 기록

- **QR level 자가신고**: 오프라인 한정으로 위조 QR이 등급가를 받을 수 있다. 온라인
  우선 조회로 노출면을 "오프라인 시간대 × 위조 QR"로 한정. 기존 보안 스탠스(LAN 신뢰)와
  일관. → BACKLOG 기록.
- **FAILED outbox 가시성 부재**: 적립 실패(가짜 id 포함)가 api-server
  `CrmInvoicePushOutbox`에 FAILED로만 남고 알림이 없다. 기존 갭이지만 이 기능으로 발생
  빈도가 늘 수 있다. → BACKLOG 기록 (프라임 디렉티브: 이번에 고치지 않는다).
- **오프라인 멤버는 이름·잔액 표시 불가**: id 뒷자리만 표시. 수용.
- **진짜 멤버의 등급 하향 직후 구형 캡처 QR 사용** 같은 엣지: 수용 (오프라인 한정).

## 테스트

- `member-qr` 파서 node:test (구형/신형/쓰레기 level/빈 id) —
  `scripts/tests/member-qr.test.ts`.
- `invoice-search-scan.test.ts`에 level 세그먼트 케이스 추가.
- `sale.points` 무변경 — 기존 테스트 그대로 통과해야 함.
- `TEST_CHECKLIST.md`에 수동 시나리오 추가: 인터넷 차단 → 스캔 → Offline 표시 확인 →
  판매 → 복구 → CRM 잔액·앱 푸시 확인, 그리고 위조 id 스캔 → FAILED outbox 확인.
