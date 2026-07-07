# Pickup Order Status Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow retail POS staff to set CRM-owned pickup order statuses from the POS detail viewer, record CRM status history, notify customers after successful CRM mutation, then refresh the POS cache through existing sync.

**Architecture:** CRM remains the canonical owner and exposes `POST /device/pickup-order/:id/status`; the mutation updates `PickupOrder.status` and appends `PickupOrderStatusEvent` in one Prisma transaction, then starts push delivery without awaiting it. The POS server adds a small authenticated pass-through endpoint that sends the cashier snapshot to CRM, while the renderer performs two confirmations, calls the local endpoint, triggers `/api/pickup-order/sync`, and refreshes the selected detail plus current list page.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7 generated client, PostgreSQL, Axios `crmApiService`, React 19, Electron renderer as pure SPA, Node built-in test runner.

---

## Scope

Spec: `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-07-07-pickup-order-status-actions-design.md`.

In scope:

- CRM device status mutation for POS-allowed statuses: `PENDING`, `ORDER_CONFIRMED`, `READY`, `COMPLETED`, `CANCELLED_BY_STORE`.
- CRM validation rejecting `CANCELLED_BY_CUSTOMER` from POS.
- CRM transactional order status update plus `PickupOrderStatusEvent` append.
- CRM customer push notification after successful transaction, fire-and-forget from the endpoint perspective.
- POS local server endpoint `POST /api/pickup-order/:id/status` using `userMiddleware` and `scopeMiddleware("sale")`.
- POS renderer status controls in `PickupOrderViewer`, with two confirmations, mutation, sync, detail refresh, and parent list refresh.
- Verification that the existing Dream Market app pickup-order notification routing comment is present; no dmarket behavior changes.

Out of scope:

- Final transition matrix or business workflow gating.
- POS setting of `CANCELLED_BY_CUSTOMER`.
- Dream Market pickup-order deep link implementation.
- Schema changes.
- Git staging or committing unless the user explicitly asks.

Existing user-owned work to preserve:

- `/Users/dev/ktpv5/ktpv5-dmarket-app/api/apiService.ts` is modified by the user. Do not edit it.
- `/Users/dev/ktpv5/ktpv5-dmarket-app/app/_layout.tsx` already contains the pickup-order notification routing comment. Verify only unless review finds the comment missing.

---

## File Structure

### CRM Server: `/Users/dev/ktpv5/ktpv5-crm-server`

- Create `src/device/pickup-order/pickupOrderStatus.validation.ts`
  - Shared POS-allowed status list, path id parser, body parser, actor snapshot trim rules.
- Create `src/device/pickup-order/pickupOrderStatus.push.ts`
  - Notification copy mapping and helper that calls `getPushTokens` plus `sendPushNotification`.
- Create `src/device/pickup-order/pickupOrderStatus.service.ts`
  - Transactional status update and event append; returns the same DTO shape as device sync.
- Create `src/device/pickup-order/pickupOrderStatus.controller.ts`
  - Reads `res.locals.companyId`, parses params/body, calls service, fires push with `void ...catch`, returns envelope.
- Modify `src/device/pickup-order/pickupOrderSync.routes.ts`
  - Register `POST /:id/status` before `GET /sync`.
- Modify `src/device/pickup-order/pickupOrderSync.service.ts`
  - Export the sync DTO mapper as `mapPickupOrderForDeviceSync` so status service can reuse it.
- Modify `src/libs/pickupOrder.deviceSync.test.ts`
  - Add validation, service, push, and router registration tests.

### Retail POS Server: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server`

- Create `src/v1/pickup-order/pickup-order.status.ts`
  - POS status body validation, actor snapshot construction, CRM call orchestration.
- Modify `src/v1/pickup-order/pickup-order.crm.ts`
  - Add `updateCrmPickupOrderStatus` wrapper for `POST /device/pickup-order/:id/status`.
- Modify `src/v1/pickup-order/pickup-order.controller.ts`
  - Add `updatePickupOrderStatusController`.
- Modify `src/v1/pickup-order/pickup-order.router.ts`
  - Register `POST /:id/status` before `GET /:id`.
- Create `src/v1/pickup-order/pickup-order.status.test.ts`
  - Unit tests for validation, CRM payload, error mapping, and route registration.

### Retail POS Renderer: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app`

- Modify `src/renderer/src/components/pickupOrders/pickup-order-types.ts`
  - Add `POS_PICKUP_ORDER_STATUS_TARGETS` excluding `CANCELLED_BY_CUSTOMER`.
- Modify `src/renderer/src/service/pickup-order.service.ts`
  - Add `updatePickupOrderStatus` and `syncPickupOrders`.
- Modify `src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`
  - Expose `refreshCurrentPage()` through `forwardRef`/`useImperativeHandle`.
- Modify `src/renderer/src/screens/PickupOrderSearchScreen.tsx`
  - Hold a panel ref and pass list refresh callback to the viewer.
