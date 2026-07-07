# Pickup Order Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the retail POS pickup order client screen for list/filter/search/member-search/read-only viewing, plus the local POS API fixes required by that client.

**Architecture:** Keep pickup orders as read-only cached CRM snapshots in this slice. The POS server exposes normalized, sale-scope-protected list/detail/manual-sync APIs; the Electron renderer adds a manager-only operational search screen with a two-column viewer and reusable 100x100mm HTML work-order label preview. No status mutations, Socket.IO refresh UI, automatic polling, sync button, print action, or ZPL generation are implemented here.

**Tech Stack:** Electron 40, React 19, React Router hash routes, TypeScript strict mode, Tailwind CSS classes, Axios API singleton, Express 5, Prisma 7 generated client, PostgreSQL, Node built-in test runner.

---

## Scope

This plan implements the client design in `docs/superpowers/specs/2026-07-07-pickup-order-client-design.md` and finishes the local API adjustments left from `docs/superpowers/specs/2026-07-07-pickup-order-sync-design.md`.

In scope:

- `/manager/pickup-orders` route under `ManagerLayout`.
- Home Sales tile: `Pickup Orders`.
- Client-side `sale` scope gate using `hasScope(user.scope, ["sale"])` and `BlockScreen`.
- Local renderer service and pickup order types.
- Search filters: keyword, pickup date range, status, member.
- Read-only viewer modal.
- Two-column viewer layout with selected line behavior.
- 100x100mm HTML/CSS work-order label preview.
- Defensive selected-options normalization without `as any` or `@ts-ignore`.
- Server `memberId` list filter.
- Server list response normalized to `result: PickupOrderListItem[]` with existing `PagingType` shape.
- Server list/detail/manual-sync protected by `userMiddleware` and `scopeMiddleware("sale")`.

Out of scope:

- New-order badge/toast/sound/socket listener.
- Renderer polling.
- Renderer manual `Sync` button.
- Status action buttons.
- Label print button, print history, or ZPL.
- Offline mutation outbox.

Repository rule: do not stage or commit unless the user explicitly requests it. The checkpoint steps below are review checkpoints, not automatic git commits.

---

## Current Code Observations

- App route root is `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/App.tsx`.
- Manager routes already mount under `/manager` with `ManagerLayout`, `UserProvider`, and `AuthGateway`.
- Existing reference UI is `SaleInvoiceSearchScreen` plus `SaleInvoiceSearchPanel`.
- `MemberSearchModal` returns `MemberSearchSelection` with `id`, `name`, `level`, `points`, and `phone_last4`.
- `DateRangeSelector` returns `Dayjs` bounds; query params should send `from?.toISOString()` and `to?.toISOString()`.
- Renderer API singleton normalizes envelopes to `{ ok, status, msg, result, paging }`.
- Server pickup-order files already exist, but currently need:
  - `memberId` in `PickupOrderListQuery`.
  - `result` changed from `{ items: rows }` to `rows`.
  - paging shape changed from `{ page, limit, totalCount, totalPages, hasNext }` to `{ hasPrev, hasNext, currentPage, totalPages }`.
  - route middleware added for `sale` scope.

---

## File Structure

### Retail POS Server

- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.types.ts`
  - Add `memberId?: string` to `PickupOrderListQuery`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.repository.ts`
  - Parse `memberId`.
  - Export a testable `buildPickupOrderListWhere(query)`.
  - Normalize list response result to array.
  - Normalize paging shape.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.query.test.ts`
  - Add query parsing, `memberId` where, date/status/keyword combined where, and paging-shape coverage.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`
  - Add `userMiddleware` and `scopeMiddleware("sale")` to list, detail, and sync routes.

### Retail POS App

- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-types.ts`
  - Renderer pickup order DTOs, normalized UI types, status constants.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-format.ts`
  - Pure helpers for option normalization, money/qty/date label formatting, selected option counts, status metadata.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-order-format.test.ts`
  - Pure helper tests runnable without React.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`
  - `searchPickupOrders(params)` and `getPickupOrderByCrmId(crmOrderId)`.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx`
  - Header/back button, `sale` scope gate, selected `crmOrderId`, panel, viewer.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`
  - Filters, list, pagination, member modal, loading/error/empty states.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Read-only modal, detail load, line selection.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`
  - 100x100mm HTML preview for selected line.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/App.tsx`
  - Import and mount `/manager/pickup-orders`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/HomeScreen.tsx`
  - Add Sales tile with `IoBagCheckOutline`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/README.md`
  - Add route/API documentation rows after implementation.

