# Member Keyword Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the POS customer/member last-3-digits search with a keyword search that matches `Member.name contains keyword OR Member.phone_last4 contains digits`.

**Architecture:** The CRM server owns member search semantics, so add `/device/member/search/keyword` there and remove the old `/device/member/search/phone-last3` route. The POS local server should proxy `/api/crm/member/search/keyword` to CRM, and the Electron renderer should update `MemberSearchModal` to send a free-form keyword instead of a 3-digit-only value. Keep exact phone and id search routes unchanged because QR/member id flows still depend on them.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7 generated client, React 19, Electron/Vite, Node `node:test` for CRM helper tests.

---

## File Structure

**CRM server repo:** `/Users/dev/ktpv5/ktpv5-crm-server`

- Create: `src/libs/memberKeywordSearch.ts`
  - Pure helper for keyword normalization and Prisma `where` construction.
- Create: `src/libs/memberKeywordSearch.test.ts`
  - Node test that verifies name and phone-tail OR search shape.
- Modify: `src/device/member/member.service.ts`
  - Replace `searchMembersByPhoneLast3` with `searchMembersByKeyword`.
- Modify: `src/device/member/member.controller.ts`
  - Replace `searchMembersByPhoneLast3Controller` with `searchMembersByKeywordController`.
- Modify: `src/device/member/member.routes.ts`
  - Remove `/search/phone-last3`; add `/search/keyword`.
- Delete: `src/libs/memberPhoneLast3.ts`
  - No longer needed after route removal.
- Delete: `src/libs/memberPhoneLast3.test.ts`
  - No longer relevant after route removal.

**POS retail repo:** `/Users/dev/ktpv5/ktpv5-pos-retail`

- Modify: `retail_pos_server/src/v1/crm/crm.service.ts`
  - Replace `searchMembersByPhoneLast3Service` with `searchMembersByKeywordService`.
- Modify: `retail_pos_server/src/v1/crm/crm.controller.ts`
  - Replace controller handler.
- Modify: `retail_pos_server/src/v1/crm/crm.router.ts`
  - Replace `/member/search/phone-last3` with `/member/search/keyword`.
- Modify: `retail_pos_app/src/renderer/src/service/crm.service.ts`
  - Replace `searchMembersByPhoneLast3` with `searchMembersByKeyword`.
- Modify: `retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`
  - Change search input from 3-digit phone-only to free-form keyword.
  - Adjust layout so result panel is narrower and keyboard panel is wider.
  - Use Korean keyboard as initial layout so staff can search Korean names; numbers remain available through keyboard numpad toggle.
- Search-check only: `retail_pos_app/src/renderer/src/components/SaleInvoiceSearchPanel.tsx`
  - It imports `MemberSearchModal`, but no direct service change should be needed.

---

### Task 1: CRM Helper Test

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberKeywordSearch.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberKeywordSearch.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberKeywordSearch.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemberKeywordSearchWhere,
  normalizeMemberKeywordSearch,
} from "./memberKeywordSearch.js";

test("normalizeMemberKeywordSearch trims text and extracts digits", () => {
  assert.deepEqual(normalizeMemberKeywordSearch("  Kim 123  "), {
    keyword: "Kim 123",
    digits: "123",
  });
});

test("normalizeMemberKeywordSearch rejects blank keywords", () => {
  assert.equal(normalizeMemberKeywordSearch("   "), null);
});

test("buildMemberKeywordSearchWhere searches active company members by name or phone tail", () => {
  assert.deepEqual(buildMemberKeywordSearchWhere(7, " Kim 123 "), {
    companyId: 7,
    archived: false,
    OR: [
      { name: { contains: "Kim 123", mode: "insensitive" } },
      { phone_last4: { contains: "123" } },
    ],
  });
});

