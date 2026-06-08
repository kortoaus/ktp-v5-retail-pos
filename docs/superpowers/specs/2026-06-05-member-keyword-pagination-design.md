# Member Keyword Search Pagination Design

## Summary

Apply first-class pagination to the CRM device member keyword search flow.

The immediate backend scope is only:

```text
POST /device/member/search/keyword
```

on `/Users/dev/ktpv5/ktpv5-crm-server`.

The POS retail member search modal will then consume that paginated endpoint
through the existing local POS server proxy. The modal must keep showing four
members per page with no scroll area; Prev/Next should request the next server
page instead of slicing a larger local result array.

## Background

The current CRM endpoint has a hard-coded `take: 20` in
`src/device/member/member.service.ts`. The POS modal previously sliced returned
results locally. That is a temporary UI workaround, not real pagination.

`/Users/dev/ktpv5/ktpv5-api-server/src/libs/query.ts` defines the canonical KTP
pagination behavior:

- default `page = 1`
- default `limit = 20`
- `limit` must be between 1 and 100
- responses include `paging: { currentPage, totalPages, hasPrev, hasNext }`

Domains such as `customer`, `vendor`, and `item-sheet` follow the same service
shape:

- build `where`
- `count({ where })`
- `skip = (page - 1) * limit`
- `take = limit`
- return standard `{ ok, result, paging }`

## Goals

- Add reusable pagination parsing/metadata helpers under the CRM server `libs`
  layer.
- Apply those helpers only to `/device/member/search/keyword` for now.
- Preserve the existing POST route and keyword-search semantics.
- Return standard paging metadata from CRM.
- Forward paging metadata through the POS local server proxy.
- Update `MemberSearchModal` so it requests server pages with `limit: 4`.
- Keep the modal result panel scroll-free and touch-panel friendly.

## Non-Goals

- Do not paginate every CRM endpoint in this pass.
- Do not migrate `/device/member/search/keyword` from POST to GET.
- Do not change QR member lookup (`/device/member/search/id`).
- Do not change exact phone lookup (`/device/member/search/phone`).
- Do not rename `phone_last4`; it currently stores the phone tail used for
  search compatibility.
- Do not change member signup or OTP behavior.

## CRM Server Design

Repo:

```text
/Users/dev/ktpv5/ktpv5-crm-server
```

### New Pagination Lib

Create a CRM-local helper:

```text
src/libs/pagination.ts
```

Recommended exports:

```ts
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

export function parseFindManyBody(body: unknown): FindManyBody;

export function buildPaging(input: {
  page: number;
  limit: number;
  totalCount: number;
}): Paging;
```

Behavior:

- `page` defaults to `1`.
- `limit` defaults to `20`.
- `page` must be an integer greater than or equal to `1`.
- `limit` must be an integer from `1` to `100`.
- Invalid values return or throw through the CRM repo's normal structured error
  path.
- `totalPages = Math.ceil(totalCount / limit)`.
- `hasPrev = page > 1`.
- `hasNext = page < totalPages`.

This intentionally mirrors `ktpv5-api-server/src/libs/query.ts`, but parses POST
body values instead of Express query-string values because the current CRM
device search route is POST.

### Member Keyword Search Service

Update:

```text
src/device/member/member.service.ts
```

Current search semantics stay the same:

- company id comes from device auth locals
- keyword is normalized by `buildMemberKeywordSearchWhere`
- search active members only
- match `name contains keyword` OR `phone_last4 contains digits`

New behavior:

```ts
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
  orderBy: { createdAt: "desc" },
  skip,
  take: limit,
});
```

Response:

```ts
{
  ok: true,
  msg: result.length > 0 ? "Members found" : "Member not found",
  result,
  paging,
}
```

Empty pages should return `ok: true`, `result: []`, and valid `paging`. Reserve
`ok: false` for invalid input or server failures.

### Controller

Update:

```text
src/device/member/member.controller.ts
```

Only `searchMembersByKeywordController` needs pagination parsing. It should read:

- `keyword` from `req.body.keyword`
- `page` / `limit` from the request body via the new lib

