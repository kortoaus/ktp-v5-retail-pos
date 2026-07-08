# Pickup Order Status Print History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce pickup order status/print business rules and persist successful pickup label print history at pickup order level.

**Architecture:** CRM remains the canonical owner of pickup order status transitions. The retail POS server owns local authorization, print-history persistence, and pickup-order cache reads. The renderer consumes small policy/service helpers so CTA state, print flow, list badges, and detail messages all derive from the same rules.

**Tech Stack:** TypeScript, React 19, Electron renderer, Express 5, Prisma 7, PostgreSQL, Node `node:test`.

---

## Source Spec

Read before implementation:

- `docs/superpowers/specs/2026-07-08-pickup-order-status-print-history-design.md`
- `docs/superpowers/specs/2026-07-07-pickup-order-status-actions-design.md`
- `docs/superpowers/specs/2026-07-08-pickup-order-label-print-design.md`
- `/Users/dev/ktpv5/ktpv5-crm-server/docs/CODEX_CRM_SERVER_CONTEXT.md`
- `README.md`
- `retail_pos_app/AGENTS.md`

Do not migrate or modify `PrintedItemSheet` behavior. Existing item-sheet printed routes and UI stay as-is.

## File Structure

CRM server, canonical status transition validation:

- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.policy.ts`
  - Pure status transition matrix for CRM.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.service.ts`
  - Call the policy after loading the locked current status and before updating.
- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrderStatus.policy.test.ts`
  - Tests picked up by CRM `npm test`.

Retail POS server, local authorization and printed history:

- Modify `retail_pos_server/prisma/schema.prisma`
  - Add `PrintedHistory`.
- Create `retail_pos_server/prisma/migrations/20260708000000_add_printed_history/migration.sql`
  - Add table and indexes.
- Create `retail_pos_server/src/v1/printed-history/printed-history.types.ts`
  - Entity type constants and DTO types.
- Create `retail_pos_server/src/v1/printed-history/printed-history.validation.ts`
  - Request body and query parsing.
- Create `retail_pos_server/src/v1/printed-history/printed-history.service.ts`
  - Insert print history and summarize latest prints.
- Create `retail_pos_server/src/v1/printed-history/printed-history.controller.ts`
  - Express controllers.
- Create `retail_pos_server/src/v1/printed-history/printed-history.router.ts`
  - Authenticated `/api/printed-history` routes.
- Create `retail_pos_server/src/v1/printed-history/printed-history.test.ts`
  - Validation, service, and router tests.
- Modify `retail_pos_server/src/router.ts`
  - Mount printed-history router.
- Create `retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`
  - POS-side transition and manager policy.
- Modify `retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`
  - Load current cached pickup order status and enforce manager-only transitions before CRM call.
- Modify `retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
  - Pass POS user scopes into the status service.
- Modify `retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`
  - Add manager-only and transition tests.

Retail POS app, list/detail UI and print flow:

- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.ts`
  - Renderer print and status transition policy.
- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs`
  - Node policy tests.
- Create `retail_pos_app/src/renderer/src/service/printed-history.service.ts`
  - GET/POST printed-history API wrappers.
- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`
  - Fetch printed summaries for visible orders and show compact `Printed` badge.
- Modify `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Block terminal printing, save history after successful print, auto-confirm pending orders, and show print-history status.

## Task 1: CRM Status Transition Policy

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.policy.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrderStatus.policy.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.service.ts`

- [ ] **Step 1: Write the failing CRM policy test**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrderStatus.policy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPickupOrderStatusTransitionAllowed,
  canTransitionPickupOrderStatus,
} from "../device/pickup-order/pickupOrderStatus.policy";
import { BadRequestException } from "./exceptions";

test("canTransitionPickupOrderStatus allows forward pickup status flow", () => {
  assert.equal(canTransitionPickupOrderStatus("PENDING", "ORDER_CONFIRMED"), true);
  assert.equal(canTransitionPickupOrderStatus("PENDING", "CANCELLED_BY_STORE"), true);
  assert.equal(canTransitionPickupOrderStatus("ORDER_CONFIRMED", "READY"), true);
  assert.equal(canTransitionPickupOrderStatus("ORDER_CONFIRMED", "CANCELLED_BY_STORE"), true);
  assert.equal(canTransitionPickupOrderStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionPickupOrderStatus("READY", "CANCELLED_BY_STORE"), true);
});

test("canTransitionPickupOrderStatus blocks rollback and terminal changes", () => {
  assert.equal(canTransitionPickupOrderStatus("READY", "ORDER_CONFIRMED"), false);
  assert.equal(canTransitionPickupOrderStatus("READY", "PENDING"), false);
  assert.equal(canTransitionPickupOrderStatus("COMPLETED", "READY"), false);
  assert.equal(canTransitionPickupOrderStatus("CANCELLED_BY_STORE", "PENDING"), false);
  assert.equal(canTransitionPickupOrderStatus("CANCELLED_BY_CUSTOMER", "READY"), false);
});

test("assertPickupOrderStatusTransitionAllowed throws clear bad request", () => {
  assert.throws(
    () => assertPickupOrderStatusTransitionAllowed("READY", "PENDING"),
    (error) =>
      error instanceof BadRequestException &&
      error.statusCode === 400 &&
      error.message === "Cannot change pickup order from READY to PENDING",
  );
});
```