---

## API And Type Contracts

Server list query:

```ts
type PickupOrderListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  from?: string;
  to?: string;
  status?: PickupOrderStatus;
  memberId?: string;
};
```

Server list response:

```ts
{
  ok: true;
  msg: "Pickup orders loaded";
  result: PickupOrderListItem[];
  paging: {
    hasPrev: boolean;
    hasNext: boolean;
    currentPage: number;
    totalPages: number;
  };
}
```

Server detail response:

```ts
{
  ok: true;
  msg: "Pickup order loaded";
  result: PickupOrderDetail;
  paging: null;
}
```

Path id naming:

```ts
getPickupOrderByCrmId(crmOrderId: number)
```

Never name the route param `localId` or `id` in renderer service APIs; `/api/pickup-order/:id` is CRM order id.

Renderer status set:

```ts
export const PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
  "CANCELLED_BY_CUSTOMER",
] as const;

export type PickupOrderStatus = (typeof PICKUP_ORDER_STATUSES)[number];
export type PickupOrderStatusFilter = "ALL" | PickupOrderStatus;
```

Selected option normalization rules:

- Accept only arrays of option groups.
- Accept only group entries with numeric `optionGroupId`, string `key`, string names, valid `type`, and array `selectedOptions`.
- For invalid group or option entries, drop the invalid entry.
- If the top-level value is invalid, return `[]`.
- Use `unknown` plus type guards; do not use `as any`.

---

