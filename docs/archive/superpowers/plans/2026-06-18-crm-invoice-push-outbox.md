# CRM Invoice Push Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CRM member point application durable and retryable after retail invoice sync succeeds.

**Architecture:** Data-server stores a CRM invoice push outbox row in the same transaction that creates a member invoice with point effects. A lightweight in-process data-server worker retries pending rows against CRM `/push`; CRM remains the owner of `Member.points` and ledger idempotency, and returns structured processing results for observability.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7 generated clients, PostgreSQL, Node test runner, axios/fetch service clients.

---

## Context

Specification: `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-06-18-crm-invoice-push-outbox-design.md`

Repos changed by this plan:

- `/Users/dev/ktpv5/ktpv5-data-server`
- `/Users/dev/ktpv5/ktpv5-crm-server`

Migration rule:

- Codex may update Prisma schema files and run Prisma generate.
- The user owns migration creation, migration deployment, and migration execution.
- Do not run `prisma migrate`, `prisma db push`, or migration deploy commands.

## File Structure

Data-server:

- Modify `/Users/dev/ktpv5/ktpv5-data-server/prisma/schema.prisma`
  Add `CrmInvoicePushOutbox`.
- Create `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`
  Own enqueue decision, enqueue write, retry math, batch processing, and reconciliation helper.
- Create `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.worker.ts`
  Own in-process polling loop lifecycle.
- Modify `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/invoice.service.ts`
  Enqueue outbox rows in the invoice create transaction and remove fire-and-forget CRM push from the sync path.
- Modify `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmClient.ts`
  Return CRM response data from invoice push calls and preserve signed request behavior.
- Modify `/Users/dev/ktpv5/ktpv5-data-server/src/server.ts`
  Start the outbox worker after the HTTP server starts.
- Create `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`
  Node test runner coverage for pure decision logic and worker state transitions through mocks.

CRM:

- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/memberPoint.service.ts`
  Keep idempotent ledger behavior and expose typed result objects.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/push.controller.ts`
  Return `{ ok: true, result }` for invoice push processing.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePush.ts`
  Add invoice push result types and a response presenter for controller/test clarity.
- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePushResult.test.ts`
  Node test runner coverage for the response presenter result shape.

## Task 1: Data-server Schema

**Files:**

- Modify: `/Users/dev/ktpv5/ktpv5-data-server/prisma/schema.prisma`

- [ ] **Step 1: Add the outbox model to the schema**

Append this model near the retail invoice models:

```prisma
model CrmInvoicePushOutbox {
  id             Int       @id @default(autoincrement())
  invoiceId      Int
  companyId      Int
  memberId       String
  serial         String
  pointsEarned   Int       @default(0)
  pointsReversed Int       @default(0)

  status         String    @default("PENDING")
  attempts       Int       @default(0)
  nextRetryAt    DateTime  @default(now())
  lastError      String?
  sentAt         DateTime?

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  invoice RetailSaleInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@unique([invoiceId])
  @@index([status, nextRetryAt])
  @@index([companyId, memberId])
}
```

Also add this back-reference inside `model RetailSaleInvoice`:

```prisma
  crmPushOutbox CrmInvoicePushOutbox?
```

- [ ] **Step 2: Run Prisma generate only**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npx prisma generate
```

Expected: Prisma client generation succeeds. Do not run migration commands.

- [ ] **Step 3: Commit schema and generated client**

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git status --short
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat(data): add crm invoice push outbox schema"
```

## Task 2: Data-server Outbox Service Tests

**Files:**

- Create: `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`

- [ ] **Step 1: Write failing tests for enqueue decisions and retry math**