- Modify `src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Add status actions, two confirmations, mutation state, sync/detail/list refresh, and non-blocking error display.

### Dream Market App: `/Users/dev/ktpv5/ktpv5-dmarket-app`

- Do not edit files for this slice.
- Verify `/Users/dev/ktpv5/ktpv5-dmarket-app/app/_layout.tsx` contains the existing pickup-order notification routing comment under the receipt branch.

---

## Task 1: CRM Status Validation And Push Helpers

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.validation.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.push.ts`
- Test: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrder.deviceSync.test.ts`

- [ ] **Step 1: Write failing validation and push tests**

Append these imports near the top of `src/libs/pickupOrder.deviceSync.test.ts`:

```ts
import {
  buildPickupOrderStatusPushContent,
  sendPickupOrderStatusPushNotification,
} from "../device/pickup-order/pickupOrderStatus.push";
import {
  parsePickupOrderStatusBody,
  parsePickupOrderStatusPathId,
  POS_PICKUP_ORDER_STATUSES,
} from "../device/pickup-order/pickupOrderStatus.validation";
```

Append these tests:

```ts
test("parsePickupOrderStatusBody accepts POS status and trims actor snapshot", () => {
  const body = parsePickupOrderStatusBody({
    status: "READY",
    actorId: "  12  ",
    actorName: "  Alice  ",
    note: "  Packed on bench  ",
  });

  assert.deepEqual(body, {
    status: "READY",
    actorId: "12",
    actorName: "Alice",
    note: "Packed on bench",
  });
});

test("parsePickupOrderStatusBody rejects customer cancellation from POS", () => {
  assert.throws(
    () => parsePickupOrderStatusBody({ status: "CANCELLED_BY_CUSTOMER" }),
    /status must be a POS pickup order status/,
  );
});

test("parsePickupOrderStatusPathId rejects non-positive ids", () => {
  assert.equal(parsePickupOrderStatusPathId("42"), 42);
  assert.throws(() => parsePickupOrderStatusPathId("0"), /id must be a positive integer/);
  assert.throws(() => parsePickupOrderStatusPathId("1.5"), /id must be a positive integer/);
});

test("POS_PICKUP_ORDER_STATUSES excludes customer cancellation", () => {
  assert.deepEqual(POS_PICKUP_ORDER_STATUSES, [
    "PENDING",
    "ORDER_CONFIRMED",
    "READY",
    "COMPLETED",
    "CANCELLED_BY_STORE",
  ]);
});

test("buildPickupOrderStatusPushContent returns status-specific copy", () => {
  assert.deepEqual(buildPickupOrderStatusPushContent("ORDER_CONFIRMED"), {
    title: "Pickup order confirmed",
    body: "Your pickup order has been confirmed.",
  });
  assert.deepEqual(buildPickupOrderStatusPushContent("CANCELLED_BY_STORE"), {
    title: "Pickup order cancelled",
    body: "Your pickup order was cancelled by the store.",
  });
});

test("sendPickupOrderStatusPushNotification uses member tokens and pickup-order data", async () => {
  const calls: unknown[] = [];
  await sendPickupOrderStatusPushNotification({
    companyId: 7,
    memberId: "member-1",
    orderId: 42,
    status: "READY",
    getTokens: async (companyId, memberId) => {
      calls.push({ kind: "tokens", companyId, memberId });
      return ["ExponentPushToken[token]"];
    },
    sendPush: async (tokens, title, body, data) => {
      calls.push({ kind: "push", tokens, title, body, data });
    },
  });

  assert.deepEqual(calls, [
    { kind: "tokens", companyId: 7, memberId: "member-1" },
    {
      kind: "push",
      tokens: ["ExponentPushToken[token]"],
      title: "Pickup order ready",
      body: "Your pickup order is ready for pickup.",
      data: { type: "pickup-order", id: 42, status: "READY" },
    },
  ]);
});

test("sendPickupOrderStatusPushNotification skips when member has no tokens", async () => {
  let pushCalled = false;
  await sendPickupOrderStatusPushNotification({
    companyId: 7,
    memberId: "member-1",
    orderId: 42,
    status: "READY",
    getTokens: async () => [],
    sendPush: async () => {
      pushCalled = true;
    },
  });

  assert.equal(pushCalled, false);
});
```

- [ ] **Step 2: Run the CRM tests and confirm they fail**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
```

Expected: build fails because `pickupOrderStatus.validation` and `pickupOrderStatus.push` do not exist.

- [ ] **Step 3: Implement CRM status validation**

Create `src/device/pickup-order/pickupOrderStatus.validation.ts`:

