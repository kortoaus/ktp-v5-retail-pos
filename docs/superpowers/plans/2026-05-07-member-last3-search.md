# Member Last-3 Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace POS member full-phone search with privacy-preserving last-3-digit lookup that returns a selectable member list.

**Architecture:** CRM server owns the database lookup against the existing `Member.phone_last4` column and exposes a new `last3` device endpoint. The POS local server proxies that endpoint, and the POS renderer calls the proxy from `MemberSearchModal`. The modal only accepts exactly 3 numeric digits and never calls the full-phone search path.

**Tech Stack:** Express 5, TypeScript, Prisma client generated into each server, React 19 renderer, existing axios API service envelope.

---

## File Map

- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.ts`
  - Pure validation helper for exactly 3 numeric suffix digits.
- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.test.ts`
  - Node test coverage for suffix validation.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
  - Add `searchMembersByPhoneLast3(companyId, phoneLast3)` query.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
  - Add controller validation and response for `/search/phone-last3`.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`
  - Register the new device route.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`
  - Add proxy service for CRM `/device/member/search/phone-last3`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.controller.ts`
  - Add local POS controller for last-3 search.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.router.ts`
  - Register `/api/crm/member/search/phone-last3`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`
  - Add typed renderer API function returning safe `MemberSearchResult[]`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`
  - Replace single exact full-phone result flow with last-3 list search.

---

### Task 1: CRM Last-3 Validation Helper

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMemberPhoneLast3Search } from "./memberPhoneLast3";

test("normalizeMemberPhoneLast3Search accepts exactly three numeric digits", () => {
  assert.equal(normalizeMemberPhoneLast3Search("123"), "123");
});

test("normalizeMemberPhoneLast3Search trims surrounding whitespace", () => {
  assert.equal(normalizeMemberPhoneLast3Search(" 456 "), "456");
});

test("normalizeMemberPhoneLast3Search rejects fewer than three digits", () => {
  assert.equal(normalizeMemberPhoneLast3Search("12"), null);
});

test("normalizeMemberPhoneLast3Search rejects more than three digits", () => {
  assert.equal(normalizeMemberPhoneLast3Search("1234"), null);
});