## Task 1: Server List Contract, Member Filter, And Sale Scope

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.types.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.repository.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.query.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`

- [ ] **Step 1: Extend the server query tests first**

Add these assertions to `pickup-order.query.test.ts`:

```ts
import {
  buildPickupOrderListWhere,
  buildPickupOrderPaging,
  buildPickupOrderKeywordWhere,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";

test("parsePickupOrderListQuery accepts memberId", () => {
  const query = parsePickupOrderListQuery({ memberId: "crm-member-7" });
  assert.equal(query.memberId, "crm-member-7");
});

test("parsePickupOrderListQuery trims blank memberId away", () => {
  const query = parsePickupOrderListQuery({ memberId: "   " });
  assert.equal(query.memberId, undefined);
});

test("buildPickupOrderListWhere combines status dates member and keyword", () => {
  const query = parsePickupOrderListQuery({
    status: "READY",
    keyword: "salmon",
    memberId: "member-1",
    from: "2026-07-07T00:00:00.000Z",
    to: "2026-07-08T00:00:00.000Z",
  });

  const where = buildPickupOrderListWhere(query);

  assert.equal(where.status, "READY");
  assert.equal(where.memberId, "member-1");
  assert.deepEqual(where.pickupStartsAt, {
    gte: new Date("2026-07-07T00:00:00.000Z"),
    lte: new Date("2026-07-08T00:00:00.000Z"),
  });
  assert.ok(where.OR);
});

test("buildPickupOrderPaging returns renderer paging shape", () => {
  assert.deepEqual(
    buildPickupOrderPaging({ page: 2, limit: 20, totalCount: 55 }),
    {
      hasPrev: true,
      hasNext: true,
      currentPage: 2,
      totalPages: 3,
    },
  );
});
```

- [ ] **Step 2: Run the targeted server test and confirm the expected failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.query.test.js
```

Expected before implementation: TypeScript fails because `buildPickupOrderListWhere`, `buildPickupOrderPaging`, and `memberId` do not exist.

- [ ] **Step 3: Add `memberId` to the server query type**

Change `PickupOrderListQuery`:

```ts
export type PickupOrderListQuery = {
  status?: PickupOrderStatus;
  from?: Date;
  to?: Date;
  keyword?: string;
  memberId?: string;
  page: number;
  limit: number;
};
```

- [ ] **Step 4: Parse `memberId` and export testable where/paging helpers**

In `pickup-order.repository.ts`, add `memberId` parsing:

```ts
const rawMemberId = first(query.memberId);

if (rawMemberId !== undefined && typeof rawMemberId !== "string") {
  throw new BadRequestException("memberId must be a string");
}

const memberId = typeof rawMemberId === "string" ? rawMemberId.trim() : "";
```

Return it from `parsePickupOrderListQuery`:

```ts
return {
  ...(rawStatus ? { status: rawStatus as PickupOrderStatus } : {}),
  from: parseOptionalDate(query.from, "from"),
  to: parseOptionalDate(query.to, "to"),
  ...(keyword ? { keyword } : {}),
  ...(memberId ? { memberId } : {}),
  page,
  limit,
};
```

Replace local where assembly with exported helpers:

```ts
export function buildPickupOrderListWhere(
  query: PickupOrderListQuery,
): Prisma.PickupOrderCacheWhereInput {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...buildDateWhere(query),
    ...buildPickupOrderKeywordWhere(query.keyword),
  };
}

export function buildPickupOrderPaging(input: {
  page: number;
  limit: number;
  totalCount: number;
}) {
  const totalPages = Math.max(1, Math.ceil(input.totalCount / input.limit));
  return {
    hasPrev: input.page > 1,
    hasNext: input.page < totalPages,
    currentPage: input.page,
    totalPages,
  };
}
```

Use `lte` for the `to` date in this API because `DateRangeSelector` sends an `endOf("day")` value:

```ts
function buildDateWhere(
  query: PickupOrderListQuery,
): Prisma.PickupOrderCacheWhereInput {
  const pickupStartsAt: Prisma.DateTimeFilter = {};
  if (query.from) pickupStartsAt.gte = query.from;
  if (query.to) pickupStartsAt.lte = query.to;
  return Object.keys(pickupStartsAt).length > 0 ? { pickupStartsAt } : {};
}
```

Update `listCachedPickupOrders`:

```ts
const where = buildPickupOrderListWhere(query);
```

Return normalized result and paging:

```ts
return {
  ok: true,
  msg: "Pickup orders loaded",
  result: rows,
  paging: buildPickupOrderPaging({
    page: query.page,
    limit: query.limit,
    totalCount,
  }),
};
```

- [ ] **Step 5: Protect pickup-order routes with sale scope**

Replace `pickup-order.router.ts` with this shape:

```ts
import { Router } from "express";
import {
  getPickupOrderByIdController,
  listPickupOrdersController,
  syncPickupOrdersController,
} from "./pickup-order.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const pickupOrderRouter = Router();

pickupOrderRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  listPickupOrdersController,
);

pickupOrderRouter.post(
  "/sync",
  userMiddleware,
  scopeMiddleware("sale"),
  syncPickupOrdersController,
);

pickupOrderRouter.get(
  "/:id",
  userMiddleware,
  scopeMiddleware("sale"),
  getPickupOrderByIdController,
);

export default pickupOrderRouter;
```

- [ ] **Step 6: Verify server contract**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.query.test.js
```

Expected: TypeScript build succeeds and pickup-order query tests pass.

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "scopeMiddleware\\(\"sale\"\\)|result: rows|memberId|buildPickupOrderPaging" retail_pos_server/src/v1/pickup-order
```

Expected: output shows sale scope in `pickup-order.router.ts`, `memberId` in type/repository/test, `result: rows`, and `buildPickupOrderPaging`.

---

## Task 2: Renderer Types, Normalizers, Service, And Pure Tests

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-types.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-format.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-order-format.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`

- [ ] **Step 1: Create renderer types**

Create `pickup-order-types.ts` with the contracts from the spec:

```ts
export const PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
  "CANCELLED_BY_CUSTOMER",
] as const;

export type PickupOrderStatus = (typeof PICKUP_ORDER_STATUSES)[number];
export type PickupOrderStatusFilter = "ALL" | PickupOrderStatus;

export type PickupOrderSelectedOption = {
  key: string;
  name_en: string;
  name_ko: string;
  qty: number;
  priceDelta: number;
};

export type PickupOrderSelectedOptionGroup = {
  optionGroupId: number;
  key: string;
  name_en: string;
  name_ko: string;
  type: "SINGLE" | "MULTIPLE" | "QUANTITY";
  selectedOptions: PickupOrderSelectedOption[];
};