```ts
import { BadRequestException } from "../../libs/exceptions";
import type { PickupOrderSyncItemDto } from "./pickupOrderSync.types";

export const POS_PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
] as const satisfies readonly PickupOrderSyncItemDto["status"][];

export type PosPickupOrderStatus = (typeof POS_PICKUP_ORDER_STATUSES)[number];

export type PickupOrderStatusBody = {
  status: PosPickupOrderStatus;
  actorId?: string;
  actorName?: string;
  note?: string;
};

const positiveIntegerPattern = /^[1-9]\d*$/;
const maxPostgresInt = 2147483647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parsePickupOrderStatusPathId(value: unknown): number {
  if (typeof value !== "string" || !positiveIntegerPattern.test(value)) {
    throw new BadRequestException("id must be a positive integer");
  }
  const parsed = Number(value);
  if (parsed > maxPostgresInt) {
    throw new BadRequestException("id must be a positive integer");
  }
  return parsed;
}

export function parsePickupOrderStatusBody(body: unknown): PickupOrderStatusBody {
  if (!isRecord(body)) {
    throw new BadRequestException("Pickup order status body is required");
  }

  const status = body.status;
  if (
    typeof status !== "string" ||
    !POS_PICKUP_ORDER_STATUSES.includes(status as PosPickupOrderStatus)
  ) {
    throw new BadRequestException("status must be a POS pickup order status");
  }

  return {
    status: status as PosPickupOrderStatus,
    ...(trimOptionalString(body.actorId, "actorId")
      ? { actorId: trimOptionalString(body.actorId, "actorId") }
      : {}),
    ...(trimOptionalString(body.actorName, "actorName")
      ? { actorName: trimOptionalString(body.actorName, "actorName") }
      : {}),
    ...(trimOptionalString(body.note, "note")
      ? { note: trimOptionalString(body.note, "note") }
      : {}),
  };
}
```

- [ ] **Step 4: Implement CRM push helper**

Create `src/device/pickup-order/pickupOrderStatus.push.ts`:

```ts
import { getPushTokens, sendPushNotification } from "../../libs/push-utils";
import type { PosPickupOrderStatus } from "./pickupOrderStatus.validation";

type PushData = Record<string, string | number | boolean | null>;

type PushDeps = {
  getTokens?: (companyId: number, memberId: string) => Promise<string[]>;
  sendPush?: (
    tokens: string[],
    title: string,
    body: string,
    data: PushData,
  ) => Promise<unknown>;
};

export function buildPickupOrderStatusPushContent(status: PosPickupOrderStatus): {
  title: string;
  body: string;
} {
  switch (status) {
    case "PENDING":
      return {
        title: "Pickup order updated",
        body: "Your pickup order is pending.",
      };
    case "ORDER_CONFIRMED":
      return {
        title: "Pickup order confirmed",
        body: "Your pickup order has been confirmed.",
      };
    case "READY":
      return {
        title: "Pickup order ready",
        body: "Your pickup order is ready for pickup.",
      };
    case "COMPLETED":
      return {
        title: "Pickup order completed",
        body: "Your pickup order has been completed.",
      };
    case "CANCELLED_BY_STORE":
      return {
        title: "Pickup order cancelled",
        body: "Your pickup order was cancelled by the store.",
      };
  }
}

export async function sendPickupOrderStatusPushNotification(input: {
  companyId: number;
  memberId: string;
  orderId: number;
  status: PosPickupOrderStatus;
} & PushDeps): Promise<void> {
  const getTokens = input.getTokens ?? getPushTokens;
  const sendPush = input.sendPush ?? sendPushNotification;
  const tokens = await getTokens(input.companyId, input.memberId);
  if (tokens.length === 0) return;

  const { title, body } = buildPickupOrderStatusPushContent(input.status);
  await sendPush(tokens, title, body, {
    type: "pickup-order",
    id: input.orderId,
    status: input.status,
  });
}
```

- [ ] **Step 5: Run CRM tests for this task**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: current device sync tests plus new validation/push helper tests pass.

---

## Task 2: CRM Transactional Status Mutation

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.service.ts`
- Test: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrder.deviceSync.test.ts`

- [ ] **Step 1: Write failing service tests**

Append this helper and tests to `src/libs/pickupOrder.deviceSync.test.ts`:

```ts
import {
  updatePickupOrderStatus,
  type PickupOrderStatusDb,
} from "../device/pickup-order/pickupOrderStatus.service";

function makeStatusOrder(overrides: Partial<{
  id: number;
  companyId: number;
  status: "PENDING" | "ORDER_CONFIRMED" | "READY";
}> = {}) {
  const updatedAt = new Date("2026-07-07T02:00:00.000Z");
  return {
    id: overrides.id ?? 42,
    companyId: overrides.companyId ?? 7,
    documentId: "7-260707-042",
    status: overrides.status ?? "PENDING",
    memberId: "member-1",
    memberName: "Jane",
    memberLevel: 1,
    memberPhoneLast4: "1234",
    pickupStartsAt: new Date("2026-07-08T01:00:00.000Z"),
    linesTotal: 1500,
    total: 1500,
    createdAt: new Date("2026-07-07T01:00:00.000Z"),
    updatedAt,
    lines: [
      {
        id: 420,
        orderId: overrides.id ?? 42,
        index: 0,
        itemId: 99,
        name_en: "Rice cake",
        name_ko: "Rice cake",
        barcode: "930000000001",
        code: null,
        uom: "ea",
        prices: [1500],
        promoPrices: null,
        memberLevel: 1,
        optionTotal: 0,
        qty: 1000,
        total: 1500,
        note: null,
        selectedOptionsSnapshot: [],
        createdAt: new Date("2026-07-07T01:00:00.000Z"),
        updatedAt,
      },
    ],
  };
}

test("updatePickupOrderStatus updates order and appends event in one transaction", async () => {
  const createdEvents: unknown[] = [];
  const updatedOrder = makeStatusOrder({ status: "READY" });
  const dbClient: PickupOrderStatusDb = {
    async $transaction(callback) {
      return callback({
        pickupOrder: {
          async findFirst(args) {
            assert.deepEqual(args.where, { id: 42, companyId: 7 });
            return makeStatusOrder({ status: "PENDING" });
          },
          async update(args) {
            assert.equal(args.where.id, 42);
            assert.equal(args.data.status, "READY");
            return updatedOrder;
          },
        },
        pickupOrderStatusEvent: {
          async create(args) {
            createdEvents.push(args.data);
            return { id: 1 };
          },
        },
      });
    },
  };

  const result = await updatePickupOrderStatus(
    {
      companyId: 7,
      orderId: 42,
      status: "READY",
      actorId: "12",
      actorName: "Alice",
      note: "Packed",
    },
    { dbClient },
  );

  assert.equal(result.status, "READY");
  assert.equal(result.lines.length, 1);
  assert.deepEqual(createdEvents, [
    {
      orderId: 42,
      fromStatus: "PENDING",
      toStatus: "READY",
      actorType: "KTP_USER",
      actorId: "12",
      actorNameSnapshot: "Alice",
      note: "Packed",
    },
  ]);
});

test("updatePickupOrderStatus returns 404 when order is outside device company", async () => {
  const dbClient: PickupOrderStatusDb = {
    async $transaction(callback) {
      return callback({
        pickupOrder: {
          async findFirst() {
            return null;
          },
          async update() {
            assert.fail("update should not run for missing order");
          },
        },
        pickupOrderStatusEvent: {
          async create() {
            assert.fail("event should not be created for missing order");
          },
        },
      });
    },
  };

  await assert.rejects(
    () =>
      updatePickupOrderStatus(
        { companyId: 7, orderId: 42, status: "READY" },
        { dbClient },
      ),
    /Pickup order not found/,
  );
});
```

- [ ] **Step 2: Export the existing device sync mapper**

In `src/device/pickup-order/pickupOrderSync.service.ts`, change:

```ts
function mapOrder(
```

to:

```ts
export function mapPickupOrderForDeviceSync(
```

Then change:

```ts
items: pageRows.map(mapOrder),
```

to:

```ts
items: pageRows.map(mapPickupOrderForDeviceSync),
```

- [ ] **Step 3: Implement CRM status mutation service**

Create `src/device/pickup-order/pickupOrderStatus.service.ts`:

```ts
import db from "../../libs/db";
import { NotFoundException } from "../../libs/exceptions";
import { mapPickupOrderForDeviceSync } from "./pickupOrderSync.service";
import type { PickupOrderSyncItemDto } from "./pickupOrderSync.types";
import type {
  PickupOrderStatusBody,
  PosPickupOrderStatus,
} from "./pickupOrderStatus.validation";

type PickupOrderWithLines = Parameters<typeof mapPickupOrderForDeviceSync>[0];

type PickupOrderStatusTx = {
  pickupOrder: {
    findFirst(args: {
      where: { id: number; companyId: number };
      include: { lines: { orderBy: { index: "asc" } } };
    }): Promise<PickupOrderWithLines | null>;
    update(args: {
      where: { id: number };
      data: { status: PosPickupOrderStatus };
      include: { lines: { orderBy: { index: "asc" } } };
    }): Promise<PickupOrderWithLines>;
  };
  pickupOrderStatusEvent: {
    create(args: {
      data: {
        orderId: number;
        fromStatus: PickupOrderSyncItemDto["status"];
        toStatus: PosPickupOrderStatus;
        actorType: "KTP_USER";
        actorId: string | null;
        actorNameSnapshot: string | null;
        note: string | null;
      };
    }): Promise<unknown>;
  };
};

export type PickupOrderStatusDb = {
  $transaction<T>(callback: (tx: PickupOrderStatusTx) => Promise<T>): Promise<T>;
};

export async function updatePickupOrderStatus(
  input: {
    companyId: number;
    orderId: number;
  } & PickupOrderStatusBody,
  options: { dbClient?: PickupOrderStatusDb } = {},
): Promise<PickupOrderSyncItemDto> {
  const client = options.dbClient ?? db;

  const updated = await client.$transaction(async (tx) => {
    const existing = await tx.pickupOrder.findFirst({
      where: { id: input.orderId, companyId: input.companyId },
      include: { lines: { orderBy: { index: "asc" } } },
    });

    if (!existing) {
      throw new NotFoundException("Pickup order not found");
    }

    const order = await tx.pickupOrder.update({
      where: { id: existing.id },
      data: { status: input.status },
      include: { lines: { orderBy: { index: "asc" } } },
    });

    await tx.pickupOrderStatusEvent.create({
      data: {
        orderId: existing.id,
        fromStatus: existing.status,
        toStatus: input.status,
        actorType: "KTP_USER",
        actorId: input.actorId ?? null,
        actorNameSnapshot: input.actorName ?? null,
        note: input.note ?? null,
      },
    });

    return order;
  });

  return mapPickupOrderForDeviceSync(updated);
}
```

