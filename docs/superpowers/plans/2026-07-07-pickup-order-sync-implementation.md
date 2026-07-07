# Pickup Order Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CRM-to-retail-POS pickup order cache synchronization with a `CRON_INSTANCE=true` gated 60-second worker.

**Architecture:** CRM remains the canonical pickup order owner and exposes a device-authenticated incremental sync endpoint. The retail POS server stores a purpose-built local snapshot cache, syncs it by CRM `updatedAt` cursor, emits Socket.IO events for newly cached orders, and serves local cached-order APIs. Status mutation, label printing, and print history are outside this implementation plan.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7 generated clients, PostgreSQL, Axios-based `crmApiService`, Socket.IO, Node built-in test runner.

---

## Scope

This plan implements the approved design in `docs/superpowers/specs/2026-07-07-pickup-order-sync-design.md`.

In scope:

- CRM `/device/pickup-order/sync`.
- Retail POS Prisma cache tables.
- Retail POS sync state, repository, service, worker, local routes.
- `CRON_INSTANCE=true` startup gate.
- Socket.IO `pickup-order:new` emission.
- Build and targeted Node test verification.

Out of scope:

- Pickup order screen in the Electron renderer.
- Line-label template and printing.
- `PrintHistory`.
- CRM status mutation endpoints and POS action buttons.
- Offline mutation outbox.

Repository rule: do not stage or commit unless the user explicitly requests it. The checkpoint steps below are review checkpoints, not automatic git commits.

---

## File Structure

### CRM Server: `/Users/dev/ktpv5/ktpv5-crm-server`

- Create `src/device/pickup-order/pickupOrderSync.types.ts`
  - Wire DTOs for the device sync endpoint.
- Create `src/device/pickup-order/pickupOrderSync.validation.ts`
  - Parses `updatedAfter`, `afterId`, and `limit` query params.
- Create `src/device/pickup-order/pickupOrderSync.service.ts`
  - Reads `PickupOrder + lines`, excludes status events, builds cursor response.
- Create `src/device/pickup-order/pickupOrderSync.controller.ts`
  - Reads `res.locals.companyId`, validates query, returns service envelope.
- Create `src/device/pickup-order/pickupOrderSync.routes.ts`
  - Registers `GET /sync`.
- Modify `src/router/device.router.ts`
  - Mounts `/device/pickup-order`.
- Create `src/libs/pickupOrder.deviceSync.test.ts`
  - Unit tests validation, cursor filtering, payload shape, and route mounting.

### Retail POS Server: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server`

- Modify `prisma/schema.prisma`
  - Add `PickupOrderCache`, `PickupOrderLineCache`, `PickupOrderSyncState`.
- Create Prisma migration
  - `prisma/migrations/<timestamp>_pickup_order_cache/migration.sql`.
- Create `src/v1/pickup-order/pickup-order.types.ts`
  - CRM wire DTOs, local DTOs, sync result types.
- Create `src/v1/pickup-order/pickup-order.crm.ts`
  - Thin `crmApiService` client and response normalization.
- Create `src/v1/pickup-order/pickup-order.repository.ts`
  - Local DB upsert/query/sync-state functions.
- Create `src/v1/pickup-order/pickup-order.sync.service.ts`
  - Cursor loop, overlap handling, new-order detection, Socket.IO emission.
- Create `src/v1/pickup-order/pickup-order.controller.ts`
  - Local list/detail/manual sync controllers.
- Create `src/v1/pickup-order/pickup-order.router.ts`
  - Local `/api/pickup-order` routes.
- Create `src/v1/pickup-order/pickup-order.worker.ts`
  - `CRON_INSTANCE=true` gated startup worker.
- Modify `src/router.ts`
  - Mounts `/pickup-order`.
- Modify `src/index.ts`
  - Starts pickup order worker after HTTP server boot.
- Create `src/v1/pickup-order/pickup-order.sync.service.test.ts`
  - Unit tests concurrency guard, cursor advancement, failure behavior, new-order event.
- Create `src/v1/pickup-order/pickup-order.query.test.ts`
  - Unit tests local query parsing/filter helpers.

---

## Task 1: CRM Device Sync Query Validation

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.types.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.validation.ts`
- Test: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrder.deviceSync.test.ts`

- [ ] **Step 1: Add the CRM sync DTO types**

Create `src/device/pickup-order/pickupOrderSync.types.ts`:

```ts
export type PickupOrderSyncQuery = {
  updatedAfter?: Date;
  afterId?: number;
  limit: number;
};

export type PickupOrderSyncLineDto = {
  id: number;
  orderId: number;
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
  selectedOptionsSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

export type PickupOrderSyncItemDto = {
  id: number;
  companyId: number;
  documentId: string;
  status:
    | "PENDING"
    | "ORDER_CONFIRMED"
    | "READY"
    | "COMPLETED"
    | "CANCELLED_BY_STORE"
    | "CANCELLED_BY_CUSTOMER";
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  lines: PickupOrderSyncLineDto[];
};

export type PickupOrderSyncCursorDto = {
  updatedAt: string;
  orderId: number;
};

export type PickupOrderSyncResultDto = {
  items: PickupOrderSyncItemDto[];
  nextCursor: PickupOrderSyncCursorDto | null;
  hasMore: boolean;
};
```

- [ ] **Step 2: Add query validation tests**

Create the first section of `src/libs/pickupOrder.deviceSync.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Router } from "express";

import { BadRequestException } from "../libs/exceptions";
import { parsePickupOrderSyncQuery } from "../device/pickup-order/pickupOrderSync.validation";

test("parsePickupOrderSyncQuery defaults to limit 100", () => {
  const query = parsePickupOrderSyncQuery({});
  assert.equal(query.limit, 100);
  assert.equal(query.updatedAfter, undefined);
  assert.equal(query.afterId, undefined);
});

test("parsePickupOrderSyncQuery accepts ISO cursor and afterId", () => {
  const query = parsePickupOrderSyncQuery({
    updatedAfter: "2026-07-07T04:00:00.000Z",
    afterId: "42",
    limit: "50",
  });
  assert.equal(query.updatedAfter?.toISOString(), "2026-07-07T04:00:00.000Z");
  assert.equal(query.afterId, 42);
  assert.equal(query.limit, 50);
});

test("parsePickupOrderSyncQuery rejects invalid updatedAfter", () => {
  assert.throws(
    () => parsePickupOrderSyncQuery({ updatedAfter: "2026-99-99" }),
    BadRequestException,
  );
});

test("parsePickupOrderSyncQuery caps limit at 500", () => {
  assert.throws(
    () => parsePickupOrderSyncQuery({ limit: "501" }),
    /limit must be between 1 and 500/,
  );
});
```