test("buildMemberKeywordSearchWhere only searches name when keyword has no digits", () => {
  assert.deepEqual(buildMemberKeywordSearchWhere(7, "민수"), {
    companyId: 7,
    archived: false,
    OR: [{ name: { contains: "민수", mode: "insensitive" } }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build fails because `./memberKeywordSearch.js` cannot be resolved or exported functions do not exist yet.

- [ ] **Step 3: Implement the helper**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberKeywordSearch.ts`:

```ts
export interface NormalizedMemberKeywordSearch {
  keyword: string;
  digits: string;
}

export function normalizeMemberKeywordSearch(
  value: unknown,
): NormalizedMemberKeywordSearch | null {
  if (typeof value !== "string") return null;

  const keyword = value.trim().replace(/\s+/g, " ");
  if (!keyword) return null;

  return {
    keyword,
    digits: keyword.replace(/\D/g, ""),
  };
}

export function buildMemberKeywordSearchWhere(companyId: number, value: unknown) {
  const normalized = normalizeMemberKeywordSearch(value);
  if (!normalized) return null;

  const or: Record<string, unknown>[] = [
    {
      name: {
        contains: normalized.keyword,
        mode: "insensitive" as const,
      },
    },
  ];

  if (normalized.digits) {
    or.push({
      phone_last4: {
        contains: normalized.digits,
      },
    });
  }

  return {
    companyId,
    archived: false,
    OR: or,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: existing CRM tests plus `memberKeywordSearch.test.ts` pass.

---

### Task 2: CRM Device Member Keyword Endpoint

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`
- Delete: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.ts`
- Delete: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.test.ts`

- [ ] **Step 1: Update service imports**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`, add:

```ts
import { buildMemberKeywordSearchWhere } from "../../libs/memberKeywordSearch";
```

- [ ] **Step 2: Replace the search result type name**

Replace:

```ts
type MemberPhoneLast3SearchResult = {
  id: string;
  companyId: number;
  phoneLast3: string;
  name: string;
  level: number;
  points: number;
};
```

with:

```ts
type MemberKeywordSearchResult = {
  id: string;
  companyId: number;
  phoneLast3: string;
  name: string;
  level: number;
  points: number;
};
```

Keep `phoneLast3` in the response for POS compatibility. The DB column is misnamed and stores the phone tail; the UI does not need the exact column name.

- [ ] **Step 3: Replace `searchMembersByPhoneLast3` implementation**

Replace the whole `searchMembersByPhoneLast3` function with:

```ts
export const searchMembersByKeyword = async (
  companyId: number,
  keyword: string,
) => {
  try {
    const where = buildMemberKeywordSearchWhere(companyId, keyword);
    if (!where) {
      return {
        ok: false,
        msg: "Enter member name or phone digits",
        result: null,
      };
    }

    const members = await db.member.findMany({
      where,
      select: {
        id: true,
        companyId: true,
        phone_last4: true,
        name: true,
        level: true,
        points: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    });

    const result: MemberKeywordSearchResult[] = members.map((member) => ({
      id: member.id,
      companyId: member.companyId,
      phoneLast3: member.phone_last4 ?? "",
      name: member.name,
      level: member.level,
      points: member.points,
    }));

    return {
      ok: true,
      msg: result.length > 0 ? "Members found" : "Member not found",
      result,
    };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      msg: "Internal server error",
      result: null,
    };
  }
};
```

- [ ] **Step 4: Update controller imports**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`, replace:

```ts
import { normalizeMemberPhoneLast3Search } from "../../libs/memberPhoneLast3";
import {
  createMember,
  getMemberById,
  searchMemberByPhone,
  searchMembersByPhoneLast3,
} from "./member.service";
```

with:

```ts
import {
  createMember,
  getMemberById,
  searchMemberByPhone,
  searchMembersByKeyword,
} from "./member.service";
```

- [ ] **Step 5: Replace controller function**

Replace `searchMembersByPhoneLast3Controller` with:

```ts
export async function searchMembersByKeywordController(
  req: Request,
  res: Response,
) {
  try {
    const companyId = res.locals.companyId;
    if (!companyId) {
      res
        .status(401)
        .json({ ok: false, msg: "Company not found", result: null });
      return;
    }

    const keyword =
      typeof req.body?.keyword === "string" ? req.body.keyword.trim() : "";
    if (!keyword) {
      res.status(400).json({
        ok: false,
        msg: "Enter member name or phone digits",
        result: null,
      });
      return;
    }

    const result = await searchMembersByKeyword(companyId, keyword);
    res.status(200).json(result);
    return;
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ ok: false, msg: "Internal server error", result: null });
    return;
  }
}
```

- [ ] **Step 6: Update routes**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`, replace imports with:

```ts
import {
  createMemberController,
  getMemberByIdController,
  searchMemberController,
  searchMembersByKeywordController,
} from "./member.controller";
import { deviceMiddleware } from "../../middleware";
```

Replace:

```ts
memberRouter.route("/search/phone-last3").post(searchMembersByPhoneLast3Controller);
```

with:

```ts
memberRouter.route("/search/keyword").post(searchMembersByKeywordController);
```

- [ ] **Step 7: Delete obsolete last3 helper files**

Delete:

```text
/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.ts
/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.test.ts
```

- [ ] **Step 8: Verify no old route references remain in CRM server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
rg "phone-last3|searchMembersByPhoneLast3|MemberPhoneLast3|memberPhoneLast3"
```

Expected: no matches.

- [ ] **Step 9: Run CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: TypeScript build passes and all `dist/libs/*.test.js` tests pass.

---

### Task 3: POS Local Server Proxy Route

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.router.ts`

- [ ] **Step 1: Replace service function**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`, replace:

```ts
export async function searchMembersByPhoneLast3Service(data: {
  phoneLast3: string;
}) {
  try {
    const result = await crmApiService.post(
      "/device/member/search/phone-last3",
      data,
    );
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching members:", e);
    throw new InternalServerException("Internal server error");
  }
}
```

with:

```ts
export async function searchMembersByKeywordService(data: {
  keyword: string;
}) {
  try {
    const result = await crmApiService.post(
      "/device/member/search/keyword",
      data,
    );
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching members:", e);
    throw new InternalServerException("Internal server error");
  }
}
```

- [ ] **Step 2: Replace controller references**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.controller.ts`, replace the import list with:

```ts
import {
  createMemberService,
  searchMembersByKeywordService,
  searchMemberByIdService,
  searchMemberService,
} from "./crm.service";
```

Replace:

```ts
export async function searchMembersByPhoneLast3Controller(
  req: Request,
  res: Response,
) {
  const result = await searchMembersByPhoneLast3Service(req.body);
  res.json(result);
}
```

with:

```ts
export async function searchMembersByKeywordController(
  req: Request,
  res: Response,
) {
  const result = await searchMembersByKeywordService(req.body);
  res.json(result);
}
```

- [ ] **Step 3: Replace local router path**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.router.ts`, replace imports with:

```ts
import {
  createMemberController,
  searchMembersByKeywordController,
  searchMemberByIdController,
  searchMemberController,
} from "./crm.controller";
```

Replace:

```ts
crmRouter.post(
  "/member/search/phone-last3",
  searchMembersByPhoneLast3Controller,
);
```

with:

```ts
crmRouter.post(
  "/member/search/keyword",
  searchMembersByKeywordController,
);
```

- [ ] **Step 4: Verify no old local server references remain**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg "phone-last3|searchMembersByPhoneLast3" retail_pos_server/src/v1/crm
```

Expected: no matches.

---

### Task 4: POS Renderer Service

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`

- [ ] **Step 1: Replace renderer search service**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`, replace:

```ts
export async function searchMembersByPhoneLast3(
  phoneLast3: string,
): Promise<ApiResponse<MemberSearchResult[]>> {
  return apiService.post<MemberSearchResult[]>(
    "/api/crm/member/search/phone-last3",
    { phoneLast3 },
  );
}
```

with:

```ts
export async function searchMembersByKeyword(
  keyword: string,
): Promise<ApiResponse<MemberSearchResult[]>> {
  return apiService.post<MemberSearchResult[]>(
    "/api/crm/member/search/keyword",
    { keyword },
  );
}
```

- [ ] **Step 2: Verify renderer service has no old last3 function**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg "searchMembersByPhoneLast3|phone-last3" retail_pos_app/src/renderer/src/service/crm.service.ts
```

Expected: no matches.

---

### Task 5: MemberSearchModal Keyword UI

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`

- [ ] **Step 1: Update imports**

Replace:

```ts
import {
  createMember,
  MemberSearchResult,
  searchMembersByPhoneLast3,
} from "../service/crm.service";
```

with:

```ts
import {
  createMember,
  MemberSearchResult,
  searchMembersByKeyword,
} from "../service/crm.service";
```

- [ ] **Step 2: Rename search state**

Replace:

```ts
const [searchPhone, setSearchPhone] = useState("");
```

with:

```ts
const [searchKeyword, setSearchKeyword] = useState("");
```

Update all `searchPhone` references in this component to `searchKeyword`.

- [ ] **Step 3: Replace search validation**

Replace the beginning of `handleSearch`:

```ts
const phoneLast3 = searchPhone.replace(/[^0-9]/g, "").slice(0, 3);
setSearchPhone(phoneLast3);
if (!/^\d{3}$/.test(phoneLast3)) {
  setSearchResults([]);
  setSearchError("Enter last 3 digits");
  setSearched(true);
  return;
}
```

with:

```ts
const keyword = searchKeyword.trim().replace(/\s+/g, " ");
setSearchKeyword(keyword);
if (!keyword) {
  setSearchResults([]);
  setSearchError("Enter member name or phone digits");
  setSearched(true);
  return;
}
```

Replace:

```ts
const res = await searchMembersByPhoneLast3(phoneLast3);
```

with:

```ts
const res = await searchMembersByKeyword(keyword);
```

Update the hook dependency from `[searchPhone]` to `[searchKeyword]`.

- [ ] **Step 4: Update SearchTab prop names**

Replace `SearchTabProps` fields:

```ts
phone: string;
setPhone: (v: string) => void;
```

with:

```ts
keyword: string;
setKeyword: (v: string) => void;
```

Update the `SearchTab` parameter names and references accordingly.

- [ ] **Step 5: Pass keyword props from modal**

Replace:

```tsx
<SearchTab
  phone={searchPhone}
  setPhone={(v) =>
    setSearchPhone(v.replace(/[^0-9]/g, "").slice(0, 3))
  }
  loading={searchLoading}
  error={searchError}
  searched={searched}
  searchResults={searchResults}
  onSearch={handleSearch}
  onSelect={handleSelectSearchResult}
/>
```

with:

```tsx
<SearchTab
  keyword={searchKeyword}
  setKeyword={setSearchKeyword}
  loading={searchLoading}
  error={searchError}
  searched={searched}
  searchResults={searchResults}
  onSearch={handleSearch}
  onSelect={handleSelectSearchResult}
/>
```

- [ ] **Step 6: Update search layout proportions**

In `SearchTab`, replace:

```tsx
<div className="grid grid-cols-[minmax(0,1fr)_420px] gap-4 p-4">
```

with:

```tsx
<div className="grid grid-cols-[360px_minmax(560px,1fr)] gap-4 p-4">
```

This makes the result/input panel narrower and gives the keyboard side more width for Korean/English/numpad layouts.

- [ ] **Step 7: Update search input display**

Replace the input display block:

```tsx
<span className="text-gray-400 text-lg">📱</span>
<div className="flex-1 text-lg min-h-[28px]">
  {phone || <span className="text-gray-400">Last 3 digits</span>}
</div>
{phone && (
  <button
    type="button"
    onPointerDown={() => setPhone("")}
    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
  >
    ✕
  </button>
)}
```

with:

```tsx
<span className="text-gray-400 text-lg">🔎</span>
<div className="flex-1 text-lg min-h-[28px] truncate">
  {keyword || (
    <span className="text-gray-400">Name or phone digits</span>
  )}
</div>
{keyword && (
  <button
    type="button"
    onPointerDown={() => setKeyword("")}
    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
  >
    ✕
  </button>
)}
```

- [ ] **Step 8: Update search button disabled condition and helper text**

Replace:

```tsx
disabled={!/^\d{3}$/.test(phone) || loading}
```

with:

```tsx
disabled={!keyword.trim() || loading}
```

Replace:

```tsx
Enter customer's last 3 digits
```

with:

```tsx
Enter customer name or phone digits
```

- [ ] **Step 9: Update keyboard behavior**

Replace:

```tsx
<OnScreenKeyboard
  key="search-phone"
  value={phone}
  onChange={(v) => setPhone(v.replace(/[^0-9]/g, "").slice(0, 3))}
  onEnter={onSearch}
  initialLayout="numpad"
  className="shrink-0"
/>
```

with:

```tsx
<OnScreenKeyboard
  key="search-keyword"
  value={keyword}
  onChange={setKeyword}
  onEnter={onSearch}
  initialLayout="korean"
  className="shrink-0"
/>
```

- [ ] **Step 10: Update modal title/copy**

Replace:

```tsx
<h2 className="text-lg font-bold">Member</h2>
```

with:

```tsx
<h2 className="text-lg font-bold">Customer Search</h2>
```

Keep the tab label `New Member` unchanged.

- [ ] **Step 11: Verify no old renderer references remain**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg "searchMembersByPhoneLast3|phone-last3|Last 3 digits|last 3 digits" retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx retail_pos_app/src/renderer/src/service/crm.service.ts
```

Expected: no matches.

---

### Task 6: Cross-Repo Build Verification

**Files:**
- No source edits unless a compile error points to a specific file.

- [ ] **Step 1: Build and test CRM server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: command exits 0. It runs `npm run build` and `node --test dist/libs/*.test.js`.

- [ ] **Step 2: Build POS local server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: command exits 0.

- [ ] **Step 3: Build POS app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: command exits 0.

- [ ] **Step 4: Final reference search**

Run:

```bash
cd /Users/dev/ktpv5
rg "phone-last3|searchMembersByPhoneLast3|normalizeMemberPhoneLast3Search|memberPhoneLast3" ktpv5-crm-server/src ktpv5-pos-retail/retail_pos_server/src/v1/crm ktpv5-pos-retail/retail_pos_app/src/renderer/src
```

Expected: no matches.

- [ ] **Step 5: Review dirty worktrees**

Run:

```bash
git -C /Users/dev/ktpv5/ktpv5-crm-server status --short
git -C /Users/dev/ktpv5/ktpv5-pos-retail status --short
```

Expected:
- CRM server shows only the keyword search files changed/deleted.
- POS retail shows the CRM/member search files changed.
- POS retail may also show pre-existing Sale Invoice tender-column edits from an earlier session; do not revert or mix them into this task unless the user explicitly asks.

---

## Manual QA Script

After both servers and the Electron app are running:

1. Open Sale screen.
2. Tap `Member`.
3. Search by a known customer name fragment, for example `Kim`.
4. Confirm matching customer rows appear.
5. Search by phone ending fragment, for example `123`.
6. Confirm rows with `***123` appear.
7. Select a result.
8. Confirm Sale top bar shows the member name and cart prices recalculate for that member level.
9. Scan a `member%%%{id}` QR payload.
10. Confirm QR member attach still works through `/search/id`.
11. Open Invoice Search member filter.
12. Confirm the same keyword modal works there and selecting a member filters invoices by member id.

---

## New Session First Message

Copy this as the first message in the implementation session:

```text
Use the plan at /Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/plans/2026-05-18-member-keyword-search.md.

Implement the customer/member keyword search change across ktpv5-crm-server and ktpv5-pos-retail. Follow the plan task-by-task. Do not touch unrelated Sale Invoice tender-column changes already present in ktpv5-pos-retail. Use Superpowers actively, start with the required execution skill, and verify with crm-server npm test, POS server npm run build, and POS app npm run build.
```