- [ ] **Step 4: Run CRM service tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: tests pass.

---

## Task 3: CRM Device Controller And Route

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderStatus.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.routes.ts`
- Test: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrder.deviceSync.test.ts`

- [ ] **Step 1: Write failing route registration test**

Append this import:

```ts
import { updatePickupOrderStatusController } from "../device/pickup-order/pickupOrderStatus.controller";
```

Replace the existing router registration test with:

```ts
test("pickupOrderSyncRouter registers status mutation before GET /sync", () => {
  const stack = (pickupOrderSyncRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: unknown }>;
      };
    }>;
  }).stack;

  const statusRoute = stack.find((layer) => layer.route?.path === "/:id/status");
  const syncRoute = stack.find((layer) => layer.route?.path === "/sync");

  assert.equal(statusRoute?.route?.methods.post, true);
  assert.equal(statusRoute?.route?.stack[0]?.handle, updatePickupOrderStatusController);
  assert.equal(syncRoute?.route?.methods.get, true);
});
```

- [ ] **Step 2: Implement CRM controller**

Create `src/device/pickup-order/pickupOrderStatus.controller.ts`:

```ts
import type { Request, Response } from "express";
import { BadRequestException } from "../../libs/exceptions";
import { updatePickupOrderStatus } from "./pickupOrderStatus.service";
import { sendPickupOrderStatusPushNotification } from "./pickupOrderStatus.push";
import {
  parsePickupOrderStatusBody,
  parsePickupOrderStatusPathId,
} from "./pickupOrderStatus.validation";

function getCompanyId(res: Response): number {
  const companyId = res.locals.companyId;
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new BadRequestException("Company not found");
  }
  return companyId;
}

export async function updatePickupOrderStatusController(
  req: Request,
  res: Response,
) {
  const orderId = parsePickupOrderStatusPathId(req.params.id);
  const body = parsePickupOrderStatusBody(req.body);
  const result = await updatePickupOrderStatus({
    companyId: getCompanyId(res),
    orderId,
    ...body,
  });

  void sendPickupOrderStatusPushNotification({
    companyId: result.companyId,
    memberId: result.memberId,
    orderId: result.id,
    status: body.status,
  }).catch((error) => {
    console.error("[pickup-order.status] push failed:", error);
  });

  res.status(200).json({
    ok: true,
    msg: "Pickup order status updated",
    result,
    paging: null,
  });
}
```

- [ ] **Step 3: Register CRM route before `/sync`**

Modify `src/device/pickup-order/pickupOrderSync.routes.ts`:

```ts
import { Router } from "express";
import { getPickupOrderSyncController } from "./pickupOrderSync.controller";
import { updatePickupOrderStatusController } from "./pickupOrderStatus.controller";

const pickupOrderSyncRouter = Router();

pickupOrderSyncRouter.post("/:id/status", updatePickupOrderStatusController);
pickupOrderSyncRouter.get("/sync", getPickupOrderSyncController);

export default pickupOrderSyncRouter;
```

- [ ] **Step 4: Run full CRM verification**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build passes and all CRM Node tests pass.

---

## Task 4: POS Server Status Endpoint

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.crm.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`

- [ ] **Step 1: Write failing POS server tests**

Create `src/v1/pickup-order/pickup-order.status.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import pickupOrderRouter from "./pickup-order.router";
import {
  parsePickupOrderStatusBody,
  updatePickupOrderStatusFromPos,
} from "./pickup-order.status";

test("parsePickupOrderStatusBody rejects customer cancellation from POS", () => {
  assert.throws(
    () => parsePickupOrderStatusBody({ status: "CANCELLED_BY_CUSTOMER" }),
    /status must be a POS pickup order status/,
  );
});