- [ ] **Step 3: Run the CRM test and confirm it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: TypeScript build fails because `pickupOrderSync.validation` does not exist.

- [ ] **Step 4: Implement query validation**

Create `src/device/pickup-order/pickupOrderSync.validation.ts`:

```ts
import { BadRequestException } from "../../libs/exceptions";
import type { PickupOrderSyncQuery } from "./pickupOrderSync.types";

const positiveIntegerPattern = /^[1-9]\d*$/;
const maxPostgresInt = 2147483647;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > maxPostgresInt) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }
    return value;
  }

  if (typeof value !== "string" || !positiveIntegerPattern.test(value)) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }

  const parsed = Number(value);
  if (parsed > maxPostgresInt) {
    throw new BadRequestException(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalDate(value: unknown): Date | undefined {
  const raw = first(value);
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new BadRequestException("updatedAfter must be a valid ISO date");
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== raw) {
    throw new BadRequestException("updatedAfter must be a valid ISO date");
  }
  return parsed;
}

export function parsePickupOrderSyncQuery(
  query: Record<string, unknown>,
): PickupOrderSyncQuery {
  const limit = parsePositiveInt(first(query.limit) ?? "100", "limit");
  if (limit > 500) {
    throw new BadRequestException("limit must be between 1 and 500");
  }

  const afterIdRaw = first(query.afterId);
  return {
    updatedAfter: parseOptionalDate(query.updatedAfter),
    ...(afterIdRaw === undefined || afterIdRaw === ""
      ? {}
      : { afterId: parsePositiveInt(afterIdRaw, "afterId") }),
    limit,
  };
}
```

- [ ] **Step 5: Run the CRM validation test**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: tests in `pickupOrder.deviceSync.test.js` pass or fail only because later tests in the file have not been added yet.

- [ ] **Step 6: Review checkpoint**

Review only these files:

```bash
git diff -- src/device/pickup-order/pickupOrderSync.types.ts src/device/pickup-order/pickupOrderSync.validation.ts src/libs/pickupOrder.deviceSync.test.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 2: CRM Device Sync Service And Route

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.controller.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/pickup-order/pickupOrderSync.routes.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/router/device.router.ts`
- Test: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/pickupOrder.deviceSync.test.ts`

- [ ] **Step 1: Add service tests to the CRM test file**

Append to `src/libs/pickupOrder.deviceSync.test.ts`:

```ts
import {
  getPickupOrderSyncPage,
  type PickupOrderSyncDb,
} from "../device/pickup-order/pickupOrderSync.service";
import pickupOrderSyncRouter from "../device/pickup-order/pickupOrderSync.routes";

function makePickupOrderSyncDb(rows: Array<{
  id: number;
  companyId: number;
  documentId: string;
  status: "PENDING" | "ORDER_CONFIRMED";
  updatedAt: Date;
}>): PickupOrderSyncDb {
  return {
    pickupOrder: {
      async findMany(args) {
        const limit = args.take;
        const companyId = args.where.companyId;
        const filtered = rows
          .filter((row) => row.companyId === companyId)
          .filter((row) => {
            const cursor = args.where.OR;
            if (!cursor) return true;
            return cursor.some((entry) => {
              if ("updatedAt" in entry && entry.updatedAt?.gt) {
                return row.updatedAt > entry.updatedAt.gt;
              }
              if ("AND" in entry) {
                return (
                  row.updatedAt.getTime() === entry.AND[0].updatedAt.equals.getTime() &&
                  row.id > entry.AND[1].id.gt
                );
              }
              return false;
            });
          })
          .sort((first, second) => {
            const updatedDiff = first.updatedAt.getTime() - second.updatedAt.getTime();
            return updatedDiff || first.id - second.id;
          })
          .slice(0, limit)
          .map((row) => ({
            ...row,
            memberId: "member-1",
            memberName: "Jane",
            memberLevel: 1,
            memberPhoneLast4: "1234",
            pickupStartsAt: new Date("2026-07-08T01:00:00.000Z"),
            linesTotal: 1500,
            total: 1500,
            createdAt: new Date("2026-07-07T01:00:00.000Z"),
            lines: [
              {
                id: row.id * 10,
                orderId: row.id,
                index: 0,
                itemId: 99,
                name_en: "Rice cake",
                name_ko: "떡",
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
                updatedAt: row.updatedAt,
              },
            ],
          }));
      },
    },
  };
}

test("getPickupOrderSyncPage returns ordered items and next cursor", async () => {
  const db = makePickupOrderSyncDb([
    {
      id: 1,
      companyId: 7,
      documentId: "7-260707-101",
      status: "PENDING",
      updatedAt: new Date("2026-07-07T01:00:00.000Z"),
    },
    {
      id: 2,
      companyId: 7,
      documentId: "7-260707-102",
      status: "ORDER_CONFIRMED",
      updatedAt: new Date("2026-07-07T01:01:00.000Z"),
    },
  ]);

  const page = await getPickupOrderSyncPage(
    7,
    { limit: 1 },
    { dbClient: db },
  );

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 1);
  assert.equal(page.items[0].lines.length, 1);
  assert.deepEqual(page.nextCursor, {
    updatedAt: "2026-07-07T01:00:00.000Z",
    orderId: 1,
  });
  assert.equal(page.hasMore, true);
});