export type PickupOrderLine = {
  crmLineId: number;
  index: number;
  itemId: number;
  name_en: string;
  name_ko: string;
  barcode: string;
  code: string | null;
  uom: string;
  prices: number[];
  promoPrices: unknown;
  memberLevel: number;
  optionTotal: number;
  qty: number;
  total: number;
  note: string | null;
  selectedOptionsSnapshot: PickupOrderSelectedOptionGroup[];
};

export type PickupOrderLineWire = Omit<
  PickupOrderLine,
  "selectedOptionsSnapshot"
> & {
  selectedOptionsSnapshot: unknown;
};

export type PickupOrderListItem = {
  crmOrderId: number;
  documentId: string;
  status: PickupOrderStatus;
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  crmCreatedAt: string;
  crmUpdatedAt: string;
  syncedAt: string;
  lines: PickupOrderLine[];
};

export type PickupOrderListItemWire = Omit<PickupOrderListItem, "lines"> & {
  lines: PickupOrderLineWire[];
};

export type PickupOrderDetail = PickupOrderListItem;
export type PickupOrderDetailWire = PickupOrderListItemWire;

export type PickupOrderListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  from?: string;
  to?: string;
  status?: PickupOrderStatus;
  memberId?: string;
};
```

- [ ] **Step 2: Add pure formatter and normalizer helpers**

Create `pickup-order-format.ts`:

```ts
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import dayjsAU from "../../libs/dayjsAU";
import type {
  PickupOrderDetail,
  PickupOrderDetailWire,
  PickupOrderLine,
  PickupOrderLineWire,
  PickupOrderListItem,
  PickupOrderListItemWire,
  PickupOrderSelectedOption,
  PickupOrderSelectedOptionGroup,
  PickupOrderStatus,
} from "./pickup-order-types";

const groupTypes = new Set(["SINGLE", "MULTIPLE", "QUANTITY"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOption(value: unknown): PickupOrderSelectedOption | null {
  if (!isRecord(value)) return null;
  const key = readString(value.key);
  const name_en = readString(value.name_en);
  const name_ko = readString(value.name_ko);
  const qty = readNumber(value.qty);
  const priceDelta = readNumber(value.priceDelta);
  if (!key || name_en == null || name_ko == null || qty == null || priceDelta == null) {
    return null;
  }
  return { key, name_en, name_ko, qty, priceDelta };
}

function normalizeOptionGroup(value: unknown): PickupOrderSelectedOptionGroup | null {
  if (!isRecord(value)) return null;
  const optionGroupId = readNumber(value.optionGroupId);
  const key = readString(value.key);
  const name_en = readString(value.name_en);
  const name_ko = readString(value.name_ko);
  const type = readString(value.type);
  const selectedOptions = Array.isArray(value.selectedOptions)
    ? value.selectedOptions.map(normalizeOption).filter((option) => option !== null)
    : null;

  if (
    optionGroupId == null ||
    !key ||
    name_en == null ||
    name_ko == null ||
    !type ||
    !groupTypes.has(type) ||
    selectedOptions == null
  ) {
    return null;
  }

  return {
    optionGroupId,
    key,
    name_en,
    name_ko,
    type: type as PickupOrderSelectedOptionGroup["type"],
    selectedOptions,
  };
}

export function normalizeSelectedOptionGroups(
  value: unknown,
): PickupOrderSelectedOptionGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeOptionGroup)
    .filter((group) => group !== null);
}

export function normalizePickupOrderLine(line: PickupOrderLineWire): PickupOrderLine {
  return {
    ...line,
    selectedOptionsSnapshot: normalizeSelectedOptionGroups(
      line.selectedOptionsSnapshot,
    ),
  };
}

export function normalizePickupOrderListItem(
  order: PickupOrderListItemWire,
): PickupOrderListItem {
  return {
    ...order,
    lines: order.lines.map(normalizePickupOrderLine),
  };
}

export function normalizePickupOrderDetail(
  order: PickupOrderDetailWire,
): PickupOrderDetail {
  return normalizePickupOrderListItem(order);
}

export function formatPickupMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;
}