Create `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCrmInvoicePushRetry,
  shouldEnqueueCrmInvoicePush,
} from "../retail/invoice/crmInvoicePushOutbox.service";

test("shouldEnqueueCrmInvoicePush requires member and positive point effect", () => {
  assert.equal(
    shouldEnqueueCrmInvoicePush({
      memberId: "member-1",
      pointsEarned: 12,
      pointsReversed: 0,
    }),
    true,
  );
  assert.equal(
    shouldEnqueueCrmInvoicePush({
      memberId: "member-1",
      pointsEarned: 0,
      pointsReversed: 8,
    }),
    true,
  );
  assert.equal(
    shouldEnqueueCrmInvoicePush({
      memberId: null,
      pointsEarned: 12,
      pointsReversed: 0,
    }),
    false,
  );
  assert.equal(
    shouldEnqueueCrmInvoicePush({
      memberId: "member-1",
      pointsEarned: 0,
      pointsReversed: 0,
    }),
    false,
  );
});

test("computeCrmInvoicePushRetry schedules exponential backoff and final failure", () => {
  const now = new Date("2026-06-18T00:00:00.000Z");

  assert.deepEqual(computeCrmInvoicePushRetry({ attempts: 0, now }), {
    attempts: 1,
    status: "RETRYING",
    nextRetryAt: new Date("2026-06-18T00:01:00.000Z"),
  });

  assert.deepEqual(computeCrmInvoicePushRetry({ attempts: 4, now }), {
    attempts: 5,
    status: "RETRYING",
    nextRetryAt: new Date("2026-06-18T00:16:00.000Z"),
  });

  assert.deepEqual(computeCrmInvoicePushRetry({ attempts: 9, now }), {
    attempts: 10,
    status: "FAILED",
    nextRetryAt: null,
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm run build
node --test dist/libs/crmInvoicePushOutbox.test.js
```

Expected: build fails because `crmInvoicePushOutbox.service` does not exist.

- [ ] **Step 3: Create the minimal service exports**

Create `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`:

```ts
export const CRM_INVOICE_PUSH_OUTBOX_STATUSES = {
  PENDING: "PENDING",
  RETRYING: "RETRYING",
  SENT: "SENT",
  FAILED: "FAILED",
} as const;

export type CrmInvoicePushOutboxStatus =
  (typeof CRM_INVOICE_PUSH_OUTBOX_STATUSES)[keyof typeof CRM_INVOICE_PUSH_OUTBOX_STATUSES];

export const CRM_INVOICE_PUSH_MAX_ATTEMPTS = 10;

interface PointEffectInput {
  memberId: string | null;
  pointsEarned?: number | null;
  pointsReversed?: number | null;
}

export function shouldEnqueueCrmInvoicePush(input: PointEffectInput): boolean {
  if (!input.memberId) return false;
  return (input.pointsEarned ?? 0) > 0 || (input.pointsReversed ?? 0) > 0;
}

export function computeCrmInvoicePushRetry({
  attempts,
  now,
}: {
  attempts: number;
  now: Date;
}): {
  attempts: number;
  status: "RETRYING" | "FAILED";
  nextRetryAt: Date | null;
} {
  const nextAttempts = attempts + 1;
  if (nextAttempts >= CRM_INVOICE_PUSH_MAX_ATTEMPTS) {
    return {
      attempts: nextAttempts,
      status: CRM_INVOICE_PUSH_OUTBOX_STATUSES.FAILED,
      nextRetryAt: null,
    };
  }

  const delayMinutes = Math.min(60, 2 ** Math.max(0, nextAttempts - 1));
  return {
    attempts: nextAttempts,
    status: CRM_INVOICE_PUSH_OUTBOX_STATUSES.RETRYING,
    nextRetryAt: new Date(now.getTime() + delayMinutes * 60_000),
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm run build
node --test dist/libs/crmInvoicePushOutbox.test.js
```

Expected: the new test passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git add src/libs/crmInvoicePushOutbox.test.ts src/retail/invoice/crmInvoicePushOutbox.service.ts
git commit -m "test(data): cover crm invoice push outbox decisions"
```

## Task 3: Data-server Enqueue Logic

**Files:**

- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/invoice.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`

- [ ] **Step 1: Add failing test for create-time enqueue behavior**

Append to `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`:

```ts
import { enqueueCrmInvoicePushForCreatedInvoice } from "../retail/invoice/crmInvoicePushOutbox.service";

test("enqueueCrmInvoicePushForCreatedInvoice creates one outbox row for a point invoice", async () => {
  const createCalls: unknown[] = [];
  const tx = {
    crmInvoicePushOutbox: {
      async create(args: unknown) {
        createCalls.push(args);
        return { id: 1 };
      },
    },
  };

  await enqueueCrmInvoicePushForCreatedInvoice(tx, {
    id: 1042,
    companyId: 1,
    memberId: "member-1",
    serial: "1-20260618-S000123",
    pointsEarned: 74,
    pointsReversed: 0,
  });

  assert.deepEqual(createCalls, [
    {
      data: {
        invoiceId: 1042,
        companyId: 1,
        memberId: "member-1",
        serial: "1-20260618-S000123",
        pointsEarned: 74,
        pointsReversed: 0,
      },
    },
  ]);
});

test("enqueueCrmInvoicePushForCreatedInvoice skips non-point invoices", async () => {
  const createCalls: unknown[] = [];
  const tx = {
    crmInvoicePushOutbox: {
      async create(args: unknown) {
        createCalls.push(args);
        return { id: 1 };
      },
    },
  };

  await enqueueCrmInvoicePushForCreatedInvoice(tx, {
    id: 1043,
    companyId: 1,
    memberId: "member-1",
    serial: "1-20260618-S000124",
    pointsEarned: 0,
    pointsReversed: 0,
  });

  assert.deepEqual(createCalls, []);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm run build
node --test dist/libs/crmInvoicePushOutbox.test.js
```

Expected: build fails because `enqueueCrmInvoicePushForCreatedInvoice` is missing.

- [ ] **Step 3: Implement enqueue helper**

Add to `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`:

```ts
interface CrmInvoicePushOutboxCreateClient {
  crmInvoicePushOutbox: {
    create(args: {
      data: {
        invoiceId: number;
        companyId: number;
        memberId: string;
        serial: string;
        pointsEarned: number;
        pointsReversed: number;
      };
    }): Promise<unknown>;
  };
}

interface CreatedInvoicePointSnapshot {
  id: number;
  companyId: number;
  memberId: string | null;
  serial: string;
  pointsEarned?: number | null;
  pointsReversed?: number | null;
}

export async function enqueueCrmInvoicePushForCreatedInvoice(
  tx: CrmInvoicePushOutboxCreateClient,
  invoice: CreatedInvoicePointSnapshot,
) {
  if (!shouldEnqueueCrmInvoicePush(invoice)) return;

  await tx.crmInvoicePushOutbox.create({
    data: {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      memberId: invoice.memberId,
      serial: invoice.serial,
      pointsEarned: invoice.pointsEarned ?? 0,
      pointsReversed: invoice.pointsReversed ?? 0,
    },
  });
}
```

- [ ] **Step 4: Wire enqueue into invoice creation transaction**

Modify `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/invoice.service.ts`.

Add import:

```ts
import { enqueueCrmInvoicePushForCreatedInvoice } from "./crmInvoicePushOutbox.service";
```

Inside the transaction, after `created` is available and before returning:

```ts
      await enqueueCrmInvoicePushForCreatedInvoice(tx, {
        id: created.id,
        companyId,
        memberId: rest.memberId,
        serial: rest.serial,
        pointsEarned: rest.pointsEarned ?? 0,
        pointsReversed: rest.pointsReversed ?? 0,
      });
      return created.id;
```

Remove the post-transaction fire-and-forget block:

```ts
    if (invoice.memberId) {
      sendInvoicePushSignal({
        memberId: invoice.memberId,
        companyId,
        invoiceId: result,
        serial: invoice.serial,
        pointsEarned: invoice.pointsEarned ?? 0,
        pointsReversed: invoice.pointsReversed ?? 0,
      }).catch(() => {});
    }
```

Also remove the unused `sendInvoicePushSignal` import from this file.

