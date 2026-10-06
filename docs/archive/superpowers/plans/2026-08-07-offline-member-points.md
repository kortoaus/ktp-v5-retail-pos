# 오프라인 멤버 포인트 적립 (hold & sync) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터넷 단절 시 멤버 QR의 id(+level)만으로 미검증 멤버를 카트에 붙여, 기존 업싱크→outbox→CRM 검증·멱등 적립 파이프라인이 복구 시점에 적립·푸시알림을 처리하게 한다.

**Architecture:** 스캔 시 CRM 조회가 네트워크 실패(status 0)면 QR의 id/level로 미검증 멤버를 부착한다. QR 포맷을 `member%%%<id>%%%<level>`로 확장(dmarket-app/web), POS 파서는 level 세그먼트에 내성 있게. 서버·적립 파이프라인 로직은 무변경(타입 완화만). 스펙: `docs/superpowers/specs/2026-08-07-offline-member-points-design.md`.

**Tech Stack:** React 19 (electron-vite), zustand, node:test(`--experimental-strip-types`, plain assert 스타일), Express 5 + tsc, Expo RN(dmarket-app), Next.js(dmarket-web).

## Global Constraints

- 리포 4개에 걸침: `ktpv5-pos-retail`(app+server), `ktpv5-dmarket-app`, `ktpv5-dmarket-web`, `ktpv5-api-docs`(BACKLOG만). 커밋은 각 리포 안에서만, 전부 main.
- `retail_pos_app` 렌더러는 `service/*.service.ts` 외 HTTP 금지, `as any`/`@ts-ignore` 금지, strict TS.
- `invoice-search-scan.ts`는 다른 렌더러 모듈을 import하면 안 됨 — node 테스트가 `.ts` 확장자 직접 임포트로 돌아 확장자 없는 상호 임포트가 깨짐. `member-qr.ts`도 같은 이유로 **import 없는 독립 모듈**로 유지.
- 온라인일 땐 CRM 조회값이 항상 우선 — QR level은 status 0 폴백에서만 사용, 없으면 level 1.
- api-server·crm-server는 절대 수정하지 않는다.

---

### Task 1: member-qr 파서 (retail_pos_app, TDD)

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/member-qr.ts`
- Test: `retail_pos_app/scripts/tests/member-qr.test.ts`

**Interfaces:**
- Produces: `parseMemberQr(raw: string): { memberId: string; level: number | null } | null`, `MEMBER_QR_PREFIX = "member%%%"`

- [ ] **Step 1: 실패하는 테스트 작성** (`scripts/tests/member-qr.test.ts`, 기존 invoice-search-scan.test.ts와 같은 plain-assert 스타일)

```ts
import assert from "node:assert/strict";
import { parseMemberQr } from "../../src/renderer/src/libs/member-qr.ts";

// 구형 QR — level 없음
assert.deepEqual(parseMemberQr("member%%%crm-42"), {
  memberId: "crm-42",
  level: null,
});

// 신형 QR — level 탑재
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3"), {
  memberId: "crm-42",
  level: 3,
});

// 쓰레기 level → null
assert.deepEqual(parseMemberQr("member%%%crm-42%%%abc"), {
  memberId: "crm-42",
  level: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%0"), {
  memberId: "crm-42",
  level: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%-1"), {
  memberId: "crm-42",
  level: null,
});

// 세그먼트 3+ 무시 (전방 호환)
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3%%%extra"), {
  memberId: "crm-42",
  level: 3,
});

// id 없음 / prefix 불일치 → null
assert.equal(parseMemberQr("member%%%"), null);
assert.equal(parseMemberQr("receipt%%%INV-1"), null);
assert.equal(parseMemberQr("plain-barcode"), null);

console.log("member-qr tests passed");
```

- [ ] **Step 2: 실패 확인**

Run: `cd retail_pos_app && node --experimental-strip-types scripts/tests/member-qr.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 최소 구현** (`src/renderer/src/libs/member-qr.ts` — import 없는 독립 모듈)

```ts
export const MEMBER_QR_PREFIX = "member%%%";

export interface ParsedMemberQr {
  memberId: string;
  level: number | null;
}

// member%%%<id>[%%%<level>[...]] — level 은 양의 정수만 인정, 그 외 null.
// 세그먼트 3 이상은 무시(전방 호환). 오프라인 폴백 전용 — 온라인 조회값이 항상 우선.
export function parseMemberQr(raw: string): ParsedMemberQr | null {
  if (!raw.startsWith(MEMBER_QR_PREFIX)) return null;
  const segments = raw.slice(MEMBER_QR_PREFIX.length).split("%%%");
  const memberId = segments[0];
  if (!memberId) return null;
  const levelRaw = segments[1];
  const level =
    levelRaw != null && /^[1-9]\d*$/.test(levelRaw) ? Number(levelRaw) : null;
  return { memberId, level };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --experimental-strip-types scripts/tests/member-qr.test.ts`
