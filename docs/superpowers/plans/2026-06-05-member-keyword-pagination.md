# Member Keyword Search Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side pagination to CRM member keyword search and make the retail POS member search modal request one four-row server page at a time.

**Architecture:** The CRM server owns member search semantics and pagination for `POST /device/member/search/keyword`. The POS local server remains a proxy, preserving upstream `ok`, `result`, and `paging`. The Electron renderer removes local result slicing and drives Prev/Next by requesting server pages with `limit: 4`.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7, Node `node:test`, React 19, Electron Vite, axios.

---

## File Structure

**CRM server repo:** `/Users/dev/ktpv5/ktpv5-crm-server`

- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.ts`
  - CRM-local POST-body pagination parser and paging metadata builder.
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.test.ts`
  - Pure Node tests for defaults, validation, and paging flags.
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
  - Change keyword search from hard-coded `take: 20` to `count + skip/take`.
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
  - Parse `page`/`limit` from POST body and return structured validation errors.

**POS retail repo:** `/Users/dev/ktpv5/ktpv5-pos-retail`

- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/libs/cloud.api.ts`
  - Preserve upstream body `ok` on HTTP 2xx responses.
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`
  - Type member keyword search proxy input and forward page/limit.
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`
  - Change renderer member keyword search API to accept `{ keyword, page, limit }`.
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`
  - Request server pages, remove local slicing, and keep fixed four-row no-scroll UI.

## Task 1: CRM Pagination Lib

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.ts`

- [ ] **Step 1: Write the failing pagination test**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaging,
  parseFindManyBody,
} from "./pagination.js";
import { BadRequestException } from "./exceptions.js";

test("parseFindManyBody defaults to page 1 and limit 20", () => {
  assert.deepEqual(parseFindManyBody({}), { page: 1, limit: 20 });
});

test("parseFindManyBody accepts numeric strings from request bodies", () => {
  assert.deepEqual(parseFindManyBody({ page: "3", limit: "4" }), {
    page: 3,
    limit: 4,
  });
});

test("parseFindManyBody rejects page less than 1", () => {
  assert.throws(
    () => parseFindManyBody({ page: 0, limit: 20 }),
    (error) =>
      error instanceof BadRequestException &&
      error.message === "Invalid page",
  );
});

test("parseFindManyBody rejects limit less than 1", () => {
  assert.throws(
    () => parseFindManyBody({ page: 1, limit: 0 }),
    (error) =>
      error instanceof BadRequestException &&
      error.message === "Invalid limit (1-100)",
  );
});

test("parseFindManyBody rejects limit greater than 100", () => {
  assert.throws(
    () => parseFindManyBody({ page: 1, limit: 101 }),
    (error) =>
      error instanceof BadRequestException &&
      error.message === "Invalid limit (1-100)",
  );
});

test("buildPaging reports previous and next page availability", () => {
  assert.deepEqual(buildPaging({ page: 2, limit: 4, totalCount: 9 }), {
    currentPage: 2,
    totalPages: 3,
    hasPrev: true,
    hasNext: true,
  });
});

test("buildPaging reports no next page for empty results", () => {
  assert.deepEqual(buildPaging({ page: 1, limit: 4, totalCount: 0 }), {
    currentPage: 1,
    totalPages: 0,
    hasPrev: false,
    hasNext: false,
  });
});
```

- [ ] **Step 2: Run the CRM test and verify it fails**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: `npm run build` fails because `src/libs/pagination.ts` does not exist yet.

- [ ] **Step 3: Implement the pagination lib**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pagination.ts`:

```ts
import { BadRequestException } from "./exceptions";

export interface FindManyBody {
  page: number;
  limit: number;
}

export interface Paging {
  currentPage: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

function readBodyNumber(
  body: unknown,
  key: "page" | "limit",
): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const value = (body as Record<string, unknown>)[key];
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value === "number" || typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }

  return Number.NaN;
}

export function parseFindManyBody(body: unknown): FindManyBody {
  const rawPage = readBodyNumber(body, "page");
  const rawLimit = readBodyNumber(body, "limit");

  const page = rawPage ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new BadRequestException("Invalid page");
  }

  const limit = rawLimit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException("Invalid limit (1-100)");
  }

  return { page, limit };
}