export function formatPickupQty(qty: number, uom: string): string {
  const display = (qty / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
  return `${display} ${uom}`.trim();
}

export function formatPickupTime(value: string): string {
  return dayjsAU(value).format("ddd, DD MMM YYYY hh:mm A");
}

export function countSelectedOptions(groups: PickupOrderSelectedOptionGroup[]): number {
  return groups.reduce((sum, group) => sum + group.selectedOptions.length, 0);
}

export function statusLabel(status: PickupOrderStatus): string {
  return status.replaceAll("_", " ");
}
```

Implementation note: if TypeScript cannot narrow `filter((x) => x !== null)`, replace both filters with explicit type guards:

```ts
function present<T>(value: T | null): value is T {
  return value !== null;
}
```

- [ ] **Step 3: Add pure helper tests**

Create `scripts/tests/pickup-order-format.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  countSelectedOptions,
  formatPickupMoney,
  formatPickupQty,
  normalizeSelectedOptionGroups,
  statusLabel,
} from "../../src/renderer/src/components/pickupOrders/pickup-order-format.ts";

test("normalizeSelectedOptionGroups drops invalid top-level values", () => {
  assert.deepEqual(normalizeSelectedOptionGroups(null), []);
  assert.deepEqual(normalizeSelectedOptionGroups({}), []);
});

test("normalizeSelectedOptionGroups keeps valid groups and drops invalid children", () => {
  const groups = normalizeSelectedOptionGroups([
    {
      optionGroupId: 1,
      key: "build",
      name_en: "Build",
      name_ko: "구성",
      type: "QUANTITY",
      selectedOptions: [
        {
          key: "salmon",
          name_en: "Salmon",
          name_ko: "연어",
          qty: 8000,
          priceDelta: 0,
        },
        { key: "bad" },
      ],
    },
    { optionGroupId: 2, key: "bad", type: "UNKNOWN", selectedOptions: [] },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].selectedOptions.length, 1);
  assert.equal(countSelectedOptions(groups), 1);
});

test("format helpers use POS scaled integer conventions", () => {
  assert.equal(formatPickupMoney(1299), "$12.99");
  assert.equal(formatPickupQty(1000, "ea"), "1 ea");
  assert.equal(formatPickupQty(1250, "kg"), "1.25 kg");
  assert.equal(statusLabel("ORDER_CONFIRMED"), "ORDER CONFIRMED");
});
```

- [ ] **Step 4: Run the pure helper test and confirm it passes**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-order-format.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add renderer API service**

Create `pickup-order.service.ts`:

```ts
import apiService, { type ApiResponse } from "../libs/api";
import {
  normalizePickupOrderDetail,
  normalizePickupOrderListItem,
} from "../components/pickupOrders/pickup-order-format";
import type {
  PickupOrderDetail,
  PickupOrderDetailWire,
  PickupOrderListItem,
  PickupOrderListItemWire,
  PickupOrderListParams,
} from "../components/pickupOrders/pickup-order-types";

export async function searchPickupOrders(
  params: PickupOrderListParams,
): Promise<ApiResponse<PickupOrderListItem[]>> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.memberId) qs.set("memberId", params.memberId);

  const q = qs.toString();
  const res = await apiService.get<PickupOrderListItemWire[]>(
    q ? `/api/pickup-order?${q}` : "/api/pickup-order",
  );

  return {
    ...res,
    result: Array.isArray(res.result)
      ? res.result.map(normalizePickupOrderListItem)
      : null,
  };
}

export async function getPickupOrderByCrmId(
  crmOrderId: number,
): Promise<ApiResponse<PickupOrderDetail>> {
  const res = await apiService.get<PickupOrderDetailWire>(
    `/api/pickup-order/${crmOrderId}`,
  );

  return {
    ...res,
    result: res.result ? normalizePickupOrderDetail(res.result) : null,
  };
}
```

- [ ] **Step 6: Verify service compiles**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds or fails only on later tasks not yet implemented. If it fails here, fix type/import issues in the new helper/service files before continuing.

---

## Task 3: Pickup Order Search Panel

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`

- [ ] **Step 1: Build filter and result state**

Use this state shape:

```tsx
const PAGE_SIZE = 20;

const [keyword, setKeyword] = useState("");
const [from, setFrom] = useState<Dayjs | null>(null);
const [to, setTo] = useState<Dayjs | null>(null);
const [statusFilter, setStatusFilter] =
  useState<PickupOrderStatusFilter>("ALL");
const [member, setMember] = useState<MemberSearchSelection | null>(null);
const [memberModalOpen, setMemberModalOpen] = useState(false);

const [items, setItems] = useState<PickupOrderListItem[]>([]);
const [paging, setPaging] = useState<PagingType | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
```