Expected: `member-qr tests passed`

- [ ] **Step 5: 커밋 없음 — Task 2와 묶어서 커밋**

### Task 2: invoice-search-scan level 내성 (retail_pos_app, TDD)

**Files:**
- Modify: `retail_pos_app/src/renderer/src/libs/invoice-search-scan.ts:17-22`
- Test: `retail_pos_app/scripts/tests/invoice-search-scan.test.ts`

**Interfaces:**
- Produces: `parseInvoiceSearchScan` — 기존 시그니처 유지, member 분기만 첫 세그먼트 취함

- [ ] **Step 1: 실패하는 테스트 추가** (기존 파일의 member 케이스 아래)

```ts
// level 세그먼트가 붙은 신형 QR — id 첫 세그먼트만 취한다
assert.deepEqual(parseInvoiceSearchScan("member%%%crm-42%%%3"), {
  type: "member",
  memberId: "crm-42",
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-strip-types scripts/tests/invoice-search-scan.test.ts`
Expected: FAIL (memberId가 `"crm-42%%%3"`)

- [ ] **Step 3: 구현** — member 분기를 다음으로 교체 (member-qr import 금지, 한 줄 split 중복 수용)

```ts
  if (payload.startsWith(MEMBER_QR_PREFIX)) {
    return {
      type: "member",
      memberId: payload.slice(MEMBER_QR_PREFIX.length).split("%%%")[0],
    };
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --experimental-strip-types scripts/tests/invoice-search-scan.test.ts`
Expected: `invoice-search-scan tests passed`

- [ ] **Step 5: 커밋** (pos-retail 리포)

```bash
git add retail_pos_app/src/renderer/src/libs/member-qr.ts \
        retail_pos_app/scripts/tests/member-qr.test.ts \
        retail_pos_app/src/renderer/src/libs/invoice-search-scan.ts \
        retail_pos_app/scripts/tests/invoice-search-scan.test.ts
git commit -m "feat(app): level-tolerant member QR parsing (member%%%id%%%level)"
```

### Task 3: SaleMember/페이로드 타입 완화 + 오프라인 부착 + 탑바 표시 (retail_pos_app)