- [ ] **Step 2: Run the CRM test to verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: FAIL because `pickupOrderStatus.policy` does not exist.

- [ ] **Step 3: Implement the CRM policy**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.policy.ts`:

```ts
import { BadRequestException } from "../../libs/exceptions";
import type { PickupOrderSyncItemDto } from "./pickupOrderSync.types";
import type { PosPickupOrderStatus } from "./pickupOrderStatus.validation";

type PickupOrderStatus = PickupOrderSyncItemDto["status"];

const allowedTransitions: Record<PickupOrderStatus, readonly PosPickupOrderStatus[]> = {
  PENDING: ["ORDER_CONFIRMED", "CANCELLED_BY_STORE"],
  ORDER_CONFIRMED: ["READY", "CANCELLED_BY_STORE"],
  READY: ["COMPLETED", "CANCELLED_BY_STORE"],
  COMPLETED: [],
  CANCELLED_BY_STORE: [],
  CANCELLED_BY_CUSTOMER: [],
};

export function canTransitionPickupOrderStatus(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

export function assertPickupOrderStatusTransitionAllowed(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): void {
  if (canTransitionPickupOrderStatus(fromStatus, toStatus)) return;
  throw new BadRequestException(
    `Cannot change pickup order from ${fromStatus} to ${toStatus}`,
  );
}
```

- [ ] **Step 4: Wire the CRM service to the policy**

Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.service.ts`:

```ts
import { assertPickupOrderStatusTransitionAllowed } from "./pickupOrderStatus.policy";
```

Inside the transaction, after the `if (!existing)` block and before `tx.pickupOrder.update(...)`, add:

```ts
    assertPickupOrderStatusTransitionAllowed(existing.status, input.status);
```

- [ ] **Step 5: Run CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: PASS with CRM test suite reporting zero failures.

- [ ] **Step 6: Commit CRM policy**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/device/pickup-order/pickupOrderStatus.policy.ts src/device/pickup-order/pickupOrderStatus.service.ts src/libs/pickupOrderStatus.policy.test.ts
git commit -m "feat: enforce pickup order status transitions"
```

## Task 2: POS Server Status Authorization Policy

**Files:**
- Create: `retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`
- Modify: `retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`
- Modify: `retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
- Modify: `retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`

- [ ] **Step 1: Write failing POS manager-policy tests**

Append to `retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`:

```ts
import {
  canTransitionPickupOrderStatus,
  requiresManagerForPickupOrderStatusTransition,
} from "./pickup-order.status-policy";

test("pickup POS status policy marks ready cancellation as manager-only", () => {
  assert.equal(canTransitionPickupOrderStatus("READY", "CANCELLED_BY_STORE"), true);
  assert.equal(
    requiresManagerForPickupOrderStatusTransition("READY", "CANCELLED_BY_STORE"),
    true,
  );
  assert.equal(
    requiresManagerForPickupOrderStatusTransition("ORDER_CONFIRMED", "CANCELLED_BY_STORE"),
    false,
  );
});

test("updatePickupOrderStatusFromPos blocks ready cancellation for non-admin users", async () => {
  await assert.rejects(
    () =>
      updatePickupOrderStatusFromPos(
        {
          orderId: 42,
          body: { status: "CANCELLED_BY_STORE" },
          user: { id: 12, name: "Alice", scope: ["sale"] },
        },
        {
          getLocalPickupOrderStatus: async () => "READY",
          updateCrmStatus: async () => pickupOrderWire,
          upsertLocalPickupOrder: async () => undefined,
        },
      ),
    (error) =>
      error instanceof UnauthorizedException &&
      error.message === "Manager permission required",
  );
});

test("updatePickupOrderStatusFromPos allows ready cancellation for admin users", async () => {
  const calls: unknown[] = [];
  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "CANCELLED_BY_STORE" },
      user: { id: 1, name: "Manager", scope: ["admin"] },
    },
    {
      getLocalPickupOrderStatus: async () => "READY",
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "CANCELLED_BY_STORE" };
      },
      upsertLocalPickupOrder: async () => undefined,
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "CANCELLED_BY_STORE",
        actorId: "1",
        actorName: "Manager",
      },
    },
  ]);
});
```

Also update the existing `updatePickupOrderStatusFromPos sends CRM status and actor snapshot` test input user to include scope:

```ts
user: { id: 12, name: "Alice", scope: ["sale"] },
```

- [ ] **Step 2: Run POS status tests to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build && node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: FAIL because `pickup-order.status-policy` and `getLocalPickupOrderStatus` do not exist.

- [ ] **Step 3: Implement POS status policy**

Create `retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`:

```ts
import { BadRequestException, UnauthorizedException } from "../../libs/exceptions";
import type { PickupOrderStatus } from "./pickup-order.types";
import type { PosPickupOrderStatus } from "./pickup-order.status";

const allowedTransitions: Record<PickupOrderStatus, readonly PosPickupOrderStatus[]> = {
  PENDING: ["ORDER_CONFIRMED", "CANCELLED_BY_STORE"],
  ORDER_CONFIRMED: ["READY", "CANCELLED_BY_STORE"],
  READY: ["COMPLETED", "CANCELLED_BY_STORE"],
  COMPLETED: [],
  CANCELLED_BY_STORE: [],
  CANCELLED_BY_CUSTOMER: [],
};

export function canTransitionPickupOrderStatus(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

export function requiresManagerForPickupOrderStatusTransition(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return fromStatus === "READY" && toStatus === "CANCELLED_BY_STORE";
}

export function assertPickupOrderStatusTransitionAllowed(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): void {
  if (canTransitionPickupOrderStatus(fromStatus, toStatus)) return;
  throw new BadRequestException(
    `Cannot change pickup order from ${fromStatus} to ${toStatus}`,
  );
}

export function assertPickupOrderStatusManagerAllowed(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
  userScopes: readonly string[],
): void {
  if (!requiresManagerForPickupOrderStatusTransition(fromStatus, toStatus)) return;
  if (userScopes.includes("admin")) return;
  throw new UnauthorizedException("Manager permission required");
}
```

- [ ] **Step 4: Load local status and enforce policy in POS status service**

Modify `retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`.

Imports:

```ts
import db from "../../libs/db";
import { NotFoundException } from "../../libs/exceptions";
import {
  assertPickupOrderStatusManagerAllowed,
  assertPickupOrderStatusTransitionAllowed,
} from "./pickup-order.status-policy";
```

Update `PosUserSnapshot`:

```ts
type PosUserSnapshot = {
  id: number;
  name: string;
  scope: string[];
};
```

Add dependency:

```ts
type Deps = {
  updateCrmStatus?: typeof updateCrmPickupOrderStatus;
  upsertLocalPickupOrder?: (items: CrmPickupOrderWire[]) => Promise<unknown>;
  getLocalPickupOrderStatus?: (orderId: number) => Promise<PickupOrderStatus>;
};
```

Add helper:

```ts
async function getCachedPickupOrderStatus(orderId: number): Promise<PickupOrderStatus> {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId: orderId },
    select: { status: true },
  });
  if (!row) {
    throw new NotFoundException("Pickup order not found");
  }
  return row.status as PickupOrderStatus;
}
```

Inside `updatePickupOrderStatusFromPos`, after `parsed` and dependencies:

```ts
  const getLocalPickupOrderStatus =
    deps.getLocalPickupOrderStatus ?? getCachedPickupOrderStatus;
  const currentStatus = await getLocalPickupOrderStatus(input.orderId);
  assertPickupOrderStatusTransitionAllowed(currentStatus, parsed.status);
  assertPickupOrderStatusManagerAllowed(
    currentStatus,
    parsed.status,
    input.user.scope,
  );
```

- [ ] **Step 5: Pass user scopes from controller**

Modify `retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`:

```ts
  user: { id: user.id, name: user.name, scope: user.scope },
```

- [ ] **Step 6: Run POS status tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build && node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit POS status policy**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts retail_pos_server/src/v1/pickup-order/pickup-order.status.ts retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts
git commit -m "feat: enforce pickup order status rules in POS"
```

## Task 3: PrintedHistory Schema And Server API

**Files:**
- Modify: `retail_pos_server/prisma/schema.prisma`
- Create: `retail_pos_server/prisma/migrations/20260708000000_add_printed_history/migration.sql`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.types.ts`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.validation.ts`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.service.ts`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.controller.ts`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.router.ts`
- Create: `retail_pos_server/src/v1/printed-history/printed-history.test.ts`
- Modify: `retail_pos_server/src/router.ts`

- [ ] **Step 1: Write failing printed-history tests**

Create `retail_pos_server/src/v1/printed-history/printed-history.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import printedHistoryRouter from "./printed-history.router";
import {
  parsePrintedHistoryBody,
  parsePrintedHistoryQuery,
} from "./printed-history.validation";
import {
  createPrintedHistoryService,
  getPrintedHistorySummariesService,
} from "./printed-history.service";

test("parsePrintedHistoryBody accepts pickup order entity", () => {
  assert.deepEqual(
    parsePrintedHistoryBody({ entityType: "PICKUP_ORDER", entityId: 42 }),
    { entityType: "PICKUP_ORDER", entityId: 42 },
  );
});

test("parsePrintedHistoryBody rejects unsupported entity type", () => {
  assert.throws(
    () => parsePrintedHistoryBody({ entityType: "ITEM_SHEET", entityId: 42 }),
    /entityType must be a supported printed history entity type/,
  );
});

test("parsePrintedHistoryQuery parses comma-separated entity ids", () => {
  assert.deepEqual(
    parsePrintedHistoryQuery({ entityType: "PICKUP_ORDER", entityIds: "42,43" }),
    { entityType: "PICKUP_ORDER", entityIds: [42, 43] },
  );
});

test("createPrintedHistoryService verifies pickup order exists and inserts history", async () => {
  const calls: unknown[] = [];
  const service = createPrintedHistoryService({
    pickupOrderCache: {
      findUnique: async (args: unknown) => {
        calls.push({ method: "findUnique", args });
        return { crmOrderId: 42 };
      },
    },
    printedHistory: {
      create: async (args: unknown) => {
        calls.push({ method: "create", args });
        return {
          id: 7,
          entityType: "PICKUP_ORDER",
          entityId: 42,
          printedAt: new Date("2026-07-08T01:00:00.000Z"),
          userId: 12,
          userName: "Alice",
        };
      },
      groupBy: async () => [],
      findMany: async () => [],
    },
  });

  const result = await service(
    { entityType: "PICKUP_ORDER", entityId: 42 },
    { id: 12, name: "Alice" },
  );

  assert.equal(result.result.entityId, 42);
  assert.deepEqual(calls.map((call) => (call as { method: string }).method), [
    "findUnique",
    "create",
  ]);
});

test("getPrintedHistorySummariesService returns print counts and latest users", async () => {
  const service = getPrintedHistorySummariesService({
    printedHistory: {
      groupBy: async () => [
        { entityId: 42, _count: { _all: 2 } },
        { entityId: 43, _count: { _all: 1 } },
      ],
      findMany: async () => [
        {
          entityId: 42,
          printedAt: new Date("2026-07-08T02:00:00.000Z"),
          userId: 13,
          userName: "Bob",
        },
        {
          entityId: 43,
          printedAt: new Date("2026-07-08T01:00:00.000Z"),
          userId: null,
          userName: null,
        },
      ],
      create: async () => {
        throw new Error("not used");
      },
    },
    pickupOrderCache: {
      findUnique: async () => null,
    },
  });

  const result = await service({
    entityType: "PICKUP_ORDER",
    entityIds: [42, 43],
  });

  assert.deepEqual(result.result, [
    {
      entityId: 42,
      printCount: 2,
      lastPrintedAt: "2026-07-08T02:00:00.000Z",
      lastPrintedByUserId: 13,
      lastPrintedByUserName: "Bob",
    },
    {
      entityId: 43,
      printCount: 1,
      lastPrintedAt: "2026-07-08T01:00:00.000Z",
      lastPrintedByUserId: null,
      lastPrintedByUserName: null,
    },
  ]);
});

test("printedHistoryRouter registers GET and POST root routes", () => {
  const stack = (printedHistoryRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const getIndex = stack.findIndex((layer) => layer.route?.path === "/" && layer.route.methods.get);
  const postIndex = stack.findIndex((layer) => layer.route?.path === "/" && layer.route.methods.post);

  assert.ok(getIndex >= 0);
  assert.ok(postIndex >= 0);
});
```

- [ ] **Step 2: Run printed-history tests to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build && node --test dist/v1/printed-history/printed-history.test.js
```

Expected: FAIL because printed-history files do not exist.

- [ ] **Step 3: Add Prisma schema and migration**

Modify `retail_pos_server/prisma/schema.prisma` after `PrintedItemSheet`:

```prisma
model PrintedHistory {
  id         Int      @id @default(autoincrement())
  entityType String
  entityId   Int
  printedAt  DateTime @default(now())
  userId     Int?
  userName   String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([entityType, entityId])
  @@index([entityType, printedAt])
}
```

Create `retail_pos_server/prisma/migrations/20260708000000_add_printed_history/migration.sql`:

```sql
CREATE TABLE "PrintedHistory" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintedHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintedHistory_entityType_entityId_idx" ON "PrintedHistory"("entityType", "entityId");
CREATE INDEX "PrintedHistory_entityType_printedAt_idx" ON "PrintedHistory"("entityType", "printedAt");
```

- [ ] **Step 4: Generate Prisma client**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npx prisma generate
```

Expected: `src/generated/prisma` updates successfully. If generated files change, include them in the commit because this repo imports Prisma from `src/generated/prisma`.

- [ ] **Step 5: Add printed-history types**

Create `retail_pos_server/src/v1/printed-history/printed-history.types.ts`:

```ts
export const PRINTED_HISTORY_ENTITY_PICKUP_ORDER = "PICKUP_ORDER" as const;

export const PRINTED_HISTORY_ENTITY_TYPES = [
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
] as const;

export type PrintedHistoryEntityType =
  (typeof PRINTED_HISTORY_ENTITY_TYPES)[number];

export type PrintedHistoryBody = {
  entityType: PrintedHistoryEntityType;
  entityId: number;
};

export type PrintedHistoryQuery = {
  entityType: PrintedHistoryEntityType;
  entityIds: number[];
};

export type PrintedHistoryUser = {
  id: number;
  name: string;
};

export type PrintedHistorySummary = {
  entityId: number;
  printCount: number;
  lastPrintedAt: string;
  lastPrintedByUserId: number | null;
  lastPrintedByUserName: string | null;
};
```

- [ ] **Step 6: Add printed-history validation**

Create `retail_pos_server/src/v1/printed-history/printed-history.validation.ts`:

```ts
import { BadRequestException } from "../../libs/exceptions";
import {
  PRINTED_HISTORY_ENTITY_TYPES,
  type PrintedHistoryBody,
  type PrintedHistoryEntityType,
  type PrintedHistoryQuery,
} from "./printed-history.types";

const positiveIntegerPattern = /^[1-9]\d*$/;
const maxPostgresInt = 2147483647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  const raw = String(value);
  if (!positiveIntegerPattern.test(raw)) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  const parsed = Number(raw);
  if (parsed > maxPostgresInt) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseEntityType(value: unknown): PrintedHistoryEntityType {
  if (
    typeof value !== "string" ||
    !(PRINTED_HISTORY_ENTITY_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException(
      "entityType must be a supported printed history entity type",
    );
  }
  return value as PrintedHistoryEntityType;
}

export function parsePrintedHistoryBody(body: unknown): PrintedHistoryBody {
  if (!isRecord(body)) {
    throw new BadRequestException("Printed history body is required");
  }
  return {
    entityType: parseEntityType(body.entityType),
    entityId: parsePositiveInt(body.entityId, "entityId"),
  };
}

export function parsePrintedHistoryQuery(
  query: Record<string, unknown>,
): PrintedHistoryQuery {
  const entityType = parseEntityType(query.entityType);
  const rawEntityIds = query.entityIds;
  if (typeof rawEntityIds !== "string" || rawEntityIds.trim() === "") {
    throw new BadRequestException("entityIds must be a comma-separated list");
  }

  const entityIds = rawEntityIds
    .split(",")
    .map((part) => parsePositiveInt(part.trim(), "entityIds"));

  return { entityType, entityIds: [...new Set(entityIds)] };
}
```

- [ ] **Step 7: Add printed-history services**

Create `retail_pos_server/src/v1/printed-history/printed-history.service.ts`:

```ts
import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import {
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
  type PrintedHistoryBody,
  type PrintedHistoryQuery,
  type PrintedHistorySummary,
  type PrintedHistoryUser,
} from "./printed-history.types";

type PrintedHistoryClient = {
  pickupOrderCache: {
    findUnique(args: {
      where: { crmOrderId: number };
      select: { crmOrderId: true };
    }): Promise<{ crmOrderId: number } | null>;
  };
  printedHistory: {
    create(args: {
      data: {
        entityType: string;
        entityId: number;
        userId?: number;
        userName?: string;
      };
      select: {
        id: true;
        entityType: true;
        entityId: true;
        printedAt: true;
        userId: true;
        userName: true;
      };
    }): Promise<{
      id: number;
      entityType: string;
      entityId: number;
      printedAt: Date;
      userId: number | null;
      userName: string | null;
    }>;
    groupBy(args: unknown): Promise<Array<{ entityId: number; _count: { _all: number } }>>;
    findMany(args: unknown): Promise<
      Array<{
        entityId: number;
        printedAt: Date;
        userId: number | null;
        userName: string | null;
      }>
    >;
  };
};

async function assertEntityExists(
  client: PrintedHistoryClient,
  body: PrintedHistoryBody,
) {
  if (body.entityType !== PRINTED_HISTORY_ENTITY_PICKUP_ORDER) return;
  const row = await client.pickupOrderCache.findUnique({
    where: { crmOrderId: body.entityId },
    select: { crmOrderId: true },
  });
  if (!row) {
    throw new NotFoundException("Pickup order not found");
  }
}

export function createPrintedHistoryService(
  client: PrintedHistoryClient = db,
) {
  return async function markPrintedHistory(
    body: PrintedHistoryBody,
    user?: PrintedHistoryUser,
  ) {
    try {
      await assertEntityExists(client, body);
      const row = await client.printedHistory.create({
        data: {
          entityType: body.entityType,
          entityId: body.entityId,
          userId: user?.id,
          userName: user?.name,
        },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          printedAt: true,
          userId: true,
          userName: true,
        },
      });
      return {
        ok: true,
        result: {
          ...row,
          printedAt: row.printedAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error("createPrintedHistoryService error:", error);
      throw new InternalServerException();
    }
  };
}

export function getPrintedHistorySummariesService(
  client: PrintedHistoryClient = db,
) {
  return async function getPrintedHistorySummaries(
    query: PrintedHistoryQuery,
  ): Promise<{ ok: true; result: PrintedHistorySummary[] }> {
    try {
      const counts = await client.printedHistory.groupBy({
        by: ["entityId"],
        where: {
          entityType: query.entityType,
          entityId: { in: query.entityIds },
        },
        _count: { _all: true },
      });
      const latestRows = await client.printedHistory.findMany({
        where: {
          entityType: query.entityType,
          entityId: { in: query.entityIds },
        },
        distinct: ["entityId"],
        orderBy: [{ entityId: "asc" }, { printedAt: "desc" }],
        select: {
          entityId: true,
          printedAt: true,
          userId: true,
          userName: true,
        },
      });

      const countById = new Map(counts.map((row) => [row.entityId, row._count._all]));
      const summaries = latestRows.map((row) => ({
        entityId: row.entityId,
        printCount: countById.get(row.entityId) ?? 0,
        lastPrintedAt: row.printedAt.toISOString(),
        lastPrintedByUserId: row.userId,
        lastPrintedByUserName: row.userName,
      }));

      return { ok: true, result: summaries };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error("getPrintedHistorySummariesService error:", error);
      throw new InternalServerException();
    }
  };
}

export const markPrintedHistoryService = createPrintedHistoryService();
export const listPrintedHistorySummariesService =
  getPrintedHistorySummariesService();
```

- [ ] **Step 8: Add controller and router**

Create `retail_pos_server/src/v1/printed-history/printed-history.controller.ts`:

```ts
import { Request, Response } from "express";
import type { UserModel } from "../../generated/prisma/models";
import {
  listPrintedHistorySummariesService,
  markPrintedHistoryService,
} from "./printed-history.service";
import {
  parsePrintedHistoryBody,
  parsePrintedHistoryQuery,
} from "./printed-history.validation";

export async function createPrintedHistoryController(
  req: Request,
  res: Response,
) {
  const user = res.locals.user as UserModel;
  const body = parsePrintedHistoryBody(req.body);
  const result = await markPrintedHistoryService(body, {
    id: user.id,
    name: user.name,
  });
  res.status(200).json({ ...result, msg: "Print history saved", paging: null });
}

export async function listPrintedHistoryController(req: Request, res: Response) {
  const query = parsePrintedHistoryQuery(req.query as Record<string, unknown>);
  const result = await listPrintedHistorySummariesService(query);
  res.status(200).json({ ...result, msg: "Print history loaded", paging: null });
}
```

Create `retail_pos_server/src/v1/printed-history/printed-history.router.ts`:

```ts
import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  createPrintedHistoryController,
  listPrintedHistoryController,
} from "./printed-history.controller";

const printedHistoryRouter = Router();

printedHistoryRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  listPrintedHistoryController,
);

printedHistoryRouter.post(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  createPrintedHistoryController,
);

export default printedHistoryRouter;
```

Modify `retail_pos_server/src/router.ts`:

```ts
import printedHistoryRouter from "./v1/printed-history/printed-history.router";
```

Add mount:

```ts
router.use("/printed-history", printedHistoryRouter);
```

- [ ] **Step 9: Run printed-history tests and build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build && node --test dist/v1/printed-history/printed-history.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit printed-history server API**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/prisma/schema.prisma retail_pos_server/prisma/migrations/20260708000000_add_printed_history/migration.sql retail_pos_server/src/generated/prisma retail_pos_server/src/router.ts retail_pos_server/src/v1/printed-history
git commit -m "feat: add generic printed history API"
```

## Task 4: Renderer Printed History Service And Policy

**Files:**
- Create: `retail_pos_app/src/renderer/src/service/printed-history.service.ts`
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.ts`
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs`

- [ ] **Step 1: Extend renderer policy tests**

Update `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionPickupOrderStatus,
  isPickupOrderLabelPrintable,
  requiresManagerForPickupOrderStatusTransition,
} from "./pickup-order-status-policy.ts";