- [ ] **Step 2: Implement `fetchPage`, `Search`, and `Reset`**

Use this fetch contract:

```tsx
const fetchPage = useCallback(
  async (page: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await searchPickupOrders({
        page,
        limit: PAGE_SIZE,
        keyword: keyword.trim() || undefined,
        from: from?.toISOString(),
        to: to?.toISOString(),
        status: statusFilter === "ALL" ? undefined : statusFilter,
        memberId: member?.id,
      });
      if (res.ok && res.result) {
        setItems(res.result);
        setPaging(res.paging);
      } else {
        setItems([]);
        setPaging(res.paging);
        setError(res.msg || "Failed to load pickup orders");
      }
    } finally {
      setLoading(false);
    }
  },
  [keyword, from, to, statusFilter, member],
);
```

Initial load:

```tsx
useEffect(() => {
  void fetchPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Reset:

```tsx
function reset() {
  setKeyword("");
  setFrom(null);
  setTo(null);
  setStatusFilter("ALL");
  setMember(null);
  setError("");
}
```

- [ ] **Step 3: Implement filter bar**

Include:

- `KeyboardInputText` placeholder: `Keyword (document / member / item / barcode)`.
- `DateRangeSelector`.
- Member chip using `MemberSearchModal`.
- Status segmented control with:
  - `ALL`
  - `PENDING`
  - `ORDER_CONFIRMED`
  - `READY`
  - `COMPLETED`
  - `CANCELLED_BY_STORE`
  - `CANCELLED_BY_CUSTOMER`
- `Reset` and `Search` buttons.

Use `onPointerDown` to match existing POS tap patterns.

- [ ] **Step 4: Implement list rows**

Each row should show:

- `documentId`.
- `formatPickupTime(pickupStartsAt)`.
- status badge.
- `memberName` and `memberPhoneLast4`.
- first line `name_ko` then `name_en`.
- `lines.length` or `linesTotal` count.
- `formatPickupMoney(total)`.
- small `NOTE` cue when first line has `note`.
- small `OPTIONS N` cue when first line selected option count is greater than zero.

Row key and click:

```tsx
<tr
  key={order.crmOrderId}
  onPointerDown={() => onSelect(order)}
  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-blue-50"
>
```

Empty and error states:

```tsx
{error && (
  <div className="px-3 py-2 border-b border-red-100 bg-red-50 text-red-700 text-xs">
    {error}
  </div>
)}

{items.length === 0 && !loading ? (
  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
    No pickup orders
  </div>
) : (
  /* table */
)}
```

- [ ] **Step 5: Implement pagination**

Reuse the same shape as `SaleInvoiceSearchPanel`:

```tsx
<button
  type="button"
  disabled={!paging?.hasPrev}
  onPointerDown={() => paging && fetchPage(paging.currentPage - 1)}
>
  Prev
</button>
<span>{paging ? `${paging.currentPage} / ${paging.totalPages}` : "- / -"}</span>
<button
  type="button"
  disabled={!paging?.hasNext}
  onPointerDown={() => paging && fetchPage(paging.currentPage + 1)}
>
  Next
</button>
```

- [ ] **Step 6: Verify panel compiles**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds or fails only because the screen/route/viewer are not wired yet. Fix any `PickupOrderSearchPanel` type or import errors before moving on.

---

## Task 4: Work-Order Label Preview

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderWorkLabelPreview.tsx`

- [ ] **Step 1: Create component contract**

Use:

```tsx
type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
};
```

- [ ] **Step 2: Implement 100x100mm preview layout**

The root preview should be stable and inspectable:

```tsx
<div className="w-[100mm] h-[100mm] bg-white text-black border border-gray-300 p-3 font-mono overflow-hidden">
```

Required content:

- `PICKUP WORK ORDER`.
- Pickup time.
- `documentId`.
- line index and status.
- customer name and phone last4.
- item Korean name.
- item English name or `code`.
- `formatPickupQty(line.qty, line.uom)`.
- compact option groups.
- strong customer note block.
- prep checkboxes:
  - `Built`
  - `Checked`
  - `Sauces`
  - `Cold pack`
  - `Member`
  - `Handoff`