**Files:**
- Modify: `retail_pos_app/src/renderer/src/store/SalesStore.helper.ts:10-16` (SaleMember)
- Modify: `retail_pos_app/src/renderer/src/libs/sale/payload.types.ts:39-43` (MemberSnapshotPayload)
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/index.tsx:96-119` (스캔 분기), `:325` (탑바 라벨)

**Interfaces:**
- Consumes: Task 1의 `parseMemberQr`
- Produces: `SaleMember { id: string; name: string | null; level: number; phone_last4: string | null; points: number | null; unverified?: boolean }`, `MemberSnapshotPayload.name: string | null`

- [ ] **Step 1: SaleMember 타입 완화** (`SalesStore.helper.ts`)

```ts
export interface SaleMember {
  id: string;
  name: string | null; // null ⟺ 오프라인 미검증 부착 (unverified)
  level: number;
  phone_last4: string | null;
  points: number | null;
  unverified?: boolean;
}
```

- [ ] **Step 2: 페이로드 타입 완화** (`payload.types.ts` MemberSnapshotPayload)

```ts
export interface MemberSnapshotPayload {
  id: string; // CRM member id (external ref)
  name: string | null; // null = 오프라인 미검증 부착
  level: number; // 할인 적용된 레벨 (스냅샷)
  phoneLast4: string | null;
}
```

- [ ] **Step 3: 스캔 분기 교체** (`SaleScreen/index.tsx`) — 기존 `rawBarcode.startsWith("member%%%")` 블록을 다음으로. 파일 상단에 `import { parseMemberQr } from "../../libs/member-qr";` 추가.

```ts
      // Search Member
      const memberQr = parseMemberQr(rawBarcode);
      if (memberQr) {
        try {
          setLoading(true);
          const { ok, msg, status, result } = await searchMemberById(
            memberQr.memberId,
          );
          if (ok && result) {
            setMember({
              id: result.id,
              name: result.name,
              level: result.level,
              phone_last4: result.phone_last4,
              points: result.points,
            });
          } else if (status === 0) {
            // 네트워크 단절 — QR 의 id/level 로 미검증 부착.
            // 적립은 업싱크 시 CRM 이 member 존재를 검증한 뒤 처리된다.
            setMember({
              id: memberQr.memberId,
              name: null,
              level: memberQr.level ?? 1,
              phone_last4: null,
              points: null,
              unverified: true,
            });
          } else {
            window.alert(msg);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }

        return;
      }
```

- [ ] **Step 4: 탑바 라벨** (`SaleScreen/index.tsx:325`)

```tsx
            label={
              member
                ? (member.name ?? `Offline ****${member.id.slice(-4)}`)
                : "Member"
            }
```

- [ ] **Step 5: 타입체크로 파급 확인**

Run: `cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json`
Expected: 에러 0. `member.name`/`member.points`를 non-null로 쓰는 곳이 나오면 해당 지점에서 null 처리(표시부는 `?? "-"` 유형) 후 재실행. 알려진 안전 지점: PaymentModal은 `activeMember?.points ?? null`, 영수증은 `memberName` truthy 가드, CustomerScreen은 멤버 미사용, MemberSearchModal은 non-null 값 대입이라 그대로 호환.

- [ ] **Step 6: 커밋**

```bash
git add retail_pos_app/src/renderer/src
git commit -m "feat(app): attach unverified member offline for deferred point accrual"
```

### Task 4: 서버 타입 완화 (retail_pos_server)

**Files:**
- Modify: `retail_pos_server/src/v1/sale/sale.types.ts:15-20`

**Interfaces:**
- Produces: `MemberSnapshotPayload.name: string | null` — 서버 로직은 이미 `payload.member?.name ?? null`이라 컴파일 파급 없음이 기대치

- [ ] **Step 1: 타입 수정**

```ts
export interface MemberSnapshotPayload {
  id: string;
  name: string | null; // null = POS 오프라인 미검증 부착 (스펙 2026-08-07 참조)
  level: number;
  phoneLast4: string | null;
}
```

- [ ] **Step 2: 빌드 + 기존 포인트 테스트 회귀 확인**

Run: `cd retail_pos_server && npm run build && node --test dist/v1/sale/sale.points.test.js dist/v1/sale/sale.refund.points.test.js`
Expected: 빌드 성공, 테스트 전부 pass (points 로직 무변경 확인)

- [ ] **Step 3: 커밋**

```bash
git add retail_pos_server/src/v1/sale/sale.types.ts
git commit -m "feat(server): allow null member name (offline unverified attach)"
```

### Task 5: TEST_CHECKLIST 수동 시나리오 (pos-retail)

**Files:**
- Modify: `TEST_CHECKLIST.md` (기존 섹션 형식을 먼저 읽고 맞출 것)

- [ ] **Step 1: 시나리오 추가** — 기존 문서 형식(한국어, 체크박스)에 맞춰 "오프라인 멤버 적립" 섹션 추가. 내용:
  1. 인터넷 차단(랜선/업링크) → 멤버 QR 스캔 → 탑바에 `Offline ****뒷4자리` 표시 확인
  2. 판매 완결(현금/카드) → 영수증에 멤버 줄 미출력 확인
  3. 인터넷 복구 → 다음 판매 또는 서버 재시작으로 싱크 트리거 → CRM 잔액 반영·앱 푸시 도착 확인
  4. (음성) 온라인 상태에서 존재하지 않는 멤버 QR 스캔 → alert 거부(오프라인 부착 아님) 확인
  5. (음성) 오프라인에서 위조/오타 id 스캔 → 판매는 되지만 복구 후 적립 안 됨, api-server `CrmInvoicePushOutbox`에 FAILED 잔류 확인
- [ ] **Step 2: 커밋**

```bash
git add TEST_CHECKLIST.md
git commit -m "docs: add offline member accrual scenarios to test checklist"
```

### Task 6: dmarket-app QR level 탑재

**Files:**
- Modify: `ktpv5-dmarket-app/components/wallet/formatters.ts:47-49`
- Modify: `ktpv5-dmarket-app/components/wallet/MembershipCardSheet.tsx:51`

**Interfaces:**
- Produces: `buildMemberQrValue(memberId: string | number, level?: number | null): string`

- [ ] **Step 1: 브랜치 확인** — `git -C /Users/dev-m1/ktpv5/ktpv5-dmarket-app status`; main이 아니거나 dirty면 중단하고 owner에게 보고.
- [ ] **Step 2: formatters 수정**

```ts
export const buildMemberQrValue = (
  memberId: string | number,
  level?: number | null,
) => {
  const base = `member%%%${memberId}`;
  return level != null && Number.isInteger(level) && level >= 1
    ? `${base}%%%${level}`
    : base;
};
```

- [ ] **Step 3: 호출부 수정** (`MembershipCardSheet.tsx:51`) — `value={buildMemberQrValue(user.id, user.level)}`. `user.level`은 `types/model.ts:11`에 존재.
- [ ] **Step 4: 타입체크** — `cd ktpv5-dmarket-app && npx tsc --noEmit` (tsconfig 있으면; 없으면 skip하고 보고)
- [ ] **Step 5: 커밋**

```bash
git add components/wallet/formatters.ts components/wallet/MembershipCardSheet.tsx
git commit -m "feat: embed member level in membership QR for POS offline fallback"
```

### Task 7: dmarket-web QR level 탑재

**Files:**
- Modify: `ktpv5-dmarket-web/types/model.ts:3-12` (LoggedUser)
- Modify: `ktpv5-dmarket-web/components/auth/MemberQRCard.tsx`

- [ ] **Step 1: 브랜치 확인** — `git -C /Users/dev-m1/ktpv5/ktpv5-dmarket-web status`; main 아니거나 dirty면 중단·보고.
- [ ] **Step 2: LoggedUser에 level 추가** — 사전에 `/auth/me`와 로그인 응답 모두 level을 내려주는지 crm-server에서 확인(로그인 응답이 다르면 `level?: number`로 완화하고 렌더 가드에 의존).

```ts
export type LoggedUser = {
  id: string;
  name: string;
  phone: string; // last 4 digits
  email: string | null;
  dob: string | null; // ISO date string
  gender: string; // n: none, m: male, f: female
  companyId: number;
  companyName: string;
  level: number;
};
```

- [ ] **Step 3: MemberQRCard 수정**

```tsx
export default function MemberQRCard({
  user: { id, name, phone, level },
}: {
  user: LoggedUser;
}) {
  const qrValue =
    Number.isInteger(level) && level >= 1
      ? `member%%%${id}%%%${level}`
      : `member%%%${id}`;
```

- [ ] **Step 4: 타입체크** — `cd ktpv5-dmarket-web && npx tsc --noEmit`
- [ ] **Step 5: 커밋**

```bash
git add types/model.ts components/auth/MemberQRCard.tsx
git commit -m "feat: embed member level in membership QR for POS offline fallback"
```

### Task 8: BACKLOG 기록 (ktpv5-api-docs)

**Files:**
- Modify: `ktpv5-api-docs/BACKLOG.md` (기존 섹션·상태 표기 형식을 먼저 읽고 맞출 것)

- [ ] **Step 1: 기록 2건 추가** (상태 `열림`, 고치지 않고 기록만 — 프라임 디렉티브)
  1. **QR level 자가신고 수용**: POS 오프라인 폴백용으로 멤버 QR에 level 탑재
     (2026-08-07, 스펙 `ktpv5-pos-retail/docs/superpowers/specs/2026-08-07-offline-member-points-design.md`).
     오프라인 한정으로 위조 QR이 등급가를 받을 수 있음 — owner가 수용 결정. 온라인 시 CRM 조회 우선.
  2. **CrmInvoicePushOutbox FAILED 가시성 부재**: 적립 푸시 10회 실패 시 FAILED로만 남고
     알림·대시보드 없음. 오프라인 미검증 부착 도입으로 가짜 id 유입 경로가 생겨 발생 빈도
     증가 가능. 모니터링 필요.
- [ ] **Step 2: 커밋**

```bash
git add BACKLOG.md
git commit -m "docs: record QR level self-declaration + FAILED outbox visibility findings"
```

### Task 9: 최종 검증 (pos-retail)

- [ ] **Step 1: 앱 전체 검증**

Run: `cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json && node --experimental-strip-types scripts/tests/member-qr.test.ts && node --experimental-strip-types scripts/tests/invoice-search-scan.test.ts`
Expected: 전부 통과

- [ ] **Step 2: 서버 전체 검증**

Run: `cd retail_pos_server && npm run build && node --test dist/v1/sale/sale.points.test.js dist/v1/sale/sale.refund.points.test.js dist/v1/sale/sale.doc-counter.test.js`
Expected: 빌드 성공, 테스트 전부 pass

- [ ] **Step 3: 4개 리포 `git status` 클린 + `git log --oneline` 커밋 확인.** 릴리즈(태그/push)는 하지 않는다 — owner가 별도 결정.
