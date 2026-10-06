# Plan: companyId 하드코딩(=1) 제거 — DB의 cloudId를 단일 소스로

2026-08-03. 상태: **구현 완료** (build + node:test 64/64 통과). 수정 범위: **retail_pos_server만** (앱·api-server·crm-server 무수정).

## 배경

로컬 `Company` 테이블은 `id=1` 고정 + `cloudId`가 진짜 클라우드 회사 id
(`cloud.migrate.service.ts` company upsert). 그런데 세 곳이 로컬 id(=1)를
클라우드 id 자리에 쓰거나, cloudId 갱신을 빠뜨린다. company 1 하나뿐인 지금은
우연히 동작하지만, cloudId ≠ 1인 매장이 생기는 순간 전부 깨진다.

검증 완료(2026-08-03, 코드 재확인):
- crm-server는 `ktpv5-company` 헤더의 `id`를 그대로 클라우드 회사 id로 사용
  (`middleware.ts apiCompanyMiddleware` → `post.controller.ts` `/post/{id}/search/published`).
- api-server 업싱크(`device.sync.controller.ts`)는 payload의 companyId를
  **디바이스 키에서 푼 companyId로 덮어쓴다** → 클라우드 데이터는 오염된 적 없음.
- 로컬에서 companyId로 필터하는 쿼리 0건. 시리얼(`{shiftId}-{YYYYMMDD}-{S|P}{seq}`)에
  company 성분 없음. 렌더러는 타입 선언뿐. → 파급 없음.

## 변경 3건

1. **`src/v1/cloud/cloud.post.service.ts:14`**
   `JSON.stringify({ id: company.id, ... })` → `JSON.stringify({ id: company.cloudId, ... })`
   (post 피드가 잘못된 회사로 조회되던 실버그의 본체)

2. **`src/v1/shift/shift.service.ts:51`**
   `companyId: company.id` → `companyId: company.cloudId`
   (`company`가 이미 시그니처에 있어 컨트롤러 무수정. migrate 후에는
   `storeSetting.companyId`와 동일 값 — 3번이 그걸 보장)

3. **`src/v1/cloud/cloud.migrate.service.ts` StoreSetting upsert(288행 부근) update 블록**
   `update: { companyName: result.name }` → `update: { companyId: result.cloudId, companyName: result.name }`
   (기존 매장의 stale companyId가 migrate로 교정되도록. 이게 있어야 2번의 소스가 항상 신선함)

## 하지 않는 것

- 기존 `TerminalShift.companyId = 1` 로우 백필: 로컬에서 아무도 안 읽고,
  업싱크 시 api-server가 덮어쓰므로 불필요. 원하면 별도 SQL 한 줄
  (`UPDATE "TerminalShift" SET "companyId" = (SELECT "cloudId" FROM "Company" WHERE id=1)`).
- `Company.id=1` / `StoreSetting.id=1` 자체의 제거 — 단일 매장 전제는 유지 (CLAUDE.md 불변식).
- api-server / crm-server / 앱 수정 — 불필요 확인됨.

## 검증

1. `npm run build` (tsc) 통과.
2. `POST /api/cloud/migrate/item` 실행 → `SELECT "companyId" FROM "StoreSetting"` =
   `SELECT "cloudId" FROM "Company"` 확인.
3. `GET /api/cloud/post`가 해당 회사 포스트를 반환하는지 (cloudId ≠ 1 환경이 있다면 그걸로).
4. 쉬프트 오픈 → `SELECT "companyId" FROM "TerminalShift" ORDER BY id DESC LIMIT 1` = cloudId.

## 문서 후속 (코드와 별도 커밋)

- 루트 `CLAUDE.md`의 시리얼 표기 `{company}-{shift}-{terminal}-{seq}`는 실코드
  (`sale.create.service.ts:251`)와 다름 — `{shiftId}-{YYYYMMDD}-{S|P}{seq6}`로 교정.
- `prisma/schema.prisma` SaleInvoice.companyId 주석 `// 단일 법인 전제 (=1)` 갱신.