test("isPickupOrderLabelPrintable blocks completed and cancelled orders", () => {
  assert.equal(isPickupOrderLabelPrintable("PENDING"), true);
  assert.equal(isPickupOrderLabelPrintable("ORDER_CONFIRMED"), true);
  assert.equal(isPickupOrderLabelPrintable("READY"), true);
  assert.equal(isPickupOrderLabelPrintable("COMPLETED"), false);
  assert.equal(isPickupOrderLabelPrintable("CANCELLED_BY_STORE"), false);
  assert.equal(isPickupOrderLabelPrintable("CANCELLED_BY_CUSTOMER"), false);
});

test("renderer pickup status policy exposes forward actions and manager-only ready cancellation", () => {
  assert.equal(canTransitionPickupOrderStatus("PENDING", "ORDER_CONFIRMED"), true);
  assert.equal(canTransitionPickupOrderStatus("READY", "PENDING"), false);
  assert.equal(requiresManagerForPickupOrderStatusTransition("READY", "CANCELLED_BY_STORE"), true);
  assert.equal(requiresManagerForPickupOrderStatusTransition("PENDING", "CANCELLED_BY_STORE"), false);
});
```

- [ ] **Step 2: Run renderer policy test to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && node --test src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs
```

Expected: FAIL because the transition functions are not implemented.