test("pickupOrderSyncRouter registers GET /sync", () => {
  const stack = (pickupOrderSyncRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
  const route = stack.find((layer) => layer.route?.path === "/sync");
  assert.equal(route?.route?.methods.get, true);
});
```

- [ ] **Step 2: Run the CRM test and confirm it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: TypeScript build fails because service and route files do not exist.

- [ ] **Step 3: Implement CRM sync service**

Create `src/device/pickup-order/pickupOrderSync.service.ts`:

```ts
import { Prisma } from "../../generated/prisma/client";
import db from "../../libs/db";
import type {
  PickupOrderSyncItemDto,
  PickupOrderSyncQuery,
  PickupOrderSyncResultDto,
} from "./pickupOrderSync.types";

type PickupOrderFindManyArgs = {
  where: Prisma.PickupOrderWhereInput;
  orderBy: Array<{ updatedAt: "asc" } | { id: "asc" }>;
  take: number;
  include: {
    lines: {
      orderBy: { index: "asc" };
    };
  };
};

export type PickupOrderSyncDb = {
  pickupOrder: {
    findMany(args: PickupOrderFindManyArgs): Promise<Array<{
      id: number;
      companyId: number;
      documentId: string;
      status: PickupOrderSyncItemDto["status"];
      memberId: string;
      memberName: string;
      memberLevel: number;
      memberPhoneLast4: string | null;
      pickupStartsAt: Date;
      linesTotal: number;
      total: number;
      createdAt: Date;
      updatedAt: Date;
      lines: Array<{
        id: number;
        orderId: number;
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
        selectedOptionsSnapshot: unknown;
        createdAt: Date;
        updatedAt: Date;
      }>;
    }>>;
  };
};

function buildCursorWhere(query: PickupOrderSyncQuery): Prisma.PickupOrderWhereInput {
  if (!query.updatedAfter) return {};

  return {
    OR: [
      { updatedAt: { gt: query.updatedAfter } },
      {
        AND: [
          { updatedAt: { equals: query.updatedAfter } },
          { id: { gt: query.afterId ?? 0 } },
        ],
      },
    ],
  };
}

function mapOrder(row: Awaited<ReturnType<PickupOrderSyncDb["pickupOrder"]["findMany"]>>[number]): PickupOrderSyncItemDto {
  return {
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    status: row.status,
    memberId: row.memberId,
    memberName: row.memberName,
    memberLevel: row.memberLevel,
    memberPhoneLast4: row.memberPhoneLast4,
    pickupStartsAt: row.pickupStartsAt.toISOString(),
    linesTotal: row.linesTotal,
    total: row.total,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      orderId: line.orderId,
      index: line.index,
      itemId: line.itemId,
      name_en: line.name_en,
      name_ko: line.name_ko,
      barcode: line.barcode,
      code: line.code,
      uom: line.uom,
      prices: line.prices,
      promoPrices: line.promoPrices,
      memberLevel: line.memberLevel,
      optionTotal: line.optionTotal,
      qty: line.qty,
      total: line.total,
      note: line.note,
      selectedOptionsSnapshot: line.selectedOptionsSnapshot,
      createdAt: line.createdAt.toISOString(),
      updatedAt: line.updatedAt.toISOString(),
    })),
  };
}

export async function getPickupOrderSyncPage(
  companyId: number,
  query: PickupOrderSyncQuery,
  options: { dbClient?: PickupOrderSyncDb } = {},
): Promise<PickupOrderSyncResultDto> {
  const client = options.dbClient ?? db;
  const rows = await client.pickupOrder.findMany({
    where: {
      companyId,
      ...buildCursorWhere(query),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    include: {
      lines: {
        orderBy: { index: "asc" },
      },
    },
  });

  const pageRows = rows.slice(0, query.limit);
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(mapOrder),
    nextCursor: last
      ? { updatedAt: last.updatedAt.toISOString(), orderId: last.id }
      : null,
    hasMore: rows.length > query.limit,
  };
}
```

- [ ] **Step 4: Implement CRM controller and route**

Create `src/device/pickup-order/pickupOrderSync.controller.ts`:

```ts
import { Request, Response } from "express";
import { BadRequestException } from "../../libs/exceptions";
import { getPickupOrderSyncPage } from "./pickupOrderSync.service";
import { parsePickupOrderSyncQuery } from "./pickupOrderSync.validation";

function getCompanyId(res: Response): number {
  const companyId = res.locals.companyId;
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new BadRequestException("Company not found");
  }
  return companyId;
}

export async function getPickupOrderSyncController(
  req: Request,
  res: Response,
) {
  const query = parsePickupOrderSyncQuery(req.query as Record<string, unknown>);
  const result = await getPickupOrderSyncPage(getCompanyId(res), query);
  res.status(200).json({
    ok: true,
    msg: "Pickup orders synced",
    result,
    paging: null,
  });
}
```

Create `src/device/pickup-order/pickupOrderSync.routes.ts`:

```ts
import { Router } from "express";
import { getPickupOrderSyncController } from "./pickupOrderSync.controller";

const pickupOrderSyncRouter = Router();

pickupOrderSyncRouter.get("/sync", getPickupOrderSyncController);

export default pickupOrderSyncRouter;
```

Modify `src/router/device.router.ts`:

```ts
import { Router } from "express";
import { deviceMiddleware } from "../middleware";
import memberRouter from "../device/member/member.routes";
import customerVoucherRouter from "../device/customer-voucher/customerVoucher.routes";
import pickupOrderSyncRouter from "../device/pickup-order/pickupOrderSync.routes";

const deviceRouter = Router();

deviceRouter.use(deviceMiddleware);

deviceRouter.use("/member", memberRouter);
deviceRouter.use("/customer-voucher", customerVoucherRouter);
deviceRouter.use("/pickup-order", pickupOrderSyncRouter);
export default deviceRouter;
```

- [ ] **Step 5: Run CRM targeted test**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build && node --test dist/libs/pickupOrder.deviceSync.test.js
```

Expected: all tests in `pickupOrder.deviceSync.test.js` pass.

- [ ] **Step 6: Run CRM full test suite**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: all CRM tests pass. If existing unrelated tests fail, capture the failing test names and continue only after confirming they are pre-existing.

- [ ] **Step 7: Review checkpoint**

Review:

```bash
git diff -- src/device/pickup-order src/router/device.router.ts src/libs/pickupOrder.deviceSync.test.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 3: POS Prisma Cache Schema

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/prisma/schema.prisma`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/prisma/migrations/<timestamp>_pickup_order_cache/migration.sql`

- [ ] **Step 1: Add POS cache models to Prisma schema**

Insert after `PrintedItemSheet` in `retail_pos_server/prisma/schema.prisma`:

```prisma
model PickupOrderCache {
  id               Int      @id @default(autoincrement())
  crmOrderId       Int      @unique
  companyId        Int
  documentId       String   @unique
  status           String

  memberId         String
  memberName       String
  memberLevel      Int
  memberPhoneLast4 String?

  pickupStartsAt   DateTime
  linesTotal       Int
  total            Int

  crmCreatedAt     DateTime
  crmUpdatedAt     DateTime
  syncedAt         DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  lines            PickupOrderLineCache[]

  @@index([companyId, status, pickupStartsAt])
  @@index([companyId, pickupStartsAt])
  @@index([companyId, crmUpdatedAt])
  @@index([companyId, syncedAt])
}

model PickupOrderLineCache {
  id                      Int              @id @default(autoincrement())
  crmLineId               Int              @unique
  crmOrderId              Int
  order                   PickupOrderCache @relation(fields: [crmOrderId], references: [crmOrderId], onDelete: Cascade)

  index                   Int
  itemId                  Int
  name_en                 String
  name_ko                 String
  barcode                 String
  code                    String?
  uom                     String

  prices                  Int[]
  promoPrices             Json?
  memberLevel             Int
  optionTotal             Int
  qty                     Int
  total                   Int
  note                    String?
  selectedOptionsSnapshot Json

  crmCreatedAt            DateTime
  crmUpdatedAt            DateTime
  syncedAt                DateTime         @default(now())
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  @@index([crmOrderId, index])
  @@index([itemId])
  @@index([barcode])
  @@index([code])
}