export function buildPaging(input: {
  page: number;
  limit: number;
  totalCount: number;
}): Paging {
  const { page, limit, totalCount } = input;
  const totalPages = Math.ceil(totalCount / limit);

  return {
    currentPage: page,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}
```

- [ ] **Step 4: Run the CRM test and verify it passes**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build succeeds and Node test output reports all CRM `dist/libs/*.test.js` tests passing.

- [ ] **Step 5: Commit Task 1**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/libs/pagination.ts src/libs/pagination.test.ts
git commit -m "feat: add CRM pagination helper"
```

## Task 2: CRM Member Keyword Endpoint Pagination

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`

- [ ] **Step 1: Update the member service imports and types**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`, add the pagination import:

```ts
import { buildPaging, type FindManyBody } from "../../libs/pagination";
```

Keep the existing imports:

```ts
import db from "../../libs/db";
import { encryptPhone } from "../../libs/encryption";
import { hashPhone } from "../../libs/hasing";
import { buildMemberKeywordSearchWhere } from "../../libs/memberKeywordSearch";
```

- [ ] **Step 2: Change the keyword search service signature**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`, replace:

```ts
export const searchMembersByKeyword = async (
  companyId: number,
  keyword: string,
) => {
```

with:

```ts
export const searchMembersByKeyword = async (
  companyId: number,
  keyword: string,
  query: FindManyBody,
) => {
```

- [ ] **Step 3: Replace hard-coded `take: 20` with count plus skip/take**

In the same function, replace the existing `findMany` block:

```ts
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
```

with:

```ts
const { page, limit } = query;
const totalCount = await db.member.count({ where });
const paging = buildPaging({ page, limit, totalCount });
const skip = (page - 1) * limit;

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
  skip,
  take: limit,
});
```

- [ ] **Step 4: Return paging from the service**

In the same function, replace:

```ts
return {
  ok: true,
  msg: result.length > 0 ? "Members found" : "Member not found",
  result,
};
```

with:

```ts
return {
  ok: true,
  msg: result.length > 0 ? "Members found" : "Member not found",
  result,
  paging,
};
```

- [ ] **Step 5: Update controller imports**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`, add:

```ts
import { HttpException } from "../../libs/exceptions";
import { parseFindManyBody } from "../../libs/pagination";
```

Keep the existing service and signup imports.

- [ ] **Step 6: Parse pagination in the keyword controller**

In `searchMembersByKeywordController`, replace:

```ts
const result = await searchMembersByKeyword(companyId, keyword);
res.status(200).json(result);
return;
```

with:

```ts
const query = parseFindManyBody(req.body);
const result = await searchMembersByKeyword(companyId, keyword, query);
res.status(200).json(result);
return;
```

- [ ] **Step 7: Preserve structured HttpException errors in the keyword controller**

In the `catch` block of `searchMembersByKeywordController`, replace:

```ts
console.error(e);
res
  .status(500)
  .json({ ok: false, msg: "Internal server error", result: null });
return;
```

with:

```ts
if (e instanceof HttpException) {
  res
    .status(e.statusCode)
    .json({ ok: false, msg: e.message, result: null, paging: null });
  return;
}

console.error(e);
res
  .status(500)
  .json({ ok: false, msg: "Internal server error", result: null });
return;
```

- [ ] **Step 8: Run CRM tests**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: TypeScript build succeeds and all CRM Node tests pass.

- [ ] **Step 9: Commit Task 2**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/device/member/member.service.ts src/device/member/member.controller.ts
git commit -m "feat: paginate CRM member keyword search"
```

## Task 3: POS Local Server Proxy Preservation

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/libs/cloud.api.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`

- [ ] **Step 1: Preserve upstream `ok` in the cloud API client**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/libs/cloud.api.ts`, replace the success return:

```ts
return {
  ok: true,
  msg,
  message: msg,
  status: response.status,
  result: responseData.result ?? null,
  paging: responseData.paging ?? null,
};
```

with:

```ts
return {
  ok: responseData.ok ?? true,
  msg,
  message: msg,
  status: response.status,
  result: responseData.result ?? null,
  paging: responseData.paging ?? null,
};
```

- [ ] **Step 2: Type the CRM member keyword proxy input**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`, replace:

```ts
export async function searchMembersByKeywordService(data: {
  keyword: string;
}) {
```

with:

```ts
export async function searchMembersByKeywordService(data: {
  keyword: string;
  page?: number;
  limit?: number;
}) {
```

The existing body forwarding remains:

```ts
const result = await crmApiService.post(
  "/device/member/search/keyword",
  data,
);
return result;
```

- [ ] **Step 3: Build the POS local server**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: TypeScript build exits with code 0.

- [ ] **Step 4: Commit Task 3**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/libs/cloud.api.ts retail_pos_server/src/v1/crm/crm.service.ts
git commit -m "feat: preserve CRM paging in POS proxy"
```

## Task 4: POS Member Search Modal Server Paging

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`

- [ ] **Step 1: Update the renderer CRM service signature**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`, replace:

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

with:

```ts
export async function searchMembersByKeyword(input: {
  keyword: string;
  page: number;
  limit: number;
}): Promise<ApiResponse<MemberSearchResult[]>> {
  return apiService.post<MemberSearchResult[]>(
    "/api/crm/member/search/keyword",
    input,
  );
}
```

- [ ] **Step 2: Import the paging type in the modal**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`, add:

```ts
import { PagingType } from "../libs/api";
```

Keep the existing React, CRM service, keyboard, `cn`, and phone utility imports.

- [ ] **Step 3: Add server paging state**

In `MemberSearchModal`, after:

```ts
const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
```

add:

```ts
const [searchPaging, setSearchPaging] = useState<PagingType | null>(null);
```

In the modal reset effect, after:

```ts
setSearchResults([]);
```

add:

```ts
setSearchPaging(null);
```

- [ ] **Step 4: Replace `handleSearch` with a page-aware search function**

In `MemberSearchModal`, replace the current `handleSearch` callback with:

```ts
const runSearch = useCallback(
  async (page: number) => {
    const keyword = searchKeyword.trim().replace(/\s+/g, " ");
    setSearchKeyword(keyword);
    if (!keyword) {
      setSearchResults([]);
      setSearchPaging(null);
      setSearchError("Enter member name or phone digits");
      setSearched(true);
      return;
    }

    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    setSearched(true);
    try {
      const res = await searchMembersByKeyword({
        keyword,
        page,
        limit: SEARCH_PAGE_SIZE,
      });
      if (res.ok && Array.isArray(res.result) && res.result.length > 0) {
        setSearchResults(res.result);
        setSearchPaging(res.paging);
      } else if (res.ok && Array.isArray(res.result)) {
        setSearchResults([]);
        setSearchPaging(res.paging);
        setSearchError("Member not found");
      } else {
        setSearchResults([]);
        setSearchPaging(res.paging);
        setSearchError(res.msg || "Member not found");
      }
    } catch {
      setSearchResults([]);
      setSearchPaging(null);
      setSearchError("Network error");
    } finally {
      setSearchLoading(false);
    }
  },
  [searchKeyword],
);

const handleSearch = useCallback(() => {
  void runSearch(1);
}, [runSearch]);
```

- [ ] **Step 5: Pass paging and page handlers to `SearchTab`**

In the `<SearchTab />` props, add:

```tsx
paging={searchPaging}
onPageChange={runSearch}
```

The full call should include:

```tsx
<SearchTab
  keyword={searchKeyword}
  setKeyword={setSearchKeyword}
  loading={searchLoading}
  error={searchError}
  searched={searched}
  searchResults={searchResults}
  paging={searchPaging}
  onSearch={handleSearch}
  onPageChange={runSearch}
  onSelect={handleSelectSearchResult}
/>
```

- [ ] **Step 6: Update `SearchTabProps`**

In `SearchTabProps`, add:

```ts
paging: PagingType | null;
onPageChange: (page: number) => void;
```

The interface should include:

```ts
interface SearchTabProps {
  keyword: string;
  setKeyword: (v: string) => void;
  loading: boolean;
  error: string;
  searched: boolean;
  searchResults: MemberSearchResult[];
  paging: PagingType | null;
  onSearch: () => void;
  onPageChange: (page: number) => void;
  onSelect: (member: MemberSearchResult) => void;
}
```

- [ ] **Step 7: Remove local slicing from `SearchTab`**

In the `SearchTab` parameter list, replace:

```ts
function SearchTab({
  keyword,
  setKeyword,
  loading,
  error,
  searched,
  searchResults,
  onSearch,
  onSelect,
}: SearchTabProps) {
```

with:

```ts
function SearchTab({
  keyword,
  setKeyword,
  loading,
  error,
  searched,
  searchResults,
  paging,
  onSearch,
  onPageChange,
  onSelect,
}: SearchTabProps) {
```

In `SearchTab`, remove:

```ts
const [page, setPage] = useState(0);
const totalPages = Math.max(
  1,
  Math.ceil(searchResults.length / SEARCH_PAGE_SIZE),
);
const currentPage = Math.min(page, totalPages - 1);
const pageResults = searchResults.slice(
  currentPage * SEARCH_PAGE_SIZE,
  currentPage * SEARCH_PAGE_SIZE + SEARCH_PAGE_SIZE,
);

useEffect(() => {
  setPage(0);
}, [searchResults]);
```

Replace it with:

```ts
const currentPage = paging?.currentPage ?? 1;
const totalPages = Math.max(1, paging?.totalPages ?? 1);
const hasPrev = paging?.hasPrev ?? false;
const hasNext = paging?.hasNext ?? false;
```

- [ ] **Step 8: Render server-page results directly**

In the result list, replace:

```tsx
{pageResults.map((member) => (
```

with:

```tsx
{searchResults.map((member) => (
```

Keep the fixed four-row no-scroll container:

```tsx
<div className="w-full h-full grid grid-rows-4 gap-2">
```

Keep each member row as:

```tsx
<button
  key={member.id}
  type="button"
  onPointerDown={() => onSelect(member)}
  className="w-full min-h-0 bg-gray-50 rounded-xl p-4 flex items-center gap-4 text-left active:bg-blue-50"
>
```

- [ ] **Step 9: Change Prev/Next to request server pages**

Replace the Prev button:

```tsx
<button
  type="button"
  onPointerDown={() => setPage((p) => Math.max(0, p - 1))}
  disabled={currentPage === 0 || searchResults.length === 0}
  className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
>
  Prev
</button>
```

with:

```tsx
<button
  type="button"
  onPointerDown={() => {
    if (hasPrev && !loading) void onPageChange(currentPage - 1);
  }}
  disabled={!hasPrev || loading}
  className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
>
  Prev
</button>
```

Replace the Next button:

```tsx
<button
  type="button"
  onPointerDown={() =>
    setPage((p) => Math.min(totalPages - 1, p + 1))
  }
  disabled={
    currentPage >= totalPages - 1 || searchResults.length === 0
  }
  className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
>
  Next
</button>
```

with:

```tsx
<button
  type="button"
  onPointerDown={() => {
    if (hasNext && !loading) void onPageChange(currentPage + 1);
  }}
  disabled={!hasNext || loading}
  className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
>
  Next
</button>
```

Keep the page label:

```tsx
<span className="text-sm text-gray-500">
  {currentPage} / {totalPages}
</span>
```

- [ ] **Step 10: Build the POS app**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: Electron Vite build exits with code 0.

- [ ] **Step 11: Commit Task 4**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/service/crm.service.ts retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx
git commit -m "feat: paginate POS member search modal"
```

## Task 5: End-to-End Verification

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run CRM tests**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: TypeScript build succeeds and Node tests pass.

- [ ] **Step 2: Build POS local server**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: TypeScript build exits with code 0.

- [ ] **Step 3: Build POS app**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: Electron Vite build exits with code 0.

- [ ] **Step 4: Manual QA on a running POS environment**

Use a CRM dataset where one keyword returns more than four active members.

Expected behavior:

- Search sends `{ keyword, page: 1, limit: 4 }`.
- Result area shows at most four rows.
- Result area has no scroll.
- Next is enabled when CRM returns `paging.hasNext = true`.
- Tapping Next sends `{ keyword, page: 2, limit: 4 }`.
- Prev is enabled on page 2 when CRM returns `paging.hasPrev = true`.
- Selecting a member attaches it to the active cart.
- Changing the member reprices active cart lines through existing `setMember`.

- [ ] **Step 5: Confirm no extra verification files were created**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git status --short
```

Expected: only the intended implementation files are modified, or the working
tree is clean after the previous task commits.

## Execution Notes

- Start the next session with `superpowers:subagent-driven-development`.
- Dispatch one subagent per task.
- Review each subagent's diff before starting the next task.
- Do not use Discord notifications unless the user explicitly asks in that session.
- Treat unrelated worktree changes as user-owned in both repos.