- [ ] **Step 5: Run data-server build and tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm test
```

Expected: build succeeds and all `dist/libs/*.test.js` tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git add src/retail/invoice/invoice.service.ts src/retail/invoice/crmInvoicePushOutbox.service.ts src/libs/crmInvoicePushOutbox.test.ts
git commit -m "feat(data): enqueue crm invoice push outbox rows"
```

## Task 4: Data-server Worker Processing

**Files:**

- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.worker.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmClient.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/server.ts`

- [ ] **Step 1: Add failing worker transition tests**

Append to `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`:

```ts
import { processDueCrmInvoicePushOutboxRows } from "../retail/invoice/crmInvoicePushOutbox.service";

test("processDueCrmInvoicePushOutboxRows marks successful rows as sent", async () => {
  const updates: unknown[] = [];
  const db = {
    crmInvoicePushOutbox: {
      async findMany() {
        return [
          {
            id: 1,
            invoiceId: 1042,
            companyId: 1,
            memberId: "member-1",
            serial: "1-20260618-S000123",
            pointsEarned: 74,
            pointsReversed: 0,
            attempts: 0,
          },
        ];
      },
      async update(args: unknown) {
        updates.push(args);
        return {};
      },
    },
  };

  const pushed: unknown[] = [];
  const result = await processDueCrmInvoicePushOutboxRows({
    db,
    now: new Date("2026-06-18T00:00:00.000Z"),
    pushToCrm: async (payload) => {
      pushed.push(payload);
      return { ok: true, result: { earn: { created: true } } };
    },
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(pushed, [
    {
      companyId: 1,
      memberId: "member-1",
      invoiceId: 1042,
      serial: "1-20260618-S000123",
      pointsEarned: 74,
      pointsReversed: 0,
    },
  ]);
  assert.deepEqual(updates, [
    {
      where: { id: 1 },
      data: {
        status: "SENT",
        sentAt: new Date("2026-06-18T00:00:00.000Z"),
        lastError: null,
      },
    },
  ]);
});

test("processDueCrmInvoicePushOutboxRows schedules retry after crm failure", async () => {
  const updates: unknown[] = [];
  const db = {
    crmInvoicePushOutbox: {
      async findMany() {
        return [
          {
            id: 2,
            invoiceId: 1043,
            companyId: 1,
            memberId: "member-1",
            serial: "1-20260618-S000124",
            pointsEarned: 30,
            pointsReversed: 0,
            attempts: 0,
          },
        ];
      },
      async update(args: unknown) {
        updates.push(args);
        return {};
      },
    },
  };

  const result = await processDueCrmInvoicePushOutboxRows({
    db,
    now: new Date("2026-06-18T00:00:00.000Z"),
    pushToCrm: async () => {
      throw new Error("CRM unavailable");
    },
  });

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(updates, [
    {
      where: { id: 2 },
      data: {
        attempts: 1,
        status: "RETRYING",
        nextRetryAt: new Date("2026-06-18T00:01:00.000Z"),
        lastError: "CRM unavailable",
      },
    },
  ]);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm run build
node --test dist/libs/crmInvoicePushOutbox.test.js
```

Expected: build fails because `processDueCrmInvoicePushOutboxRows` is missing.

- [ ] **Step 3: Implement row processing**

Add to `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`:

```ts
interface DueOutboxRow {
  id: number;
  invoiceId: number;
  companyId: number;
  memberId: string;
  serial: string;
  pointsEarned: number;
  pointsReversed: number;
  attempts: number;
}

interface ProcessOutboxDbClient {
  crmInvoicePushOutbox: {
    findMany(args: unknown): Promise<DueOutboxRow[]>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface CrmInvoicePushPayload {
  companyId: number;
  memberId: string;
  invoiceId: number;
  serial: string;
  pointsEarned: number;
  pointsReversed: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function processDueCrmInvoicePushOutboxRows({
  db,
  now = new Date(),
  take = 25,
  pushToCrm,
}: {
  db: ProcessOutboxDbClient;
  now?: Date;
  take?: number;
  pushToCrm(payload: CrmInvoicePushPayload): Promise<unknown>;
}): Promise<{ picked: number; sent: number; failed: number }> {
  const rows = await db.crmInvoicePushOutbox.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      nextRetryAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take,
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await pushToCrm({
        companyId: row.companyId,
        memberId: row.memberId,
        invoiceId: row.invoiceId,
        serial: row.serial,
        pointsEarned: row.pointsEarned,
        pointsReversed: row.pointsReversed,
      });
      await db.crmInvoicePushOutbox.update({
        where: { id: row.id },
        data: {
          status: CRM_INVOICE_PUSH_OUTBOX_STATUSES.SENT,
          sentAt: now,
          lastError: null,
        },
      });
      sent++;
    } catch (error) {
      const retry = computeCrmInvoicePushRetry({
        attempts: row.attempts,
        now,
      });
      await db.crmInvoicePushOutbox.update({
        where: { id: row.id },
        data: {
          attempts: retry.attempts,
          status: retry.status,
          nextRetryAt: retry.nextRetryAt,
          lastError: errorMessage(error),
        },
      });
      failed++;
    }
  }

  return { picked: rows.length, sent, failed };
}
```

- [ ] **Step 4: Make CRM client return structured response**

Modify `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmClient.ts` so `postToCrm` returns response data:

```ts
async function postToCrm<T = unknown>(
  path: string,
  body: unknown,
  options: CrmRequestOptions = {},
): Promise<T | null> {
  try {
    const timestamp = Date.now().toString();
    const signature = createInternalSignature({
      body,
      timestamp,
      secret: process.env.CRM_PUSH_SECRET || "",
    });

    const response = await axios.post<T>(`${CRM_SERVER_URL}${path}`, body, {
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
        "x-ktp-timestamp": timestamp,
        "x-ktp-signature": signature,
      },
    });
    return response.data;
  } catch (e) {
    if (options.bestEffort) {
      console.log("postToCrm error", e);
      return null;
    }
    throw e;
  }
}
```

Update `sendInvoicePushSignal`:

```ts
export async function sendInvoicePushSignal(data: InvoicePushSignal) {
  return postToCrm("/push", buildInvoicePushSignalPayload(data), {
    bestEffort: false,
  });
}
```

- [ ] **Step 5: Create worker lifecycle file**

Create `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.worker.ts`:

```ts
import db from "../../libs/db";
import { sendInvoicePushSignal } from "../../libs/crmClient";
import { processDueCrmInvoicePushOutboxRows } from "./crmInvoicePushOutbox.service";

const DEFAULT_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runCrmInvoicePushOutboxOnce() {
  if (running) return { picked: 0, sent: 0, failed: 0 };
  running = true;
  try {
    const result = await processDueCrmInvoicePushOutboxRows({
      db,
      pushToCrm: sendInvoicePushSignal,
    });
    if (result.picked > 0) {
      console.log("[crm-outbox] processed", result);
    }
    return result;
  } finally {
    running = false;
  }
}

export function startCrmInvoicePushOutboxWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
) {
  if (timer) return;
  timer = setInterval(() => {
    runCrmInvoicePushOutboxOnce().catch((error) => {
      console.error("[crm-outbox] worker tick failed", error);
    });
  }, intervalMs);
  timer.unref?.();
  runCrmInvoicePushOutboxOnce().catch((error) => {
    console.error("[crm-outbox] initial run failed", error);
  });
}

export function stopCrmInvoicePushOutboxWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
```

- [ ] **Step 6: Start worker on data-server boot**

Modify `/Users/dev/ktpv5/ktpv5-data-server/src/server.ts`:

```ts
import "dotenv/config";
import app from "./app";
import { PORT } from "./libs/constant";
import { startCrmInvoicePushOutboxWorker } from "./retail/invoice/crmInvoicePushOutbox.worker";

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  startCrmInvoicePushOutboxWorker();
});
```

- [ ] **Step 7: Run data-server tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm test
```

Expected: build succeeds and all `dist/libs/*.test.js` tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git add src/retail/invoice/crmInvoicePushOutbox.service.ts src/retail/invoice/crmInvoicePushOutbox.worker.ts src/libs/crmClient.ts src/libs/crmInvoicePushOutbox.test.ts src/server.ts
git commit -m "feat(data): process crm invoice push outbox"
```

## Task 5: Data-server Reconciliation Helper

**Files:**

- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`

- [ ] **Step 1: Add failing reconciliation test**

Append to `/Users/dev/ktpv5/ktpv5-data-server/src/libs/crmInvoicePushOutbox.test.ts`:

```ts
import { enqueueMissingCrmInvoicePushOutboxRows } from "../retail/invoice/crmInvoicePushOutbox.service";

test("enqueueMissingCrmInvoicePushOutboxRows backfills point invoices without outbox rows", async () => {
  const created: unknown[] = [];
  const db = {
    retailSaleInvoice: {
      async findMany() {
        return [
          {
            id: 2001,
            companyId: 1,
            memberId: "member-1",
            serial: "1-20260618-S000222",
            pointsEarned: 20,
            pointsReversed: 0,
          },
        ];
      },
    },
    crmInvoicePushOutbox: {
      async create(args: unknown) {
        created.push(args);
        return { id: 5 };
      },
    },
  };

  const result = await enqueueMissingCrmInvoicePushOutboxRows({ db });

  assert.equal(result.enqueued, 1);
  assert.deepEqual(created, [
    {
      data: {
        invoiceId: 2001,
        companyId: 1,
        memberId: "member-1",
        serial: "1-20260618-S000222",
        pointsEarned: 20,
        pointsReversed: 0,
      },
    },
  ]);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm run build
node --test dist/libs/crmInvoicePushOutbox.test.js
```

Expected: build fails because `enqueueMissingCrmInvoicePushOutboxRows` is missing.

- [ ] **Step 3: Implement reconciliation helper**

Add to `/Users/dev/ktpv5/ktpv5-data-server/src/retail/invoice/crmInvoicePushOutbox.service.ts`:

```ts
interface ReconcileDbClient extends CrmInvoicePushOutboxCreateClient {
  retailSaleInvoice: {
    findMany(args: unknown): Promise<CreatedInvoicePointSnapshot[]>;
  };
}

export async function enqueueMissingCrmInvoicePushOutboxRows({
  db,
  take = 100,
}: {
  db: ReconcileDbClient;
  take?: number;
}): Promise<{ scanned: number; enqueued: number }> {
  const invoices = await db.retailSaleInvoice.findMany({
    where: {
      memberId: { not: null },
      OR: [{ pointsEarned: { gt: 0 } }, { pointsReversed: { gt: 0 } }],
      crmPushOutbox: null,
    },
    orderBy: { id: "asc" },
    take,
  });

  let enqueued = 0;
  for (const invoice of invoices) {
    await enqueueCrmInvoicePushForCreatedInvoice(db, invoice);
    enqueued++;
  }

  return { scanned: invoices.length, enqueued };
}
```

- [ ] **Step 4: Run data-server tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm test
```

Expected: build succeeds and all data-server tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git add src/retail/invoice/crmInvoicePushOutbox.service.ts src/libs/crmInvoicePushOutbox.test.ts
git commit -m "feat(data): add crm invoice push reconciliation helper"
```

## Task 6: CRM Structured Push Result

**Files:**

- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/memberPoint.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/push.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePush.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePushResult.test.ts`

- [ ] **Step 1: Add result presenter tests**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePushResult.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { buildInvoicePushResponseBody } from "./invoicePush";

test("buildInvoicePushResponseBody wraps earn and reversal result", () => {
  const result = buildInvoicePushResponseBody({
    earn: {
      created: true,
      pointsEarned: 74,
      balanceAfter: 4820,
    },
    reversal: {
      created: false,
      pointsReversed: 0,
    },
  });

  assert.deepEqual(result, {
    ok: true,
    result: {
      earn: {
        created: true,
        pointsEarned: 74,
        balanceAfter: 4820,
      },
      reversal: {
        created: false,
        pointsReversed: 0,
      },
    },
  });
});
```

- [ ] **Step 2: Run CRM test and verify it fails**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
node --test dist/libs/invoicePushResult.test.js
```

Expected: build fails because `buildInvoicePushResponseBody` is missing.

- [ ] **Step 3: Add typed response helper**

Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/invoicePush.ts`:

```ts
export interface InvoicePushPointResult {
  created: boolean;
  pointsEarned?: number;
  pointsReversed?: number;
  pointsDelta?: number;
  balanceAfter?: number;
}

export interface InvoicePushProcessingResult {
  earn: InvoicePushPointResult;
  reversal: InvoicePushPointResult;
}

export function buildInvoicePushResponseBody(
  result: InvoicePushProcessingResult,
) {
  return {
    ok: true,
    result,
  };
}
```

- [ ] **Step 4: Ensure service returns stable result shape**

Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/memberPoint.service.ts`.

Keep the existing processing logic, but make the function signature explicit:

```ts
import type { InvoicePushProcessingResult } from "../../libs/invoicePush";

export const processRetailSalePointEvent = async (
  input: RetailSalePointEventInput,
): Promise<InvoicePushProcessingResult> => {
  const earn = await processRetailSalePointEarn(input);
  const reversal = await processRetailSalePointReversal(input);
  return { earn, reversal };
};
```

The existing earn result should keep returning:

```ts
return {
  created: true,
  pointsEarned: input.pointsEarned,
  balanceAfter: updatedMember.points,
};
```

The existing duplicate path should keep returning:

```ts
return { created: false, pointsEarned: input.pointsEarned };
```

The existing reversal success path should keep returning:

```ts
return {
  created: true,
  pointsReversed: input.pointsReversed,
  pointsDelta,
  balanceAfter: row.after,
};
```

- [ ] **Step 5: Return structured controller response**

Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/api/push/push.controller.ts`.

Add import:

```ts
import { buildInvoicePushResponseBody } from "../../libs/invoicePush";
```

Change the point processing section:

```ts
  const pointResult = await processRetailSalePointEvent({
    companyId,
    memberId,
    invoiceId,
    serial,
    pointsEarned,
    pointsReversed,
  });
```

Keep notification sending after point processing:

```ts
  await sendInvoicePushNotification(
    companyId,
    invoiceId,
    memberId,
    pointsEarned,
  );
  res.status(200).json(buildInvoicePushResponseBody(pointResult));
```

- [ ] **Step 6: Run CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build succeeds and all `dist/libs/*.test.js` tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/api/push/memberPoint.service.ts src/api/push/push.controller.ts src/libs/invoicePush.ts src/libs/invoicePushResult.test.ts
git commit -m "feat(crm): return invoice push processing result"
```

## Task 7: Final Verification

**Files:**

- Verify only.

- [ ] **Step 1: Run data-server Prisma generate**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npx prisma generate
```

Expected: generation succeeds. Do not run migrations.

- [ ] **Step 2: Run data-server tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
npm test
```

Expected: build succeeds and all data-server tests pass.

- [ ] **Step 3: Run CRM tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build succeeds and all CRM tests pass.

- [ ] **Step 4: Check git status in both repos**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-data-server
git status --short
cd /Users/dev/ktpv5/ktpv5-crm-server
git status --short
```

Expected: only intentional files are changed, or all task commits have left the
working trees clean except for user-owned pre-existing changes.

## Self-Review

Spec coverage:

- Durable outbox table: Task 1.
- Enqueue in same transaction as invoice creation: Task 3.
- Remove fire-and-forget CRM push from invoice sync path: Task 3.
- In-process non-cron worker: Task 4.
- Retry state, attempts, backoff, sent and failed states: Task 4.
- Reconciliation helper: Task 5.
- CRM idempotent result clarity: Task 6.
- Prisma generate only and no migrations: Task 1 and Task 7.

Placeholder scan:

- No open placeholders or vague edge-case-only steps.
- Each code-changing step names exact files and includes concrete code.

Type consistency:

- Data-server service uses `CrmInvoicePushPayload` for worker-to-CRM calls.
- CRM response helper uses `InvoicePushProcessingResult`, matching the service return shape.