model PickupOrderSyncState {
  id              Int       @id @default(autoincrement())
  key             String    @unique
  cursorUpdatedAt DateTime?
  cursorOrderId   Int?
  lastSyncedAt    DateTime?
  lastSuccessAt   DateTime?
  lastErrorAt     DateTime?
  lastErrorMsg    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

- [ ] **Step 2: Create the SQL migration**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/pickup_order_cache_full.sql
```

Expected: command succeeds and writes a full schema diff to `/tmp/pickup_order_cache_full.sql`.

Create a migration folder named with the current timestamp:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
mkdir -p prisma/migrations/20260707000000_pickup_order_cache
```

Create `prisma/migrations/20260707000000_pickup_order_cache/migration.sql` with only the three new table blocks:

```sql
CREATE TABLE "PickupOrderCache" (
    "id" SERIAL NOT NULL,
    "crmOrderId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "memberLevel" INTEGER NOT NULL,
    "memberPhoneLast4" TEXT,
    "pickupStartsAt" TIMESTAMP(3) NOT NULL,
    "linesTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "crmCreatedAt" TIMESTAMP(3) NOT NULL,
    "crmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupOrderLineCache" (
    "id" SERIAL NOT NULL,
    "crmLineId" INTEGER NOT NULL,
    "crmOrderId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "code" TEXT,
    "uom" TEXT NOT NULL,
    "prices" INTEGER[],
    "promoPrices" JSONB,
    "memberLevel" INTEGER NOT NULL,
    "optionTotal" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "note" TEXT,
    "selectedOptionsSnapshot" JSONB NOT NULL,
    "crmCreatedAt" TIMESTAMP(3) NOT NULL,
    "crmUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderLineCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupOrderSyncState" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "cursorUpdatedAt" TIMESTAMP(3),
    "cursorOrderId" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickupOrderSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickupOrderCache_crmOrderId_key" ON "PickupOrderCache"("crmOrderId");
CREATE UNIQUE INDEX "PickupOrderCache_documentId_key" ON "PickupOrderCache"("documentId");
CREATE INDEX "PickupOrderCache_companyId_status_pickupStartsAt_idx" ON "PickupOrderCache"("companyId", "status", "pickupStartsAt");
CREATE INDEX "PickupOrderCache_companyId_pickupStartsAt_idx" ON "PickupOrderCache"("companyId", "pickupStartsAt");
CREATE INDEX "PickupOrderCache_companyId_crmUpdatedAt_idx" ON "PickupOrderCache"("companyId", "crmUpdatedAt");
CREATE INDEX "PickupOrderCache_companyId_syncedAt_idx" ON "PickupOrderCache"("companyId", "syncedAt");

CREATE UNIQUE INDEX "PickupOrderLineCache_crmLineId_key" ON "PickupOrderLineCache"("crmLineId");
CREATE INDEX "PickupOrderLineCache_crmOrderId_index_idx" ON "PickupOrderLineCache"("crmOrderId", "index");
CREATE INDEX "PickupOrderLineCache_itemId_idx" ON "PickupOrderLineCache"("itemId");
CREATE INDEX "PickupOrderLineCache_barcode_idx" ON "PickupOrderLineCache"("barcode");
CREATE INDEX "PickupOrderLineCache_code_idx" ON "PickupOrderLineCache"("code");

CREATE UNIQUE INDEX "PickupOrderSyncState_key_key" ON "PickupOrderSyncState"("key");

ALTER TABLE "PickupOrderLineCache" ADD CONSTRAINT "PickupOrderLineCache_crmOrderId_fkey" FOREIGN KEY ("crmOrderId") REFERENCES "PickupOrderCache"("crmOrderId") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npx prisma generate
```

Expected: Prisma client generation succeeds and generated files include the three new models.

- [ ] **Step 4: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build passes with no TypeScript errors.

- [ ] **Step 5: Review checkpoint**

Review:

```bash
git diff -- prisma/schema.prisma prisma/migrations/20260707000000_pickup_order_cache/migration.sql src/generated/prisma
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 4: POS Pickup Order Types And CRM Client

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.types.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.crm.ts`

- [ ] **Step 1: Create POS pickup order types**

Create `src/v1/pickup-order/pickup-order.types.ts`:

```ts
export type PickupOrderStatus =
  | "PENDING"
  | "ORDER_CONFIRMED"
  | "READY"
  | "COMPLETED"
  | "CANCELLED_BY_STORE"
  | "CANCELLED_BY_CUSTOMER";

export type CrmPickupOrderLineWire = {
  id: number;
  orderId: number;
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
  selectedOptionsSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CrmPickupOrderWire = {
  id: number;
  companyId: number;
  documentId: string;
  status: PickupOrderStatus;
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  lines: CrmPickupOrderLineWire[];
};

export type PickupOrderSyncCursor = {
  updatedAt: string;
  orderId: number;
};

export type PickupOrderSyncPage = {
  items: CrmPickupOrderWire[];
  nextCursor: PickupOrderSyncCursor | null;
  hasMore: boolean;
};

export type PickupOrderSyncOutcome = {
  pulled: number;
  inserted: number;
  updated: number;
  emittedNewOrderCount: number;
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
};

export type PickupOrderListQuery = {
  status?: PickupOrderStatus;
  from?: Date;
  to?: Date;
  keyword?: string;
  page: number;
  limit: number;
};
```

- [ ] **Step 2: Create CRM client**

Create `src/v1/pickup-order/pickup-order.crm.ts`:

```ts
import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type { PickupOrderSyncPage } from "./pickup-order.types";

function requireOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (res.ok && res.result != null) return res.result;

  const msg = res.msg || "CRM pickup order request failed";
  if (res.status === 400 || res.status === 404) {
    throw new BadRequestException(msg);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedException(msg);
  }
  if (res.status === 0 || (res.status && res.status >= 500)) {
    throw new InternalServerException("CRM pickup order service unavailable");
  }
  throw new HttpException(res.status ?? 502, msg);
}

export async function fetchCrmPickupOrderSyncPage(input: {
  updatedAfter?: Date;
  afterId?: number;
  limit: number;
}): Promise<PickupOrderSyncPage> {
  const res = await crmApiService.get<PickupOrderSyncPage>(
    "/device/pickup-order/sync",
    {
      ...(input.updatedAfter
        ? { updatedAfter: input.updatedAfter.toISOString() }
        : {}),
      ...(input.afterId ? { afterId: input.afterId } : {}),
      limit: input.limit,
    },
  );

  return requireOk(res);
}
```

- [ ] **Step 3: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build passes.

- [ ] **Step 4: Review checkpoint**

Review:

```bash
git diff -- src/v1/pickup-order/pickup-order.types.ts src/v1/pickup-order/pickup-order.crm.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 5: POS Repository And Local Query Helpers

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.repository.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.query.test.ts`

- [ ] **Step 1: Add query helper tests**

Create `src/v1/pickup-order/pickup-order.query.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPickupOrderKeywordWhere,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";

test("parsePickupOrderListQuery defaults page and limit", () => {
  const query = parsePickupOrderListQuery({});
  assert.equal(query.page, 1);
  assert.equal(query.limit, 20);
});

test("parsePickupOrderListQuery accepts status and keyword", () => {
  const query = parsePickupOrderListQuery({
    status: "PENDING",
    keyword: "  rice  ",
    page: "2",
    limit: "50",
  });
  assert.equal(query.status, "PENDING");
  assert.equal(query.keyword, "rice");
  assert.equal(query.page, 2);
  assert.equal(query.limit, 50);
});

test("parsePickupOrderListQuery rejects unknown status", () => {
  assert.throws(
    () => parsePickupOrderListQuery({ status: "PRINTED" }),
    /status must be a valid pickup order status/,
  );
});

test("buildPickupOrderKeywordWhere searches order and line fields", () => {
  const where = buildPickupOrderKeywordWhere("rice");
  assert.ok(where.OR);
  assert.equal(where.OR.length, 3);
});
```

- [ ] **Step 2: Run POS query test and confirm it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.query.test.js
```

Expected: TypeScript build fails because `pickup-order.repository` does not exist.

- [ ] **Step 3: Implement repository and query helpers**

Create `src/v1/pickup-order/pickup-order.repository.ts`:

```ts
import { Prisma } from "../../generated/prisma/client";
import db from "../../libs/db";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import { buildPaging } from "../../libs/pagination";
import type {
  CrmPickupOrderWire,
  PickupOrderListQuery,
  PickupOrderStatus,
} from "./pickup-order.types";

const validStatuses = new Set<PickupOrderStatus>([
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
  "CANCELLED_BY_CUSTOMER",
]);

const positiveIntegerPattern = /^[1-9]\d*$/;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && positiveIntegerPattern.test(value)) {
    return Number(value);
  }
  throw new BadRequestException(`${fieldName} must be a positive integer`);
}