Then call the service with:

```ts
searchMembersByKeyword(companyId, keyword, { page, limit })
```

## POS Local Server Design

Repo:

```text
/Users/dev/ktpv5/ktpv5-pos-retail
```

Update:

```text
retail_pos_server/src/v1/crm/crm.service.ts
```

The proxy should forward the whole body:

```ts
crmApiService.post("/device/member/search/keyword", data)
```

where `data` contains:

```ts
{
  keyword: string;
  page?: number;
  limit?: number;
}
```

The proxy response must preserve CRM `paging`. It must also preserve CRM body
`ok` when CRM returns HTTP 200 with `{ ok: false }`.

Update the POS local server shared cloud API client so a 2xx upstream response
uses:

```ts
ok: responseData.ok ?? true
```

instead of forcing every 2xx response to `ok: true`. This keeps the fix
centralized for all existing CRM proxy callers and prevents the member search
modal from hiding upstream validation failures.

## POS Renderer Design

Update:

```text
retail_pos_app/src/renderer/src/service/crm.service.ts
```

Change `searchMembersByKeyword` to accept pagination:

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

Keep `MemberSearchResult` unchanged:

```ts
{
  id: string;
  companyId: number;
  phoneLast3: string | null;
  name: string;
  level: number;
  points: number;
}
```

Update:

```text
retail_pos_app/src/renderer/src/components/MemberSearchModal.tsx
```

Search tab state should become server-page based:

- `searchKeyword`
- `searchResults`
- `searchPaging`
- `searchPage`
- `searchLoading`
- `searchError`
- `searched`

The modal should use:

```ts
const SEARCH_PAGE_SIZE = 4;
```

Behavior:

- New keyword search starts at `page = 1`.
- Prev requests `page - 1` from server.
- Next requests `page + 1` from server.
- Search button requests `{ keyword, page: 1, limit: 4 }`.
- The modal no longer slices `searchResults` locally.
- The result panel remains a fixed four-row grid with no scroll container.
- `Prev` and `Next` disabled state should come from `paging.hasPrev` and
  `paging.hasNext`.
- Page label should come from `paging.currentPage / paging.totalPages`, with a
  sane fallback of `1 / 1` when no paging exists.

## Data Flow

```text
MemberSearchModal
  -> POST /api/crm/member/search/keyword
       { keyword, page, limit: 4 }
  -> POS local server proxy
  -> POST CRM /device/member/search/keyword
       { keyword, page, limit: 4 }
  -> CRM Prisma count + findMany(skip/take)
  <- { ok, msg, result: MemberSearchResult[], paging }
```

## Error Handling

CRM server:

- Blank keyword: `ok: false`, `msg: "Enter member name or phone digits"`.
- Invalid `page`: structured validation error.
- Invalid `limit`: structured validation error.
- No matches: `ok: true`, `result: []`, `paging`, `msg: "Member not found"`.

POS modal:

- Blank keyword: local validation message before request.
- `ok: true` with empty result: show "Member not found".
- `ok: false`: show returned `msg`.
- Network/proxy failure: show "Network error".

## Testing

CRM server:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Add focused tests for the new pagination lib:

- defaults to page 1 / limit 20
- rejects page less than 1
- rejects limit less than 1
- rejects limit greater than 100
- builds `hasPrev` / `hasNext` correctly

POS retail server:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

POS app:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Manual QA:

- Search keyword with fewer than four results.
- Search keyword with more than four results.
- Confirm page 1 shows four rows and no scroll.
- Tap Next and confirm the modal requests server page 2.
- Tap Prev and confirm the modal requests server page 1 again.
- Confirm no local slicing is used.
- Confirm selecting any page result attaches the member and reprices the active
  cart.

## Risks

- The POS local cloud API client currently may force all HTTP 2xx CRM responses
  to `ok: true`. That can hide CRM validation failures and should be corrected
  as part of implementation.
- CRM repo currently has its own device auth middleware pattern. Do not alter
  auth scope while adding pagination.
- The modal should not add a scroll fallback. If four rows do not fit, row
  sizing must be adjusted instead.