- [ ] **Step 3: Implement renderer policy**

Update `retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.ts`:

```ts
import type {
  PickupOrderStatus,
  PosPickupOrderStatus,
} from "./pickup-order-types";

const allowedTransitions: Record<PickupOrderStatus, readonly PosPickupOrderStatus[]> = {
  PENDING: ["ORDER_CONFIRMED", "CANCELLED_BY_STORE"],
  ORDER_CONFIRMED: ["READY", "CANCELLED_BY_STORE"],
  READY: ["COMPLETED", "CANCELLED_BY_STORE"],
  COMPLETED: [],
  CANCELLED_BY_STORE: [],
  CANCELLED_BY_CUSTOMER: [],
};

export function isPickupOrderLabelPrintable(
  status: PickupOrderStatus,
): boolean {
  return (
    status === "PENDING" ||
    status === "ORDER_CONFIRMED" ||
    status === "READY"
  );
}

export function canTransitionPickupOrderStatus(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

export function requiresManagerForPickupOrderStatusTransition(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
): boolean {
  return fromStatus === "READY" && toStatus === "CANCELLED_BY_STORE";
}

export function canUserUsePickupOrderStatusAction(
  fromStatus: PickupOrderStatus,
  toStatus: PosPickupOrderStatus,
  userScopes: readonly string[],
): boolean {
  if (!canTransitionPickupOrderStatus(fromStatus, toStatus)) return false;
  if (!requiresManagerForPickupOrderStatusTransition(fromStatus, toStatus)) {
    return true;
  }
  return userScopes.includes("admin");
}
```