function parseOptionalDate(value: unknown, fieldName: string): Date | undefined {
  const raw = first(value);
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  return parsed;
}

export function parsePickupOrderListQuery(
  query: Record<string, unknown>,
): PickupOrderListQuery {
  const rawStatus = first(query.status);
  const rawKeyword = first(query.keyword);
  const page = parsePositiveInt(first(query.page) ?? "1", "page");
  const limit = parsePositiveInt(first(query.limit) ?? "20", "limit");

  if (limit > 100) {
    throw new BadRequestException("limit must be between 1 and 100");
  }
  if (rawStatus !== undefined && rawStatus !== "") {
    if (typeof rawStatus !== "string" || !validStatuses.has(rawStatus as PickupOrderStatus)) {
      throw new BadRequestException("status must be a valid pickup order status");
    }
  }
  if (rawKeyword !== undefined && typeof rawKeyword !== "string") {
    throw new BadRequestException("keyword must be a string");
  }

  const keyword = typeof rawKeyword === "string" ? rawKeyword.trim() : "";
  return {
    ...(rawStatus ? { status: rawStatus as PickupOrderStatus } : {}),
    from: parseOptionalDate(query.from, "from"),
    to: parseOptionalDate(query.to, "to"),
    ...(keyword ? { keyword } : {}),
    page,
    limit,
  };
}