- QR/DataMatrix placeholder block containing `pickup-order-line`.

- [ ] **Step 3: Render compact option groups**

Use Korean first:

```tsx
const groupLabel = group.name_ko || group.name_en || group.key;
const optionLabel = option.name_ko || option.name_en || option.key;
```

Show option quantities using `formatPickupQty(option.qty, "")`. Do not show price deltas in the label preview unless a future task explicitly asks for pricing.

For overflow safety:

- Limit the preview option area height with `max-h` and `overflow-hidden`.
- Show full options in `PickupOrderViewer` side metadata in Task 5.

- [ ] **Step 4: Verify preview compiles**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds or fails only because viewer/screen are not wired yet. Fix preview type/import issues before moving on.

---

## Task 5: Read-Only Viewer Modal

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Create modal state and detail load**

Use this contract:

```tsx
type Props = {
  crmOrderId: number | null;
  onClose: () => void;
};
```

State:

```tsx
const [order, setOrder] = useState<PickupOrderDetail | null>(null);
const [selectedCrmLineId, setSelectedCrmLineId] = useState<number | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
```

On open:

```tsx
useEffect(() => {
  if (crmOrderId == null) return;
  setOrder(null);
  setSelectedCrmLineId(null);
  setError("");
  setLoading(true);
  getPickupOrderByCrmId(crmOrderId).then((res) => {
    if (res.ok && res.result) {
      setOrder(res.result);
      setSelectedCrmLineId(res.result.lines[0]?.crmLineId ?? null);
    } else {
      setError(res.msg || "Failed to load pickup order");
    }
    setLoading(false);
  });
}, [crmOrderId]);
```

Selected line:

```tsx
const selectedLine =
  order?.lines.find((line) => line.crmLineId === selectedCrmLineId) ??
  order?.lines[0] ??
  null;
```

- [ ] **Step 2: Implement modal shell**

Use a fixed overlay like `SaleInvoiceViewer`, with:

- Header title `Pickup Order`.
- Close button.
- No action buttons.
- Loading state.
- Error state.
- Content max size around `max-w-[1180px] max-h-[92vh]`.

- [ ] **Step 3: Implement two-column layout**

Left column:

- order summary.
- line selector.
- if `order.lines.length === 1`, show one summary row without noisy navigation styling.
- line rows show `NOTE` and `OPTIONS N` cues.

Right column:

- `PickupOrderWorkLabelPreview`.
- selected line metadata:
  - barcode.
  - code.
  - member level.
  - line total and option total.
  - full selected option groups.
  - full customer note.

- [ ] **Step 4: Keep modal read-only**

Do not add:

- Sync button.
- Status buttons.
- Print button.
- Checkbox state persistence.
- Socket refresh.

- [ ] **Step 5: Verify viewer compiles**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds or fails only because the screen/route are not wired yet. Fix viewer type/import issues before moving on.

---

## Task 6: Screen, Scope Gate, Route, And Home Tile

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/App.tsx`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Create the screen wrapper**

Use:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BlockScreen from "../components/BlockScreen";
import PickupOrderSearchPanel from "../components/pickupOrders/PickupOrderSearchPanel";
import PickupOrderViewer from "../components/pickupOrders/PickupOrderViewer";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";

export default function PickupOrderSearchScreen() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [viewerCrmOrderId, setViewerCrmOrderId] = useState<number | null>(null);

  if (!user || !hasScope(user.scope, ["sale"])) {
    return <BlockScreen />;
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          Back
        </button>
        <h1 className="text-lg font-bold">Pickup Orders</h1>
      </div>

      <div className="flex-1 min-h-0">
        <PickupOrderSearchPanel
          onSelect={(order) => setViewerCrmOrderId(order.crmOrderId)}
        />
      </div>

      <PickupOrderViewer
        crmOrderId={viewerCrmOrderId}
        onClose={() => setViewerCrmOrderId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `App.tsx`, import:

```ts
import PickupOrderSearchScreen from "./screens/PickupOrderSearchScreen";
```

Add under the `/manager` route:

```tsx
<Route path="pickup-orders" element={<PickupOrderSearchScreen />} />
```

- [ ] **Step 3: Add the Sales home tile**

In `HomeScreen.tsx`, import:

```ts
IoBagCheckOutline,
```

Add under the Sales section, near `Invoice Search`:

```tsx
<NavBtn
  to="/manager/pickup-orders"
  icon={<IoBagCheckOutline size={24} />}
  className="bg-blue-50 text-blue-700 hover:bg-blue-100"