test("updatePickupOrderStatusFromPos sends CRM status and actor snapshot", async () => {
  const calls: unknown[] = [];
  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "READY" },
      user: { id: 12, name: "Alice" },
    },
    {
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return {
          id: 42,
          companyId: 1,
          documentId: "1-260707-042",
          status: "READY",
          memberId: "member-1",
          memberName: "Jane",
          memberLevel: 1,
          memberPhoneLast4: "1234",
          pickupStartsAt: "2026-07-08T01:00:00.000Z",
          linesTotal: 1500,
          total: 1500,
          createdAt: "2026-07-07T01:00:00.000Z",
          updatedAt: "2026-07-07T02:00:00.000Z",
          lines: [],
        };
      },
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "READY",
        actorId: "12",
        actorName: "Alice",
      },
    },
  ]);
});

test("pickupOrderRouter registers POST /:id/status before GET /:id", () => {
  const stack = (pickupOrderRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const statusIndex = stack.findIndex((layer) => layer.route?.path === "/:id/status");
  const detailIndex = stack.findIndex((layer) => layer.route?.path === "/:id");

  assert.ok(statusIndex >= 0);
  assert.ok(detailIndex >= 0);
  assert.equal(stack[statusIndex].route?.methods.post, true);
  assert.ok(statusIndex < detailIndex);
});
```

- [ ] **Step 2: Run POS server build and confirm it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build fails because `pickup-order.status` does not exist.

- [ ] **Step 3: Add POS CRM wrapper**

Modify `src/v1/pickup-order/pickup-order.crm.ts`:

```ts
import type { PickupOrderStatus } from "./pickup-order.types";
```

Add after `fetchCrmPickupOrderSyncPage`:

```ts
export type CrmPickupOrderStatusPayload = {
  status: Exclude<PickupOrderStatus, "CANCELLED_BY_CUSTOMER">;
  actorId?: string;
  actorName?: string;
  note?: string;
};

export async function updateCrmPickupOrderStatus(
  orderId: number,
  payload: CrmPickupOrderStatusPayload,
) {
  const res = await crmApiService.post(
    `/device/pickup-order/${orderId}/status`,
    payload,
  );

  return requireOk(res);
}
```

- [ ] **Step 4: Implement POS status service**

Create `src/v1/pickup-order/pickup-order.status.ts`:

```ts
import { BadRequestException } from "../../libs/exceptions";
import { updateCrmPickupOrderStatus } from "./pickup-order.crm";
import type { PickupOrderStatus } from "./pickup-order.types";

export const POS_PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
] as const satisfies readonly PickupOrderStatus[];

export type PosPickupOrderStatus = (typeof POS_PICKUP_ORDER_STATUSES)[number];

export type PickupOrderStatusBody = {
  status: PosPickupOrderStatus;
};

type PosUserSnapshot = {
  id: number;
  name: string;
};