export function buildPickupOrderKeywordWhere(
  keyword: string | undefined,
): Prisma.PickupOrderCacheWhereInput {
  if (!keyword) return {};
  return {
    OR: [
      { documentId: { contains: keyword, mode: "insensitive" } },
      { memberName: { contains: keyword, mode: "insensitive" } },
      {
        lines: {
          some: {
            OR: [
              { name_en: { contains: keyword, mode: "insensitive" } },
              { name_ko: { contains: keyword, mode: "insensitive" } },
              { barcode: { contains: keyword, mode: "insensitive" } },
              { code: { contains: keyword, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

function buildDateWhere(query: PickupOrderListQuery): Prisma.PickupOrderCacheWhereInput {
  const pickupStartsAt: Prisma.DateTimeFilter = {};
  if (query.from) pickupStartsAt.gte = query.from;
  if (query.to) pickupStartsAt.lt = query.to;
  return Object.keys(pickupStartsAt).length > 0 ? { pickupStartsAt } : {};
}

export async function getPickupOrderSyncState() {
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: { key: "pickup-order" },
    update: {},
  });
}

export async function markPickupOrderSyncSuccess(input: {
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
}) {
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: {
      key: "pickup-order",
      cursorUpdatedAt: input.cursorUpdatedAt,
      cursorOrderId: input.cursorOrderId,
      lastSyncedAt: new Date(),
      lastSuccessAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
    },
    update: {
      cursorUpdatedAt: input.cursorUpdatedAt,
      cursorOrderId: input.cursorOrderId,
      lastSyncedAt: new Date(),
      lastSuccessAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });
}

export async function markPickupOrderSyncFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: {
      key: "pickup-order",
      lastSyncedAt: new Date(),
      lastErrorAt: new Date(),
      lastErrorMsg: message.slice(0, 1000),
    },
    update: {
      lastSyncedAt: new Date(),
      lastErrorAt: new Date(),
      lastErrorMsg: message.slice(0, 1000),
    },
  });
}

export async function findExistingPickupOrderIds(crmOrderIds: number[]) {
  if (crmOrderIds.length === 0) return new Set<number>();
  const rows = await db.pickupOrderCache.findMany({
    where: { crmOrderId: { in: crmOrderIds } },
    select: { crmOrderId: true },
  });
  return new Set(rows.map((row) => row.crmOrderId));
}

export async function upsertPickupOrderPage(items: CrmPickupOrderWire[]) {
  return db.$transaction(async (tx) => {
    for (const item of items) {
      await tx.pickupOrderCache.upsert({
        where: { crmOrderId: item.id },
        create: {
          crmOrderId: item.id,
          companyId: item.companyId,
          documentId: item.documentId,
          status: item.status,
          memberId: item.memberId,
          memberName: item.memberName,
          memberLevel: item.memberLevel,
          memberPhoneLast4: item.memberPhoneLast4,
          pickupStartsAt: new Date(item.pickupStartsAt),
          linesTotal: item.linesTotal,
          total: item.total,
          crmCreatedAt: new Date(item.createdAt),
          crmUpdatedAt: new Date(item.updatedAt),
          syncedAt: new Date(),
        },
        update: {
          documentId: item.documentId,
          status: item.status,
          memberId: item.memberId,
          memberName: item.memberName,
          memberLevel: item.memberLevel,
          memberPhoneLast4: item.memberPhoneLast4,
          pickupStartsAt: new Date(item.pickupStartsAt),
          linesTotal: item.linesTotal,
          total: item.total,
          crmUpdatedAt: new Date(item.updatedAt),
          syncedAt: new Date(),
        },
      });

      for (const line of item.lines) {
        await tx.pickupOrderLineCache.upsert({
          where: { crmLineId: line.id },
          create: {
            crmLineId: line.id,
            crmOrderId: item.id,
            index: line.index,
            itemId: line.itemId,
            name_en: line.name_en,
            name_ko: line.name_ko,
            barcode: line.barcode,
            code: line.code,
            uom: line.uom,
            prices: line.prices,
            promoPrices: line.promoPrices === null ? Prisma.JsonNull : line.promoPrices,
            memberLevel: line.memberLevel,
            optionTotal: line.optionTotal,
            qty: line.qty,
            total: line.total,
            note: line.note,
            selectedOptionsSnapshot: line.selectedOptionsSnapshot,
            crmCreatedAt: new Date(line.createdAt),
            crmUpdatedAt: new Date(line.updatedAt),
            syncedAt: new Date(),
          },
          update: {
            index: line.index,
            itemId: line.itemId,
            name_en: line.name_en,
            name_ko: line.name_ko,
            barcode: line.barcode,
            code: line.code,
            uom: line.uom,
            prices: line.prices,
            promoPrices: line.promoPrices === null ? Prisma.JsonNull : line.promoPrices,
            memberLevel: line.memberLevel,
            optionTotal: line.optionTotal,
            qty: line.qty,
            total: line.total,
            note: line.note,
            selectedOptionsSnapshot: line.selectedOptionsSnapshot,
            crmUpdatedAt: new Date(line.updatedAt),
            syncedAt: new Date(),
          },
        });
      }
    }
  });
}

export async function listCachedPickupOrders(query: PickupOrderListQuery) {
  const where: Prisma.PickupOrderCacheWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...buildDateWhere(query),
    ...buildPickupOrderKeywordWhere(query.keyword),
  };

  const [rows, totalCount] = await db.$transaction([
    db.pickupOrderCache.findMany({
      where,
      orderBy: [{ pickupStartsAt: "asc" }, { crmOrderId: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        lines: {
          orderBy: { index: "asc" },
          take: 1,
        },
      },
    }),
    db.pickupOrderCache.count({ where }),
  ]);

  return {
    ok: true,
    msg: "Pickup orders loaded",
    result: { items: rows },
    paging: buildPaging({ page: query.page, limit: query.limit, totalCount }),
  };
}

export async function getCachedPickupOrderByCrmId(crmOrderId: number) {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId },
    include: { lines: { orderBy: { index: "asc" } } },
  });
  if (!row) throw new NotFoundException("Pickup order not found");
  return { ok: true, msg: "Pickup order loaded", result: row, paging: null };
}
```

- [ ] **Step 4: Run POS query test**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.query.test.js
```

Expected: all query helper tests pass.

- [ ] **Step 5: Review checkpoint**

Review:

```bash
git diff -- src/v1/pickup-order/pickup-order.repository.ts src/v1/pickup-order/pickup-order.query.test.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 6: POS Sync Service With Cursor Loop And Socket Event

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.sync.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.sync.service.test.ts`

- [ ] **Step 1: Add sync service tests**

Create `src/v1/pickup-order/pickup-order.sync.service.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createPickupOrderSyncService,
  subtractCursorOverlap,
} from "./pickup-order.sync.service";
import type { PickupOrderSyncPage } from "./pickup-order.types";

test("subtractCursorOverlap subtracts five seconds", () => {
  const result = subtractCursorOverlap(new Date("2026-07-07T01:00:05.000Z"));
  assert.equal(result.toISOString(), "2026-07-07T01:00:00.000Z");
});

test("syncPickupOrders advances cursor after page persistence", async () => {
  const calls: Array<{ updatedAfter?: Date; afterId?: number; limit: number }> = [];
  const emitted: unknown[] = [];
  const page: PickupOrderSyncPage = {
    items: [
      {
        id: 1,
        companyId: 1,
        documentId: "1-260707-101",
        status: "PENDING",
        memberId: "m1",
        memberName: "Jane",
        memberLevel: 1,
        memberPhoneLast4: "1234",
        pickupStartsAt: "2026-07-08T01:00:00.000Z",
        linesTotal: 1500,
        total: 1500,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:01:00.000Z",
        lines: [],
      },
    ],
    nextCursor: { updatedAt: "2026-07-07T00:01:00.000Z", orderId: 1 },
    hasMore: false,
  };

  const service = createPickupOrderSyncService({
    async fetchPage(input) {
      calls.push(input);
      return page;
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess(input) {
      assert.equal(input.cursorUpdatedAt?.toISOString(), "2026-07-07T00:01:00.000Z");
      assert.equal(input.cursorOrderId, 1);
    },
    async markFailure() {
      assert.fail("markFailure should not be called");
    },
    emitNewOrders(payload) {
      emitted.push(payload);
    },
  });

  const outcome = await service.syncPickupOrders();
  assert.equal(calls.length, 1);
  assert.equal(outcome.pulled, 1);
  assert.equal(outcome.inserted, 1);
  assert.equal(outcome.emittedNewOrderCount, 1);
  assert.equal(emitted.length, 1);
});

test("syncPickupOrders keeps cursor on failure", async () => {
  let failureMarked = false;
  const service = createPickupOrderSyncService({
    async fetchPage() {
      throw new Error("network down");
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess() {
      assert.fail("markSuccess should not be called");
    },
    async markFailure(error) {
      failureMarked = error instanceof Error && error.message === "network down";
    },
    emitNewOrders() {
      assert.fail("emitNewOrders should not be called");
    },
  });

  await assert.rejects(() => service.syncPickupOrders(), /network down/);
  assert.equal(failureMarked, true);
});

test("syncPickupOrders skips overlapping runs", async () => {
  let releaseFetch: (() => void) | null = null;
  const service = createPickupOrderSyncService({
    async fetchPage() {
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      return { items: [], nextCursor: null, hasMore: false };
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess() {},
    async markFailure() {},
    emitNewOrders() {},
  });

  const first = service.syncPickupOrders();
  const second = await service.syncPickupOrders();
  assert.equal(second.pulled, 0);
  assert.equal(second.inserted, 0);
  releaseFetch?.();
  await first;
});
```