test("normalizeMemberPhoneLast3Search rejects non-numeric input", () => {
  assert.equal(normalizeMemberPhoneLast3Search("12a"), null);
  assert.equal(normalizeMemberPhoneLast3Search(null), null);
  assert.equal(normalizeMemberPhoneLast3Search(undefined), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: TypeScript build fails because `src/libs/memberPhoneLast3.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneLast3.ts`:

```ts
export function normalizeMemberPhoneLast3Search(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!/^\d{3}$/.test(normalized)) return null;

  return normalized;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: `npm run build` succeeds, then Node test output reports all `dist/libs/*.test.js` tests passing, including `memberPhoneLast3.test.js`.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/libs/memberPhoneLast3.ts src/libs/memberPhoneLast3.test.ts
git commit -m "test: add member last-3 validation"
```

---

### Task 2: CRM Device Endpoint

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`

- [ ] **Step 1: Add the CRM service query**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`, add this export after `searchMemberByPhone`:

```ts
export const searchMembersByPhoneLast3 = async (
  companyId: number,
  phoneLast3: string,
) => {
  try {
    const members = await db.member.findMany({
      where: {
        companyId,
        phone_last4: phoneLast3,
        archived: false,
      },
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
    const result = members.map((member) => ({
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

- [ ] **Step 2: Add the CRM controller**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`, update imports to include both symbols:

```ts
import {
  createMember,
  getMemberById,
  searchMemberByPhone,
  searchMembersByPhoneLast3,
} from "./member.service";
import { normalizeMemberPhoneLast3Search } from "../../libs/memberPhoneLast3";
```

Then add this controller after `searchMemberController`:

```ts
export async function searchMembersByPhoneLast3Controller(
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

    const phoneLast3 = normalizeMemberPhoneLast3Search(req.body?.phoneLast3);
    if (!phoneLast3) {
      res
        .status(400)
        .json({ ok: false, msg: "Enter last 3 digits", result: null });
      return;
    }

    const result = await searchMembersByPhoneLast3(companyId, phoneLast3);
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

- [ ] **Step 3: Register the CRM route**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`, update imports:

```ts
import {
  createMemberController,
  getMemberByIdController,
  searchMemberController,
  searchMembersByPhoneLast3Controller,
} from "./member.controller";
```

Add the route after `/search/phone`:

```ts
memberRouter
  .route("/search/phone-last3")
  .post(searchMembersByPhoneLast3Controller);
```

- [ ] **Step 4: Build and test CRM server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: TypeScript build passes and all Node tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/device/member/member.service.ts src/device/member/member.controller.ts src/device/member/member.routes.ts
git commit -m "feat: add member last-3 device search"
```

---

### Task 3: POS Local Server Proxy

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.router.ts`

- [ ] **Step 1: Add the POS proxy service**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.service.ts`, add:

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

- [ ] **Step 2: Add the POS proxy controller**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.controller.ts`, update imports:

```ts
import {
  createMemberService,
  searchMemberByIdService,
  searchMemberService,
  searchMembersByPhoneLast3Service,
} from "./crm.service";
```

Add this controller after `searchMemberController`:

```ts
export async function searchMembersByPhoneLast3Controller(
  req: Request,
  res: Response,
) {
  const result = await searchMembersByPhoneLast3Service(req.body);
  res.json(result);
}
```

- [ ] **Step 3: Register the POS proxy route**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/crm/crm.router.ts`, update imports:

```ts
import {
  createMemberController,
  searchMemberByIdController,
  searchMemberController,
  searchMembersByPhoneLast3Controller,
} from "./crm.controller";
```

Add the route after `/member/search/phone`:

```ts
crmRouter.post("/member/search/phone-last3", searchMembersByPhoneLast3Controller);
```

- [ ] **Step 4: Build POS local server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/v1/crm/crm.service.ts retail_pos_server/src/v1/crm/crm.controller.ts retail_pos_server/src/v1/crm/crm.router.ts
git commit -m "feat: proxy member last-3 search"
```

---

### Task 4: POS Renderer Service

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`

- [ ] **Step 1: Add the renderer service function**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/crm.service.ts`, add this function after `searchMemberByPhone`:

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

- [ ] **Step 2: Build the renderer app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: Electron Vite build passes.

- [ ] **Step 3: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/service/crm.service.ts
git commit -m "feat: add member last-3 renderer API"
```

---

### Task 5: POS Member Search Modal UI

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`

- [ ] **Step 1: Update imports and state**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx`, replace the CRM import:

```ts
import {
  createMember,
  searchMembersByPhoneLast3,
} from "../service/crm.service";
```

Replace:

```ts
const [foundMember, setFoundMember] = useState<Member | null>(null);
```

with:

```ts
const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
```

Replace reset calls to `setFoundMember(null)` with:

```ts
setSearchResults([]);
```

- [ ] **Step 2: Replace search logic**

Replace `handleSearch` with:

```ts
const handleSearch = useCallback(async () => {
  const phoneLast3 = searchPhone.replace(/[^0-9]/g, "");
  if (!/^\d{3}$/.test(phoneLast3)) {
    setSearchError("Enter last 3 digits");
    setSearched(true);
    setSearchResults([]);
    return;
  }

  setSearchLoading(true);
  setSearchError("");
  setSearchResults([]);
  setSearched(true);
  try {
    const res = await searchMembersByPhoneLast3(phoneLast3);
    if (res.ok && Array.isArray(res.result)) {
      setSearchResults(res.result);
      if (res.result.length === 0) {
        setSearchError("Member not found");
      }
    } else {
      setSearchError(res.msg || "Member not found");
    }
  } catch {
    setSearchError("Network error");
  } finally {
    setSearchLoading(false);
  }
}, [searchPhone]);
```

Remove `handleConfirm`; row selection will call `onSelect(member)` directly.

- [ ] **Step 3: Pass list props to `SearchTab`**

Replace the `SearchTab` props:

```tsx
<SearchTab
  phone={searchPhone}
  setPhone={setSearchPhone}
  loading={searchLoading}
  error={searchError}
  searched={searched}
  searchResults={searchResults}
  onSearch={handleSearch}
  onSelect={onSelect}
/>
```

Update `SearchTabProps`:

```ts
interface SearchTabProps {
  phone: string;
  setPhone: (v: string) => void;
  loading: boolean;
  error: string;
  searched: boolean;
  searchResults: MemberSearchResult[];
  onSearch: () => void;
  onSelect: (member: Member) => void;
}
```

Update the `SearchTab` parameter list to use `searchResults` and `onSelect`.

- [ ] **Step 4: Cap keyboard input at 3 digits**

Replace the search keyboard `onChange`:

```tsx
onChange={(v) => setSearchPhone(v.replace(/[^0-9]/g, "").slice(0, 3))}
```

- [ ] **Step 5: Replace the search tab UI copy and result list**

Inside `SearchTab`, change the placeholder from `Phone number` to:

```tsx
{phone || <span className="text-gray-400">Last 3 digits</span>}
```

Change the search button disabled expression:

```tsx
disabled={!/^\d{3}$/.test(phone) || loading}
```

Change the pre-search helper text to:

```tsx
<span className="text-gray-400 text-sm">
  Enter customer's last 3 digits
</span>
```

Replace the `foundMember` result block with:

```tsx
{searchResults.length > 0 && (
  <div className="w-full max-h-64 overflow-y-auto space-y-2">
    {searchResults.map((member) => (
      <button
        key={member.id}
        type="button"
        onPointerDown={() => onSelect(member)}
        className="w-full bg-gray-50 rounded-xl p-4 flex items-center gap-4 text-left active:bg-gray-100"
      >
        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg font-bold">
          {member.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base truncate">{member.name}</div>
          <div className="text-sm text-gray-500">
            ***{member.phoneLast3 ?? ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-400">Level</div>
          <div className="font-bold text-sm">{member.level}</div>
        </div>
      </button>
    ))}
  </div>
)}
```

Update the error condition to:

```tsx
{searched && !loading && error && searchResults.length === 0 && (
  <span className="text-red-500 text-sm">{error}</span>
)}
```

- [ ] **Step 6: Remove full-phone search references**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "searchMemberByPhone|foundMember|Phone number|Invalid Australian mobile number" retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx
```

Expected: no matches for `searchMemberByPhone`, `foundMember`, or `Invalid Australian mobile number`. `Phone number` may still appear in the Create tab only.

- [ ] **Step 7: Build the POS app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: Electron Vite build passes.

- [ ] **Step 8: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx
git commit -m "feat: search members by last 3 digits"
```

---

### Task 6: Final Cross-Repo Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Confirm CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: build succeeds and Node tests pass.

- [ ] **Step 2: Confirm POS local server build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Confirm POS app build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: Electron Vite build passes.

- [ ] **Step 4: Privacy search check**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "searchMemberByPhone\\(|/api/crm/member/search/phone\"|Invalid Australian mobile number" retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx retail_pos_app/src/renderer/src/service/crm.service.ts
```

Expected: no modal usage of `searchMemberByPhone`, no exact full-phone endpoint call from `MemberSearchModal`, and no search-mode full-phone validation text.

- [ ] **Step 5: Manual QA**

With CRM server, POS local server, and POS app running against a dev database:

```text
1. Open Member modal.
2. Search tab shows "Last 3 digits".
3. Enter 1 or 2 digits: Search is disabled or validation says "Enter last 3 digits".
4. Enter a 3-digit suffix with no members: result says "Member not found".
5. Enter a 3-digit suffix with one member: one row appears with name, ***digits, and level.
6. Enter a 3-digit suffix with multiple members: up to 20 newest-first rows appear.
7. Tap one row: that member is selected and attached to the cart/search panel.
8. Confirm the Search tab never asks for or displays a full phone number.
9. Create tab still accepts full phone because new member creation still requires a real phone.
10. QR/member-ID scan flow still works because `searchMemberById` is unchanged.
```

- [ ] **Step 6: Final status**

Run in both repos:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && git status --short
cd /Users/dev/ktpv5/ktpv5-pos-retail && git status --short
```

Expected: only intentional uncommitted changes remain, or both repos are clean after commits.

---

## Self-Review

Spec coverage:

- CRM endpoint: Task 2.
- POS proxy endpoint: Task 3.
- Renderer service: Task 4.
- Modal last-3-only input and selectable list: Task 5.
- Privacy rules and no full-phone search in modal: Task 5 Step 6 and Task 6 Step 4.
- Verification commands and manual QA: Task 6.

Placeholder scan:

- No placeholder markers, "similar to", or unspecified edge-case steps.
- Every code-changing step includes concrete code or a concrete command.

Type consistency:

- Request property is consistently `phoneLast3`.
- CRM database field remains `phone_last4`.
- Renderer service returns `ApiResponse<MemberSearchResult[]>`.
- Modal state uses `MemberSearchResult[]`.