- [ ] **Step 4: Add printed-history renderer service**

Create `retail_pos_app/src/renderer/src/service/printed-history.service.ts`:

```ts
import apiService, { type ApiResponse } from "../libs/api";

export const PRINTED_HISTORY_ENTITY_PICKUP_ORDER = "PICKUP_ORDER" as const;

export type PrintedHistoryEntityType =
  typeof PRINTED_HISTORY_ENTITY_PICKUP_ORDER;

export type PrintedHistorySummary = {
  entityId: number;
  printCount: number;
  lastPrintedAt: string;
  lastPrintedByUserId: number | null;
  lastPrintedByUserName: string | null;
};

export async function markPrintedHistory(
  entityType: PrintedHistoryEntityType,
  entityId: number,
): Promise<ApiResponse<unknown>> {
  return apiService.post<unknown>("/api/printed-history", {
    entityType,
    entityId,
  });
}

export async function getPrintedHistorySummaries(
  entityType: PrintedHistoryEntityType,
  entityIds: number[],
): Promise<ApiResponse<PrintedHistorySummary[]>> {
  if (entityIds.length === 0) {
    return { ok: true, msg: "", result: [], paging: null };
  }
  const qs = new URLSearchParams();
  qs.set("entityType", entityType);
  qs.set("entityIds", entityIds.join(","));
  return apiService.get<PrintedHistorySummary[]>(
    `/api/printed-history?${qs.toString()}`,
  );
}
```