>
  Pickup Orders
</NavBtn>
```

This tile is visible even when no shift is open, matching the spec.

- [ ] **Step 4: Verify route wiring**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds.

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "pickup-orders|PickupOrderSearchScreen|Pickup Orders|IoBagCheckOutline" retail_pos_app/src/renderer/src/App.tsx retail_pos_app/src/renderer/src/screens/HomeScreen.tsx retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx
```

Expected: route, screen import, home tile, and icon import are present.

---

## Task 7: Documentation And Final Verification

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/README.md`

- [ ] **Step 1: Update app route docs**

Add this route row to the App Routes table:

```md
| `/manager/pickup-orders` | PickupOrderSearchScreen | — | sale | Cached pickup order search and read-only work-order viewer |
```

- [ ] **Step 2: Update server API docs**

Add this row to the Server API Routes table:

```md
| `/pickup-order` | Pickup Order | user + sale | Cached pickup order list/detail/manual sync |
```

- [ ] **Step 3: Run full verification commands**

Server:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.query.test.js
```

App pure helper:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-order-format.test.ts
```

App build:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Renderer purity check:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n "from ['\\\"](electron|fs|path)['\\\"]|require\\(['\\\"](electron|fs|path)['\\\"]\\)" retail_pos_app/src/renderer/src
```

Expected: no renderer imports of Electron or Node APIs. Existing `window.electronAPI` usages in current app files are allowed.

- [ ] **Step 4: Manual QA checklist**

Run the app and verify:

- A user without `sale` scope sees `BlockScreen` at `/manager/pickup-orders`.
- A user with `sale` scope can enter `/manager/pickup-orders`.
- Initial load fetches page 1.
- Keyword search sends `keyword`.
- Date range search sends `from` and `to` for `pickupStartsAt`.
- Member search opens `MemberSearchModal`, selecting a member sends `memberId`, and clearing chip removes `memberId`.
- Status segment sends selected status; `ALL` omits status.
- Reset clears keyword/date/member/status/error.
- Empty result shows `No pickup orders`.
- API failure shows inline error and leaves the screen usable.
- Row click opens viewer and preserves filters/paging behind the modal.
- One-line order auto-selects first line.
- Multi-line seeded order lets user switch selected lines.
- Many options remain compact in the 100x100 preview and complete in side metadata.
- Long note is prominent, clipped safely in label preview, and full in side metadata.
- No sync/status/print controls are visible.

---

## Implementation Order Summary

1. Server API contract tests and implementation.
2. Renderer pickup order types, pure helpers, service, and helper test.
3. Search panel.
4. Work-order label preview.
5. Viewer modal.
6. Screen route, scope gate, home tile.
7. README docs and final verification.

This order keeps server response shape stable before UI work, then builds the renderer from testable pure logic outward to the route.

---

## Self-Review

- Spec coverage:
  - Route, `ManagerLayout`, home tile, no-open-shift behavior: Task 6.
  - `sale` scope on client and server: Task 1 and Task 6.
  - List filters and member search: Task 3.
  - API `memberId`, paging/result shape, detail naming: Task 1 and Task 2.
  - Defensive option normalization: Task 2.
  - Viewer modal and two-column line selection: Task 5.
  - 100x100mm work-order preview: Task 4.
  - No polling/socket/sync/status/print actions: Task 5 and manual QA.
  - Verification commands: Task 7.
- Placeholder scan: no `TBD`, no "implement later", and no unspecified test bucket remains.
- Type consistency:
  - Renderer uses `crmOrderId` for detail path.
  - `PickupOrderStatusFilter` is `"ALL" | PickupOrderStatus`.
  - Server `memberId` is a string filter against `PickupOrderCache.memberId`.
  - Paging shape matches `PagingType` in `retail_pos_app/src/renderer/src/libs/api.ts`.