- [ ] **Step 2: Run sync service test and confirm it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.sync.service.test.js
```

Expected: TypeScript build fails because `pickup-order.sync.service` does not exist.

- [ ] **Step 3: Implement sync service**

Create `src/v1/pickup-order/pickup-order.sync.service.ts`:

```ts
import { getIO } from "../../libs/socket";
import { fetchCrmPickupOrderSyncPage } from "./pickup-order.crm";
import {
  findExistingPickupOrderIds,
  getPickupOrderSyncState,
  markPickupOrderSyncFailure,
  markPickupOrderSyncSuccess,
  upsertPickupOrderPage,
} from "./pickup-order.repository";
import type {
  CrmPickupOrderWire,
  PickupOrderSyncOutcome,
  PickupOrderSyncPage,
} from "./pickup-order.types";

const SYNC_LIMIT = 200;
const CURSOR_OVERLAP_MS = 5000;

type SyncStateSnapshot = {
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
};

type PickupOrderSyncDependencies = {
  fetchPage(input: {
    updatedAfter?: Date;
    afterId?: number;
    limit: number;
  }): Promise<PickupOrderSyncPage>;
  getState(): Promise<SyncStateSnapshot>;
  findExistingIds(ids: number[]): Promise<Set<number>>;
  upsertPage(items: CrmPickupOrderWire[]): Promise<void>;
  markSuccess(input: {
    cursorUpdatedAt: Date | null;
    cursorOrderId: number | null;
  }): Promise<unknown>;
  markFailure(error: unknown): Promise<unknown>;
  emitNewOrders(payload: {
    count: number;
    orderIds: number[];
    latestPickupStartsAt: string | null;
  }): void;
};

export function subtractCursorOverlap(value: Date): Date {
  return new Date(Math.max(0, value.getTime() - CURSOR_OVERLAP_MS));
}

function latestPickupStartsAt(items: CrmPickupOrderWire[]): string | null {
  return items
    .map((item) => item.pickupStartsAt)
    .sort()
    .at(-1) ?? null;
}

function defaultEmitNewOrders(payload: {
  count: number;
  orderIds: number[];
  latestPickupStartsAt: string | null;
}) {
  getIO().emit("pickup-order:new", payload);
}

export function createPickupOrderSyncService(
  deps: PickupOrderSyncDependencies,
) {
  let running = false;

  async function syncPickupOrders(): Promise<PickupOrderSyncOutcome> {
    if (running) {
      return {
        pulled: 0,
        inserted: 0,
        updated: 0,
        emittedNewOrderCount: 0,
        cursorUpdatedAt: null,
        cursorOrderId: null,
      };
    }

    running = true;
    let pulled = 0;
    let inserted = 0;
    let cursorUpdatedAt: Date | null = null;
    let cursorOrderId: number | null = null;

    try {
      const state = await deps.getState();
      cursorUpdatedAt = state.cursorUpdatedAt;
      cursorOrderId = state.cursorOrderId;

      let hasMore = true;
      while (hasMore) {
        const page = await deps.fetchPage({
          ...(cursorUpdatedAt
            ? { updatedAfter: subtractCursorOverlap(cursorUpdatedAt) }
            : {}),
          ...(cursorOrderId ? { afterId: cursorOrderId } : {}),
          limit: SYNC_LIMIT,
        });

        if (page.items.length === 0) {
          hasMore = false;
          break;
        }

        const incomingIds = page.items.map((item) => item.id);
        const existingIds = await deps.findExistingIds(incomingIds);
        const newItems = page.items.filter((item) => !existingIds.has(item.id));

        await deps.upsertPage(page.items);

        pulled += page.items.length;
        inserted += newItems.length;
        if (newItems.length > 0) {
          deps.emitNewOrders({
            count: newItems.length,
            orderIds: newItems.map((item) => item.id),
            latestPickupStartsAt: latestPickupStartsAt(newItems),
          });
        }

        if (page.nextCursor) {
          cursorUpdatedAt = new Date(page.nextCursor.updatedAt);
          cursorOrderId = page.nextCursor.orderId;
          await deps.markSuccess({ cursorUpdatedAt, cursorOrderId });
        }

        hasMore = page.hasMore;
      }

      if (pulled === 0) {
        await deps.markSuccess({ cursorUpdatedAt, cursorOrderId });
      }

      return {
        pulled,
        inserted,
        updated: pulled - inserted,
        emittedNewOrderCount: inserted,
        cursorUpdatedAt,
        cursorOrderId,
      };
    } catch (error) {
      await deps.markFailure(error);
      throw error;
    } finally {
      running = false;
    }
  }

  return { syncPickupOrders };
}

export const pickupOrderSyncService = createPickupOrderSyncService({
  fetchPage: fetchCrmPickupOrderSyncPage,
  getState: getPickupOrderSyncState,
  findExistingIds: findExistingPickupOrderIds,
  upsertPage: upsertPickupOrderPage,
  markSuccess: markPickupOrderSyncSuccess,
  markFailure: markPickupOrderSyncFailure,
  emitNewOrders: defaultEmitNewOrders,
});

export function triggerSyncPickupOrders() {
  pickupOrderSyncService.syncPickupOrders().catch((error) => {
    console.error("[pickup-order.sync] sync failed:", error);
  });
}
```

- [ ] **Step 4: Run sync service tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.sync.service.test.js
```

Expected: all sync service tests pass.

- [ ] **Step 5: Review checkpoint**

Review:

```bash
git diff -- src/v1/pickup-order/pickup-order.sync.service.ts src/v1/pickup-order/pickup-order.sync.service.test.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 7: POS Local API Routes

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/router.ts`

- [ ] **Step 1: Implement local controller**

Create `src/v1/pickup-order/pickup-order.controller.ts`:

```ts
import { Request, Response } from "express";
import { parseIntId } from "../../libs/query";
import {
  getCachedPickupOrderByCrmId,
  listCachedPickupOrders,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";
import { pickupOrderSyncService } from "./pickup-order.sync.service";

export async function listPickupOrdersController(req: Request, res: Response) {
  const query = parsePickupOrderListQuery(req.query as Record<string, unknown>);
  const result = await listCachedPickupOrders(query);
  res.status(200).json(result);
}

export async function getPickupOrderByIdController(req: Request, res: Response) {
  const crmOrderId = parseIntId(req, "id");
  const result = await getCachedPickupOrderByCrmId(crmOrderId);
  res.status(200).json(result);
}

export async function syncPickupOrdersController(_req: Request, res: Response) {
  const result = await pickupOrderSyncService.syncPickupOrders();
  res.status(200).json({
    ok: true,
    msg: "Pickup order sync completed",
    result,
    paging: null,
  });
}
```