- [ ] **Step 5: Run renderer policy test**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && node --test src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs
```

Expected: PASS. A Node module-type warning is acceptable if the test passes.

- [ ] **Step 6: Commit renderer service and policy**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.ts retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs retail_pos_app/src/renderer/src/service/printed-history.service.ts
git commit -m "feat: add pickup print policy and history client"
```

## Task 5: Pickup List Printed Badge

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`

- [ ] **Step 1: Add printed summary state and imports**

Modify imports in `PickupOrderSearchPanel.tsx`:

```ts
import {
  getPrintedHistorySummaries,
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
  type PrintedHistorySummary,
} from "../../service/printed-history.service";
```

Add state near `items`:

```ts
  const [printedSummariesByOrderId, setPrintedSummariesByOrderId] = useState<
    Map<number, PrintedHistorySummary>
  >(new Map());
```

- [ ] **Step 2: Fetch printed summaries after list load**

Inside `fetchPage`, after `setItems(res.result); setPaging(res.paging);`, add:

```ts
          const orderIds = res.result.map((order) => order.crmOrderId);
          const printedRes = await getPrintedHistorySummaries(
            PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
            orderIds,
          );
          if (
            requestId !== latestRequestIdRef.current ||
            filterVersion !== filterVersionRef.current
          ) {
            return;
          }
          if (printedRes.ok && Array.isArray(printedRes.result)) {
            setPrintedSummariesByOrderId(
              new Map(
                printedRes.result.map((summary) => [
                  summary.entityId,
                  summary,
                ]),
              ),
            );
          } else {
            setPrintedSummariesByOrderId(new Map());
          }