type Deps = {
  updateCrmStatus?: typeof updateCrmPickupOrderStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePickupOrderStatusBody(body: unknown): PickupOrderStatusBody {
  if (!isRecord(body)) {
    throw new BadRequestException("Pickup order status body is required");
  }
  if (
    typeof body.status !== "string" ||
    !POS_PICKUP_ORDER_STATUSES.includes(body.status as PosPickupOrderStatus)
  ) {
    throw new BadRequestException("status must be a POS pickup order status");
  }
  return { status: body.status as PosPickupOrderStatus };
}

export async function updatePickupOrderStatusFromPos(
  input: {
    orderId: number;
    body: unknown;
    user: PosUserSnapshot;
  },
  deps: Deps = {},
) {
  const parsed = parsePickupOrderStatusBody(input.body);
  const updateCrmStatus = deps.updateCrmStatus ?? updateCrmPickupOrderStatus;

  return updateCrmStatus(input.orderId, {
    status: parsed.status,
    actorId: String(input.user.id),
    actorName: input.user.name,
  });
}
```

- [ ] **Step 5: Add POS controller**

Modify `src/v1/pickup-order/pickup-order.controller.ts` imports:

```ts
import { UserModel } from "../../generated/prisma/models";
import { updatePickupOrderStatusFromPos } from "./pickup-order.status";
```

Add:

```ts
export async function updatePickupOrderStatusController(
  req: Request,
  res: Response,
) {
  const crmOrderId = parseIntId(req, "id");
  const user = res.locals.user as UserModel;
  const result = await updatePickupOrderStatusFromPos({
    orderId: crmOrderId,
    body: req.body,
    user: { id: user.id, name: user.name },
  });

  res.status(200).json({
    ok: true,
    msg: "Pickup order status updated",
    result,
    paging: null,
  });
}
```

- [ ] **Step 6: Register POS status route before detail route**

Modify `src/v1/pickup-order/pickup-order.router.ts` imports:

```ts
  updatePickupOrderStatusController,
```

Add this route before `/:id/member-phone` and `/:id`:

```ts
pickupOrderRouter.post(
  "/:id/status",
  userMiddleware,
  scopeMiddleware("sale"),
  updatePickupOrderStatusController,
);
```

- [ ] **Step 7: Run POS server verification**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: build passes and the targeted Node test passes.

---

## Task 5: POS Renderer Status Actions And Refresh Flow

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/pickup-order-types.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderSearchPanel.tsx`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Add POS target statuses to renderer types**

In `pickup-order-types.ts`, add after `PickupOrderStatusFilter`:

```ts
export const POS_PICKUP_ORDER_STATUS_TARGETS = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
] as const satisfies readonly PickupOrderStatus[];

export type PosPickupOrderStatus =
  (typeof POS_PICKUP_ORDER_STATUS_TARGETS)[number];
```

- [ ] **Step 2: Add renderer service functions**

In `pickup-order.service.ts`, add `PosPickupOrderStatus` to the type import and append:

```ts
export async function updatePickupOrderStatus(
  crmOrderId: number,
  status: PosPickupOrderStatus,
): Promise<ApiResponse<PickupOrderDetailWire>> {
  return apiService.post<PickupOrderDetailWire>(
    `/api/pickup-order/${crmOrderId}/status`,
    { status },
  );
}

export async function syncPickupOrders(): Promise<ApiResponse<unknown>> {
  return apiService.post<unknown>("/api/pickup-order/sync");
}
```

- [ ] **Step 3: Expose current page refresh from search panel**

In `PickupOrderSearchPanel.tsx`, change the React import:

```ts
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
```

Add after `interface Props`:

```ts
export type PickupOrderSearchPanelHandle = {
  refreshCurrentPage: () => void;
};
```

Change component declaration:

```ts
const PickupOrderSearchPanel = forwardRef<PickupOrderSearchPanelHandle, Props>(
  function PickupOrderSearchPanel({ onSelect }, ref) {
```

Add after `fetchPage`:

```ts
  useImperativeHandle(
    ref,
    () => ({
      refreshCurrentPage: () => {
        void fetchPage(paging?.currentPage ?? 1);
      },
    }),
    [fetchPage, paging?.currentPage],
  );
```

Close the component with `});` and add:

```ts
export default PickupOrderSearchPanel;
```

- [ ] **Step 4: Pass refresh callback from screen to viewer**

In `PickupOrderSearchScreen.tsx`, change imports:

```ts
import { useRef, useState } from "react";
import PickupOrderSearchPanel, {
  type PickupOrderSearchPanelHandle,
} from "../components/pickupOrders/PickupOrderSearchPanel";
```

Add inside the component:

```ts
const searchPanelRef = useRef<PickupOrderSearchPanelHandle | null>(null);
```

Pass the ref:

```tsx
<PickupOrderSearchPanel
  ref={searchPanelRef}
  onSelect={(order) => setViewerCrmOrderId(order.crmOrderId)}
/>
```

Pass refresh to viewer:

```tsx
<PickupOrderViewer
  crmOrderId={viewerCrmOrderId}
  onClose={() => setViewerCrmOrderId(null)}
  onRefreshList={() => searchPanelRef.current?.refreshCurrentPage()}
/>
```

- [ ] **Step 5: Add viewer status action behavior**

In `PickupOrderViewer.tsx`, import service functions and target types:

```ts
import {
  getPickupOrderByCrmId,
  getPickupOrderMemberPhone,
  syncPickupOrders,
  updatePickupOrderStatus,
} from "../../service/pickup-order.service";
```

```ts
  POS_PICKUP_ORDER_STATUS_TARGETS,
  type PosPickupOrderStatus,
```

Extend props:

```ts
type Props = {
  crmOrderId: number | null;
  onClose: () => void;
  onRefreshList: () => void;
};
```

Add state and reusable detail loader:

```ts
const [statusActionLoading, setStatusActionLoading] = useState(false);
const [statusActionError, setStatusActionError] = useState("");

const loadOrder = async (id: number) => {
  const res = await getPickupOrderByCrmId(id);
  if (res.ok && res.result) {
    resetPhoneReveal();
    setOrder(res.result);
    setSelectedCrmLineId(res.result.lines[0]?.crmLineId ?? null);
    return;
  }
  throw new Error(res.msg || "Failed to load pickup order");
};
```

Replace the current `getPickupOrderByCrmId` logic inside `useEffect` with:

```ts
      try {
        await loadOrder(crmOrderId);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load pickup order");
      } finally {
```

Add status change handler:

```ts
const changeStatus = async (status: PosPickupOrderStatus) => {
  if (crmOrderId == null || !order || statusActionLoading) return;
  const label = statusLabel(status);
  const firstConfirmed = window.confirm(`Change pickup order status to ${label}?`);
  if (!firstConfirmed) return;
  const secondConfirmed = window.confirm(
    `Customer may receive a push notification for ${label}. Continue?`,
  );
  if (!secondConfirmed) return;

  setStatusActionLoading(true);
  setStatusActionError("");
  try {
    const statusRes = await updatePickupOrderStatus(crmOrderId, status);
    if (!statusRes.ok) {
      throw new Error(statusRes.msg || "Failed to update pickup order status");
    }

    const syncRes = await syncPickupOrders();
    if (!syncRes.ok) {
      throw new Error(syncRes.msg || "Pickup order updated, but sync failed");
    }

    await loadOrder(crmOrderId);
    onRefreshList();
  } catch (err) {
    setStatusActionError(
      err instanceof Error ? err.message : "Failed to update pickup order status",
    );
  } finally {
    setStatusActionLoading(false);
  }
};
```

Pass action props into `OrderSummary`:

```tsx
<OrderSummary
  order={order}
  revealedPhone={revealedPhone}
  phoneLoading={phoneLoading}
  phoneError={phoneError}
  statusActionLoading={statusActionLoading}
  statusActionError={statusActionError}
  onRevealPhone={revealPhone}
  onHidePhone={hidePhone}
  onChangeStatus={changeStatus}
/>
```

Extend `OrderSummary` parameters and render status actions below the summary grid:

```tsx
<StatusActions
  currentStatus={order.status}
  loading={statusActionLoading}
  error={statusActionError}
  onChangeStatus={onChangeStatus}
/>
```

Add the component near `PhoneRevealControl`:

```tsx
function StatusActions({
  currentStatus,
  loading,
  error,
  onChangeStatus,
}: {
  currentStatus: PickupOrderStatus;
  loading: boolean;
  error: string;
  onChangeStatus: (status: PosPickupOrderStatus) => void;
}) {
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400">
        Status actions
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {POS_PICKUP_ORDER_STATUS_TARGETS.map((status) => {
          const isCurrent = status === currentStatus;
          return (
            <button
              key={status}
              type="button"
              disabled={loading || isCurrent}
              onPointerDown={() => onChangeStatus(status)}
              className={cn(
                "min-h-10 rounded-md border px-2 py-1 text-xs font-bold uppercase tracking-wide",
                isCurrent || loading
                  ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300"
                  : "border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100",
              )}
            >
              {isCurrent ? "Current" : statusLabel(status)}
            </button>
          );
        })}
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Run POS app build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build passes.

---

## Task 6: Final Verification And Review Notes

**Files:**
- Verify only: `/Users/dev/ktpv5/ktpv5-dmarket-app/app/_layout.tsx`
- Do not edit: `/Users/dev/ktpv5/ktpv5-dmarket-app/api/apiService.ts`

- [ ] **Step 1: Verify dmarket routing comment exists**

Run:

```bash
rg -n "Route pickup-order push notifications" /Users/dev/ktpv5/ktpv5-dmarket-app/app/_layout.tsx
```

Expected: one match under the receipt notification routing branch.

- [ ] **Step 2: Run final verification commands**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && node --test dist/v1/pickup-order/pickup-order.status.test.js
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Manual POS flow check**

Start the POS server and app in the usual development setup, then verify:

1. Open `/manager/pickup-orders`.
2. Open a pickup order detail.
3. Confirm the current status action is disabled and `CANCELLED_BY_CUSTOMER` is absent.
4. Choose `READY`.
5. First confirmation names `READY`.
6. Second confirmation says the customer may receive a push notification.
7. After confirming, POS calls `POST /api/pickup-order/:id/status`, then `POST /api/pickup-order/sync`.
8. Detail refreshes with the new status.
9. The current list page refreshes without clearing filters.
10. CRM `PickupOrderStatusEvent` contains `fromStatus`, `toStatus`, `actorType: KTP_USER`, POS `actorId`, and POS `actorNameSnapshot`.

---

## Self-Review

- Spec coverage:
  - CRM canonical mutation: Task 2 and Task 3.
  - POS-allowed target statuses only: Task 1, Task 4, Task 5.
  - `CANCELLED_BY_CUSTOMER` not exposed or accepted from POS: Task 1, Task 4, Task 5.
  - Transactional status update plus event append: Task 2.
  - Push after successful transaction and fire-and-forget endpoint behavior: Task 1 and Task 3.
  - POS flow with two confirmations, local endpoint, CRM endpoint, sync, detail/list refresh: Task 4 and Task 5.
  - Dream Market deep link deferred, existing comment verified only: Task 6.
- Placeholder scan:
  - No plan steps use open-ended filler phrases or ask a worker to invent missing test coverage.
  - The plan keeps the deferred dmarket work as a verification-only item.
- Type consistency:
  - CRM `PosPickupOrderStatus` is shared by validation, service, controller, and push helper.
  - POS server `PosPickupOrderStatus` mirrors the same target status list.
  - Renderer `PosPickupOrderStatus` comes from `POS_PICKUP_ORDER_STATUS_TARGETS`, so the UI cannot offer `CANCELLED_BY_CUSTOMER`.