- [ ] **Step 2: Implement local router**

Create `src/v1/pickup-order/pickup-order.router.ts`:

```ts
import { Router } from "express";
import {
  getPickupOrderByIdController,
  listPickupOrdersController,
  syncPickupOrdersController,
} from "./pickup-order.controller";

const pickupOrderRouter = Router();

pickupOrderRouter.get("/", listPickupOrdersController);
pickupOrderRouter.post("/sync", syncPickupOrdersController);
pickupOrderRouter.get("/:id", getPickupOrderByIdController);

export default pickupOrderRouter;
```

- [ ] **Step 3: Mount route in POS router**

Modify `src/router.ts`:

```ts
import { Router } from "express";
import cloudRouter from "./v1/cloud/cloud.router";
import terminalRouter from "./v1/terminal/terminal.router";
import itemRouter from "./v1/item/item.router";
import hotkeyRouter from "./v1/hotkey/hotkey.router";
import crmRouter from "./v1/crm/crm.router";
import userRouter from "./v1/user/user.router";
import shiftRouter from "./v1/shift/shift.router";
import printerRouter from "./v1/printer/printer.router";
import cashIORouter from "./v1/cashio/cashio.router";
import storeRouter from "./v1/store/store.router";
import brandRouter from "./v1/brand/brand.router";
import voucherRouter from "./v1/voucher/voucher.router";
import customerVoucherRouter from "./v1/customer-voucher/customer-voucher.router";
import saleRouter from "./v1/sale/sale.router";
import pickupOrderRouter from "./v1/pickup-order/pickup-order.router";

const router = Router();

router.use("/cloud", cloudRouter);
router.use("/terminal", terminalRouter);
router.use("/shift", shiftRouter);
router.use("/item", itemRouter);
router.use("/brand", brandRouter);
router.use("/hotkey", hotkeyRouter);
router.use("/crm", crmRouter);
router.use("/user", userRouter);
router.use("/printer", printerRouter);
router.use("/cashio", cashIORouter);
router.use("/store", storeRouter);
router.use("/voucher", voucherRouter);
router.use("/customer-voucher", customerVoucherRouter);
router.use("/sale", saleRouter);
router.use("/pickup-order", pickupOrderRouter);
export default router;
```

- [ ] **Step 4: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build passes.

- [ ] **Step 5: Review checkpoint**

Review:

```bash
git diff -- src/v1/pickup-order/pickup-order.controller.ts src/v1/pickup-order/pickup-order.router.ts src/router.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 8: POS `CRON_INSTANCE` Gated Worker Startup

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.worker.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/index.ts`

- [ ] **Step 1: Implement worker module**

Create `src/v1/pickup-order/pickup-order.worker.ts`:

```ts
import { triggerSyncPickupOrders } from "./pickup-order.sync.service";

const PICKUP_ORDER_SYNC_INTERVAL_MS = 60_000;

let interval: NodeJS.Timeout | null = null;

export function shouldStartPickupOrderWorker(env = process.env): boolean {
  return env.CRON_INSTANCE === "true";
}

export function startPickupOrderSyncWorker(env = process.env) {
  if (!shouldStartPickupOrderWorker(env)) {
    console.log("[pickup-order.worker] disabled: CRON_INSTANCE is not true");
    return { started: false };
  }

  if (interval) {
    return { started: true };
  }

  console.log("[pickup-order.worker] starting 60s pickup order sync");
  triggerSyncPickupOrders();
  interval = setInterval(() => {
    triggerSyncPickupOrders();
  }, PICKUP_ORDER_SYNC_INTERVAL_MS);

  return { started: true };
}

export function stopPickupOrderSyncWorkerForTest() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
```

- [ ] **Step 2: Add worker startup to server boot**

Modify `src/index.ts`:

```ts
import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { setIO } from "./libs/socket";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "./v1/cloud/cloud.sync.service";
import { startPickupOrderSyncWorker } from "./v1/pickup-order/pickup-order.worker";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 3000;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

setIO(io);

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);

  triggerSyncAllSaleInvoices();
  triggerSyncAllShifts();
  startPickupOrderSyncWorker();
});
```

- [ ] **Step 3: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build passes.

- [ ] **Step 4: Review checkpoint**

Review:

```bash
git diff -- src/v1/pickup-order/pickup-order.worker.ts src/index.ts
```

Do not stage or commit unless the user explicitly requests it.

---

## Task 9: Final Verification

**Files:**
- Verify all changed CRM and POS files.

- [ ] **Step 1: Check CRM working tree**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git status --short
```

Expected: only intended pickup-order sync files and the pre-existing pickup-order migration work appear.

- [ ] **Step 2: Run CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: all tests pass. Record any pre-existing unrelated failures with exact test names.

- [ ] **Step 3: Check POS working tree**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git status --short
```

Expected: intended POS pickup-order files plus the pre-existing `D retail_pos_server/src/libs/crm.api.ts` deletion if it is still present.

- [ ] **Step 4: Generate POS Prisma client**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npx prisma generate
```

Expected: Prisma generation succeeds.

- [ ] **Step 5: Run POS build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: build passes.

- [ ] **Step 6: Run POS targeted tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
node --test dist/v1/pickup-order/pickup-order.query.test.js dist/v1/pickup-order/pickup-order.sync.service.test.js
```

Expected: both targeted pickup-order tests pass.

- [ ] **Step 7: Final diff review**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git diff -- docs/superpowers/specs/2026-07-07-pickup-order-sync-design.md docs/superpowers/plans/2026-07-07-pickup-order-sync-implementation.md retail_pos_server/prisma/schema.prisma retail_pos_server/src retail_pos_server/prisma/migrations
```

Then run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git diff -- src/device/pickup-order src/router/device.router.ts src/libs/pickupOrder.deviceSync.test.ts
```

Expected: diffs match the approved design and exclude label printing, print history, and status mutation UI.

---

## Self-Review

Spec coverage:

- CRM device sync endpoint: Task 1 and Task 2.
- POS local cache schema: Task 3.
- POS CRM client: Task 4.
- POS local repository and APIs: Task 5 and Task 7.
- Incremental cursor worker: Task 6 and Task 8.
- `CRON_INSTANCE=true` gate: Task 8.
- Socket.IO new order event: Task 6.
- Excluded print/status slices: Scope and Task 9 diff review.

Placeholder scan:

- No unfinished markers, incomplete file names, or unbound function names are intentionally present.

Type consistency:

- CRM DTO names use `PickupOrderSync*`.
- POS DTO names use `CrmPickupOrder*` for wire payloads and `PickupOrder*` for local sync outcomes.
- Cursor names are consistently `cursorUpdatedAt`, `cursorOrderId`, `updatedAfter`, and `afterId`.