```

In the error branch that clears items, also add:

```ts
          setPrintedSummariesByOrderId(new Map());
```

- [ ] **Step 3: Render the compact Printed badge**

Find the row rendering for `items.map`. Before or near the existing status badge, add:

```tsx
const printedSummary = printedSummariesByOrderId.get(order.crmOrderId);
```

Render:

```tsx
{printedSummary && (
  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">
    Printed
  </span>
)}
```

Keep the badge small. Do not add a new panel.

- [ ] **Step 4: Build app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit list badge**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx
git commit -m "feat: show printed pickup orders in list"
```

## Task 6: Pickup Detail Status CTAs And Print Flow

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Import user and printed-history helpers**

Add imports:

```ts
import { useUser } from "../../contexts/UserContext";
import {
  markPrintedHistory,
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
} from "../../service/printed-history.service";
import {
  canUserUsePickupOrderStatusAction,
  isPickupOrderLabelPrintable,
  requiresManagerForPickupOrderStatusTransition,
} from "./pickup-order-status-policy";
```

If `isPickupOrderLabelPrintable` is already imported from the policy file, merge imports rather than duplicating.

Inside `PickupOrderViewer`, add:

```ts
  const { user } = useUser();
```

- [ ] **Step 2: Add a non-confirming status update helper**

Above `changeStatus`, add:

```ts
  const persistStatusChange = async (
    actionCrmOrderId: number,
    status: PosPickupOrderStatus,
    isCurrentAction: () => boolean,
  ) => {
    const statusRes = await updatePickupOrderStatus(actionCrmOrderId, status);
    if (!isCurrentAction()) return null;
    if (!statusRes.ok) {
      throw new Error(statusRes.msg || "Failed to update pickup order status");
    }
    if (!statusRes.result) {
      throw new Error("Failed to update pickup order status");
    }
    applyOrderDetail(statusRes.result);
    return statusRes.result;
  };
```

Then update `changeStatus` to call `persistStatusChange(...)` instead of duplicating the `updatePickupOrderStatus` block.

- [ ] **Step 3: Pass user scopes into StatusActionBar**

When rendering `StatusActionBar`, add:

```tsx
userScopes={user?.scope ?? []}
```

Update `StatusActionBar` props:

```ts
  userScopes: string[];
```

Inside the status target map:

```ts
        const allowed = canUserUsePickupOrderStatusAction(
          currentStatus,
          status,
          userScopes,
        );
        const managerOnly = requiresManagerForPickupOrderStatusTransition(
          currentStatus,
          status,
        );
```

Update disabled:

```tsx
disabled={loading || isCurrent || !allowed}
```

Add title:

```tsx
title={managerOnly && !allowed ? "Manager required" : undefined}
```

For text, keep `statusLabel(status)` and optionally append a small second line for manager-only disabled actions:

```tsx
{managerOnly && !allowed && (
  <span className="mt-0.5 block text-[9px]">Manager required</span>
)}
```

- [ ] **Step 4: Update print flow for PENDING confirmation first**

Inside `printSelectedLabel`, after blocked status check and before printer check, add:

```ts
    const shouldConfirmPending = order.status === "PENDING";
    if (shouldConfirmPending) {
      const statusConfirmed = window.confirm(
        "This order is still pending. Printing labels will confirm the order and notify the customer. Continue?",
      );
      if (!statusConfirmed) {
        setLabelPrintMessage("Print cancelled.");
        return;
      }
    }
```

Keep the existing printer confirmation after this block.

- [ ] **Step 5: Save printed history after successful printer writes**

After all label copies print successfully and before the success message, add:

```ts
      const historyRes = await markPrintedHistory(
        PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
        order.crmOrderId,
      );
      if (!isCurrentLabelPrint()) return;
      if (!historyRes.ok) {
        setLabelPrintMessage(
          historyRes.msg || "Labels printed, but print history was not saved.",
        );
        return;
      }
```

- [ ] **Step 6: Auto-confirm PENDING after print history saves**

After the history save block:

```ts
      if (order.status === "PENDING") {
        const actionCrmOrderId = order.crmOrderId;
        const actionGen = statusActionRequestGenRef.current + 1;
        statusActionRequestGenRef.current = actionGen;
        const isCurrentStatusAction = () =>
          statusActionRequestGenRef.current === actionGen &&
          activeCrmOrderIdRef.current === actionCrmOrderId;

        setStatusActionLoading(true);
        setStatusActionError("");
        try {
          await persistStatusChange(
            actionCrmOrderId,
            "ORDER_CONFIRMED",
            isCurrentStatusAction,
          );
          const syncRes = await syncPickupOrders();
          if (!isCurrentStatusAction()) return;
          if (!syncRes.ok) {
            throw new Error("Pickup order confirmed, but sync failed");
          }
          await loadOrder(actionCrmOrderId, isCurrentStatusAction);
        } catch (error) {
          if (isCurrentStatusAction()) {
            setStatusActionError(
              error instanceof Error
                ? error.message
                : "Labels printed, but order was not confirmed. Confirm manually.",
            );
            setLabelPrintMessage(
              "Labels printed, but order was not confirmed. Confirm manually.",
            );
          }
          return;
        } finally {
          if (isCurrentStatusAction()) {
            setStatusActionLoading(false);
          }
        }
      }
```

Then keep the success message:

```ts
      setLabelPrintMessage(
        `Printed ${printCount} label${printCount === 1 ? "" : "s"} to ${pickupLabelPrinter.name}.`,
      );
      onRefreshList();
```

- [ ] **Step 7: Ensure hook dependencies are complete**

Update the `printSelectedLabel` dependency array to include:

```ts
applyOrderDetail,
loadOrder,
onRefreshList,
persistStatusChange,
syncPickupOrders,
```

If `persistStatusChange` is defined inline, wrap it in `useCallback` with dependencies:

```ts
const persistStatusChange = useCallback(async (...) => { ... }, [applyOrderDetail]);
```

- [ ] **Step 8: Build app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit detail flow**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
git commit -m "feat: save pickup label print history"
```

## Task 7: Full Verification

**Files:**
- No file edits unless verification exposes a defect.

- [ ] **Step 1: Run CRM verification**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
```

Expected: PASS.

- [ ] **Step 2: Run POS server verification**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build && node --test dist/v1/pickup-order/pickup-order.status.test.js dist/v1/printed-history/printed-history.test.js
```

Expected: PASS.

- [ ] **Step 3: Run POS app verification**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && node --test src/renderer/src/components/pickupOrders/pickup-order-status-policy.test.mjs && npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual QA checklist**

Use a local POS server with a configured 100x100 label printer or a safe test printer target:

- Open a `PENDING` pickup order detail.
- Tap print.
- Confirm the status-impact dialog appears before the printer dialog.
- Cancel the status-impact dialog and verify no print, no history, no status change.
- Confirm status-impact dialog, cancel printer dialog, and verify no print, no history, no status change.
- Complete print and verify `PrintedHistory(PICKUP_ORDER, crmOrderId)` is inserted.
- Verify the `PENDING` order becomes `ORDER_CONFIRMED`.
- Verify the pickup order list shows `Printed`.
- Open an `ORDER_CONFIRMED` order and verify print only asks printer confirmation.
- Open a `READY` order as a non-admin user and verify `CANCELLED_BY_STORE` says manager required.
- Open the same `READY` order as admin and verify `CANCELLED_BY_STORE` is enabled.
- Open `COMPLETED`, `CANCELLED_BY_STORE`, and `CANCELLED_BY_CUSTOMER` orders and verify label print is disabled.

- [ ] **Step 5: Final status check**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail && git status --short
cd /Users/dev/ktpv5/ktpv5-crm-server && git status --short
```

Expected: only intentional uncommitted files remain, or both repos are clean after commits.

## Self-Review Notes

Spec coverage:

- Status transition matrix: Task 1 and Task 2.
- `READY -> CANCELLED_BY_STORE` manager-only using `admin`: Task 2 and Task 6.
- `PENDING` print confirmation order: Task 6.
- Print success before status mutation: Task 6.
- Terminal statuses cannot print: Task 4 and Task 6.
- Generic `PrintedHistory` without `PrintedItemSheet` migration: Task 3.
- Pickup list/detail printed display: Task 5 and Task 6.
- Failure handling: Task 6.
- Verification: Task 7.

No `PrintedItemSheet` porting is planned. Existing item-sheet printed routes and localStorage migration are intentionally untouched.
