# Customer Voucher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement CRM-owned Customer Voucher issue, redeem, redeem-void, and refund-issue flows for the retail POS.

**Architecture:** The POS renderer talks only to the local POS server. The local POS server proxies Customer Voucher requests to `ktpv5-crm-server` through the existing CRM device API key path. The CRM server owns customer voucher rows, customer voucher events, point deduction, idempotent redemption, idempotent redeem voiding, and refund voucher issuance.

**Tech Stack:** TypeScript, Express 5, Prisma 7 generated clients, PostgreSQL, React 19, Electron renderer SPA, existing POS axios singleton, existing POS/CRM device API authentication.

---

## First Read This

Read these files before editing:

- `/Users/dev/ktpv5/ktpv5-pos-retail/AGENTS.md`
- `/Users/dev/ktpv5/ktpv5-pos-retail/README.md`
- `/Users/dev/ktpv5/ktpv5-pos-retail/docs/CODEX_POS_RETAIL_CONTEXT.md`
- `/Users/dev/ktpv5/ktpv5-pos-retail/docs/sale-domain.md`
- `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-05-06-customer-voucher-design.md`
- `/Users/dev/ktpv5/ktpv5-crm-server/AGENTS.md`
- `/Users/dev/ktpv5/ktpv5-crm-server/README.md`

Check git status in both repos before editing:

```bash
git -C /Users/dev/ktpv5/ktpv5-pos-retail status --short
git -C /Users/dev/ktpv5/ktpv5-crm-server status --short
```

Current known POS repo dirty files at plan creation time:

- `retail_pos_app/src/renderer/src/libs/label-7090-v2/render.ts` was already modified.
- `docs/superpowers/plans/2026-05-06-voucher-first-payment-order.md` was already untracked.

Do not revert or overwrite unrelated user changes.

## Live CRM Database Safety

`ktpv5-crm-server` currently points at a live database. Treat CRM schema changes as production changes.

- Do not run `prisma db push` for CRM.
- Do not run destructive reset commands.
- Generate and inspect migration SQL before applying anything.
- Additive schema only: new enums, new tables, new indexes.
- Do not rewrite existing members or point balances except through explicit Customer Voucher issue transactions.
- Manual tests that mutate points/vouchers must use the intended test member account only.

## File Structure

### CRM Server: `/Users/dev/ktpv5/ktpv5-crm-server`

- Modify `prisma/schema.prisma`
  - Add Customer Voucher enums, `CustomerVoucher`, and `CustomerVoucherEvent`.
- Modify `src/libs/constants.ts`
  - Add Customer Voucher constants.
- Create `src/device/customer-voucher/customerVoucher.types.ts`
  - Request/response DTOs used by controller and service.
- Create `src/device/customer-voucher/customerVoucher.serial.ts`
  - Serial generation in `YYYY-XXXX-XXXX-XXXX` format.
- Create `src/device/customer-voucher/customerVoucher.service.ts`
  - CRM-owned transactional issue, valid list, redeem, void, and refund-issue logic.
- Create `src/device/customer-voucher/customerVoucher.controller.ts`
  - Express controllers with request validation and structured responses.
- Create `src/device/customer-voucher/customerVoucher.routes.ts`
  - Device routes.
- Modify `src/router/device.router.ts`
  - Mount `/device/customer-voucher`.

### POS Local Server: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server`

- Create `src/v1/customer-voucher/customer-voucher.types.ts`
  - Local proxy DTOs and CRM response types.
- Create `src/v1/customer-voucher/customer-voucher.service.ts`
  - Proxy to CRM through `crmApiService` plus helper functions for sale/refund services.
- Create `src/v1/customer-voucher/customer-voucher.controller.ts`
  - Local API controllers.
- Create `src/v1/customer-voucher/customer-voucher.router.ts`
  - Local routes with `userMiddleware` and `scopeMiddleware("sale")`.
- Modify `src/router.ts`
  - Mount `/api/customer-voucher`.
- Modify `src/v1/sale/sale.create.service.ts`
  - Redeem customer vouchers before local invoice creation; void them if local persistence fails.
- Modify `src/v1/sale/sale.refund.service.ts`
  - Replace the current customer-voucher refund block with CRM refund voucher issuance.
- Confirm `src/v1/sale/sale.repay.service.ts`
  - Customer-voucher invoices remain blocked from repay.

### POS Renderer: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app`

- Modify `src/renderer/src/libs/constants.ts`
  - Add Customer Voucher constants.
- Create `src/renderer/src/service/customer-voucher.service.ts`
  - Renderer service for local `/api/customer-voucher` routes.
- Create `src/renderer/src/screens/SaleScreen/PaymentModal/CustomerVoucherInput.tsx`
  - UserVoucherInput-style UX for valid voucher selection, issue, amount input, exact, and add.
- Create `src/renderer/src/screens/SaleScreen/PaymentModal/SearchCustomerVoucherModal.tsx`
  - Valid voucher list plus Issue button.
- Modify `src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - Wire Customer Voucher staged state.
- Modify refund UI only if it currently blocks customer-voucher refund before server call.
  - Likely files: `src/renderer/src/libs/refund/compute.ts`, `src/renderer/src/libs/refund/build-payload.ts`, and `src/renderer/src/screens/SaleRefundDetailScreen/index.tsx`.

---

### Task 1: Add CRM Schema And Constants

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/prisma/schema.prisma`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/constants.ts`

- [ ] **Step 1: Edit CRM Prisma schema**

Add these enums and models after `MemberPointLedger` and before `DeviceToken`:

```prisma
enum CustomerVoucherKind {
  POINT_EXCHANGE
  REFUND
}

enum CustomerVoucherStatus {
  ACTIVE
  EXPIRED
  ARCHIVED
}

enum CustomerVoucherEventType {
  ISSUE
  REDEEM
  VOID_REDEEM
  REFUND_ISSUE
  EXPIRE
  ADJUST
}

model CustomerVoucher {
  id                  Int                   @id @default(autoincrement())
  companyId           Int
  memberId            String
  serial              String                @unique
  kind                CustomerVoucherKind
  initAmount          Int
  balance             Int
  status              CustomerVoucherStatus @default(ACTIVE)
  validFrom           DateTime
  validTo             DateTime
  sourcePointLedgerId String?
  createdByDeviceId   Int?
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @default(now()) @updatedAt

  events CustomerVoucherEvent[]

  @@index([companyId, memberId, status, validTo])
  @@index([companyId, serial])
}

model CustomerVoucherEvent {
  id           Int                      @id @default(autoincrement())
  companyId    Int
  voucherId    Int
  voucher      CustomerVoucher          @relation(fields: [voucherId], references: [id], onDelete: Cascade)
  type         CustomerVoucherEventType
  amount       Int
  requestId    String?
  entityType   String?
  entityId     String?
  entitySerial String?
  note         String?
  createdAt    DateTime                 @default(now())
  updatedAt    DateTime                 @default(now()) @updatedAt

  @@unique([requestId])
  @@index([voucherId, type])
  @@index([companyId, entityType, entityId])
}
```

- [ ] **Step 2: Add CRM constants**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/constants.ts`, append:

```ts
export const CUSTOMER_VOUCHER_ISSUE_POINTS = 1000;
export const CUSTOMER_VOUCHER_ISSUE_AMOUNT = 1000;
export const CUSTOMER_VOUCHER_ISSUE_VALID_DAYS = 14;
export const CUSTOMER_VOUCHER_REFUND_VALID_DAYS = 7;
```

- [ ] **Step 3: Generate CRM Prisma client**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npx prisma generate
```

Expected: Prisma client regenerates into `src/generated/prisma` with no database mutation.

- [ ] **Step 4: Produce migration SQL for review**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > /tmp/customer-voucher-crm.sql
sed -n '1,240p' /tmp/customer-voucher-crm.sql
```

Expected: SQL contains only `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE ... ADD CONSTRAINT` for new Customer Voucher objects. Stop and ask before applying SQL to the live CRM database.

- [ ] **Step 5: Build CRM**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
```

Expected: `tsc` passes.

- [ ] **Step 6: Commit CRM schema/constants**

Commit only CRM schema/constants/generated client changes if generated files changed:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git status --short
git add prisma/schema.prisma src/libs/constants.ts src/generated/prisma
git commit -m "feat: add customer voucher schema"
```

Do not include `/tmp/customer-voucher-crm.sql`; it is an inspection artifact.

---

### Task 2: Implement CRM Customer Voucher Service

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.types.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.serial.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.service.ts`

- [ ] **Step 1: Create CRM voucher types**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.types.ts`:

```ts
export interface CustomerVoucherDto {
  id: number;
  companyId: number;
  memberId: string;
  serial: string;
  kind: "POINT_EXCHANGE" | "REFUND";
  initAmount: number;
  balance: number;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  validFrom: Date;
  validTo: Date;
  sourcePointLedgerId: string | null;
  createdByDeviceId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueCustomerVoucherInput {
  companyId: number;
  memberId: string;
  deviceId: number | null;
}

export interface RedeemCustomerVoucherInput {
  companyId: number;
  memberId: string;
  voucherId: number;
  amount: number;
  requestId: string;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  note?: string | null;
}

export interface VoidCustomerVoucherRedeemInput {
  companyId: number;
  redeemRequestId: string;
  requestId: string;
  note?: string | null;
}

export interface IssueCustomerVoucherRefundInput {
  companyId: number;
  memberId: string;
  amount: number;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  deviceId: number | null;
  note?: string | null;
}
```

- [ ] **Step 2: Create CRM serial generator**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.serial.ts`:

```ts
import { randomInt } from "node:crypto";

const SERIAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SERIAL_GROUP_LENGTH = 4;
const SERIAL_RANDOM_GROUPS = 3;

function randomGroup(): string {
  let out = "";
  for (let i = 0; i < SERIAL_GROUP_LENGTH; i += 1) {
    out += SERIAL_CHARS[randomInt(0, SERIAL_CHARS.length)];
  }
  return out;
}

export function generateCustomerVoucherSerial(now = new Date()): string {
  const year = String(now.getFullYear());
  const groups = Array.from({ length: SERIAL_RANDOM_GROUPS }, () =>
    randomGroup(),
  );
  return [year, ...groups].join("-");
}
```

- [ ] **Step 3: Create CRM voucher service**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.service.ts` with these exported functions:

```ts
import db from "../../libs/db";
import {
  CUSTOMER_VOUCHER_ISSUE_AMOUNT,
  CUSTOMER_VOUCHER_ISSUE_POINTS,
  CUSTOMER_VOUCHER_ISSUE_VALID_DAYS,
  CUSTOMER_VOUCHER_REFUND_VALID_DAYS,
} from "../../libs/constants";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import { generateCustomerVoucherSerial } from "./customerVoucher.serial";
import type {
  IssueCustomerVoucherInput,
  IssueCustomerVoucherRefundInput,
  RedeemCustomerVoucherInput,
  VoidCustomerVoucherRedeemInput,
} from "./customerVoucher.types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIAL_ATTEMPTS = 8;

function addDays(from: Date, days: number): Date {
  return new Date(from.valueOf() + days * DAY_MS);
}

function voucherLabel(serial: string, validTo: Date): string {
  return `${serial} - Exp ${validTo.toISOString().slice(0, 10)}`;
}

type CustomerVoucherLookupClient = {
  customerVoucher: {
    findUnique(args: {
      where: { serial: string };
      select: { id: true };
    }): Promise<{ id: number } | null>;
  };
};

async function createUniqueSerial(
  tx: CustomerVoucherLookupClient,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_SERIAL_ATTEMPTS; attempt += 1) {
    const serial = generateCustomerVoucherSerial();
    const existing = await tx.customerVoucher.findUnique({
      where: { serial },
      select: { id: true },
    });
    if (!existing) return serial;
  }
  throw new BadRequestException("Failed to generate unique voucher serial");
}

export async function getValidCustomerVouchers(
  companyId: number,
  memberId: string,
) {
  const now = new Date();
  const vouchers = await db.customerVoucher.findMany({
    where: {
      companyId,
      memberId,
      status: "ACTIVE",
      balance: { gt: 0 },
      validFrom: { lte: now },
      validTo: { gte: now },
    },
    orderBy: { validTo: "asc" },
  });
  return {
    ok: true,
    msg: "Customer vouchers loaded",
    result: vouchers.map((voucher) => ({
      ...voucher,
      label: voucherLabel(voucher.serial, voucher.validTo),
    })),
  };
}

export async function issueCustomerVoucher(input: IssueCustomerVoucherInput) {
  return db.$transaction(async (tx) => {
    const member = await tx.member.findFirst({
      where: {
        id: input.memberId,
        companyId: input.companyId,
        archived: false,
      },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.points < CUSTOMER_VOUCHER_ISSUE_POINTS) {
      throw new BadRequestException("Insufficient points");
    }

    const now = new Date();
    const serial = await createUniqueSerial(tx);
    const voucher = await tx.customerVoucher.create({
      data: {
        companyId: input.companyId,
        memberId: input.memberId,
        serial,
        kind: "POINT_EXCHANGE",
        initAmount: CUSTOMER_VOUCHER_ISSUE_AMOUNT,
        balance: CUSTOMER_VOUCHER_ISSUE_AMOUNT,
        validFrom: now,
        validTo: addDays(now, CUSTOMER_VOUCHER_ISSUE_VALID_DAYS),
        createdByDeviceId: input.deviceId,
      },
    });

    const ledger = await tx.memberPointLedger.create({
      data: {
        companyId: input.companyId,
        memberId: input.memberId,
        type: "REDEEM",
        pointsDelta: -CUSTOMER_VOUCHER_ISSUE_POINTS,
        balanceAfter: member.points - CUSTOMER_VOUCHER_ISSUE_POINTS,
        entityType: "customer-voucher",
        entityId: String(voucher.id),
        entitySerial: voucher.serial,
        note: "Customer voucher issue",
      },
    });

    const updatedVoucher = await tx.customerVoucher.update({
      where: { id: voucher.id },
      data: { sourcePointLedgerId: ledger.id },
    });

    const updatedMember = await tx.member.update({
      where: { id: input.memberId },
      data: { points: { decrement: CUSTOMER_VOUCHER_ISSUE_POINTS } },
      select: { points: true },
    });

    await tx.customerVoucherEvent.create({
      data: {
        companyId: input.companyId,
        voucherId: voucher.id,
        type: "ISSUE",
        amount: CUSTOMER_VOUCHER_ISSUE_AMOUNT,
        entityType: "customer-voucher",
        entityId: String(voucher.id),
        entitySerial: voucher.serial,
      },
    });

    return {
      ok: true,
      msg: "Customer voucher issued",
      result: {
        voucher: {
          ...updatedVoucher,
          label: voucherLabel(updatedVoucher.serial, updatedVoucher.validTo),
        },
        memberPoints: updatedMember.points,
      },
    };
  });
}

export async function redeemCustomerVoucher(input: RedeemCustomerVoucherInput) {
  if (input.amount <= 0) throw new BadRequestException("amount must be > 0");

  return db.$transaction(async (tx) => {
    const existing = await tx.customerVoucherEvent.findUnique({
      where: { requestId: input.requestId },
      include: { voucher: true },
    });
    if (existing) {
      return {
        ok: true,
        msg: "Customer voucher redeem already processed",
        result: {
          event: existing,
          voucher: {
            ...existing.voucher,
            label: voucherLabel(existing.voucher.serial, existing.voucher.validTo),
          },
        },
      };
    }

    const voucher = await tx.customerVoucher.findFirst({
      where: {
        id: input.voucherId,
        companyId: input.companyId,
        memberId: input.memberId,
      },
    });
    if (!voucher) throw new NotFoundException("Customer voucher not found");

    const now = new Date();
    if (voucher.status !== "ACTIVE")
      throw new BadRequestException("Customer voucher is not active");
    if (voucher.validFrom > now || voucher.validTo < now)
      throw new BadRequestException("Customer voucher is not valid");
    if (voucher.balance < input.amount)
      throw new BadRequestException("Customer voucher balance is insufficient");

    const updatedVoucher = await tx.customerVoucher.update({
      where: { id: voucher.id },
      data: { balance: { decrement: input.amount } },
    });
    const event = await tx.customerVoucherEvent.create({
      data: {
        companyId: input.companyId,
        voucherId: voucher.id,
        type: "REDEEM",
        amount: -input.amount,
        requestId: input.requestId,
        entityType: input.entityType,
        entityId: input.entityId,
        entitySerial: input.entitySerial ?? null,
        note: input.note ?? null,
      },
    });

    return {
      ok: true,
      msg: "Customer voucher redeemed",
      result: {
        event,
        voucher: {
          ...updatedVoucher,
          label: voucherLabel(updatedVoucher.serial, updatedVoucher.validTo),
        },
      },
    };
  });
}

export async function voidCustomerVoucherRedeem(
  input: VoidCustomerVoucherRedeemInput,
) {
  return db.$transaction(async (tx) => {
    const existingVoid = await tx.customerVoucherEvent.findUnique({
      where: { requestId: input.requestId },
      include: { voucher: true },
    });
    if (existingVoid) {
      return { ok: true, msg: "Customer voucher void already processed", result: existingVoid };
    }

    const redeem = await tx.customerVoucherEvent.findUnique({
      where: { requestId: input.redeemRequestId },
      include: { voucher: true },
    });
    if (!redeem || redeem.type !== "REDEEM") {
      throw new NotFoundException("Original redeem event not found");
    }
    if (redeem.companyId !== input.companyId) {
      throw new BadRequestException("Redeem event company mismatch");
    }

    const priorVoid = await tx.customerVoucherEvent.findFirst({
      where: {
        type: "VOID_REDEEM",
        entityType: "customer-voucher-redeem",
        entityId: input.redeemRequestId,
      },
    });
    if (priorVoid) {
      return { ok: true, msg: "Customer voucher redeem already voided", result: priorVoid };
    }

    const amount = Math.abs(redeem.amount);
    const updatedVoucher = await tx.customerVoucher.update({
      where: { id: redeem.voucherId },
      data: { balance: { increment: amount } },
    });
    const event = await tx.customerVoucherEvent.create({
      data: {
        companyId: input.companyId,
        voucherId: redeem.voucherId,
        type: "VOID_REDEEM",
        amount,
        requestId: input.requestId,
        entityType: "customer-voucher-redeem",
        entityId: input.redeemRequestId,
        entitySerial: redeem.entitySerial,
        note: input.note ?? null,
      },
    });

    return {
      ok: true,
      msg: "Customer voucher redeem voided",
      result: {
        event,
        voucher: {
          ...updatedVoucher,
          label: voucherLabel(updatedVoucher.serial, updatedVoucher.validTo),
        },
      },
    };
  });
}

export async function issueRefundCustomerVoucher(
  input: IssueCustomerVoucherRefundInput,
) {
  if (input.amount <= 0) throw new BadRequestException("amount must be > 0");

  return db.$transaction(async (tx) => {
    const member = await tx.member.findFirst({
      where: {
        id: input.memberId,
        companyId: input.companyId,
        archived: false,
      },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("Member not found");

    const now = new Date();
    const serial = await createUniqueSerial(tx);
    const voucher = await tx.customerVoucher.create({
      data: {
        companyId: input.companyId,
        memberId: input.memberId,
        serial,
        kind: "REFUND",
        initAmount: input.amount,
        balance: input.amount,
        validFrom: now,
        validTo: addDays(now, CUSTOMER_VOUCHER_REFUND_VALID_DAYS),
        createdByDeviceId: input.deviceId,
      },
    });
    await tx.customerVoucherEvent.create({
      data: {
        companyId: input.companyId,
        voucherId: voucher.id,
        type: "REFUND_ISSUE",
        amount: input.amount,
        entityType: input.entityType,
        entityId: input.entityId,
        entitySerial: input.entitySerial ?? null,
        note: input.note ?? null,
      },
    });

    return {
      ok: true,
      msg: "Refund customer voucher issued",
      result: {
        voucher: {
          ...voucher,
          label: voucherLabel(voucher.serial, voucher.validTo),
        },
      },
    };
  });
}
```

- [ ] **Step 4: Build CRM**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
```

Expected: type errors identify import paths or generated client names that need mechanical correction. Fix only compile errors in files touched by this task.

- [ ] **Step 5: Commit CRM service**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/device/customer-voucher
git commit -m "feat: add customer voucher service"
```

---

### Task 3: Add CRM Customer Voucher Device Routes

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.controller.ts`
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.routes.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/router/device.router.ts`

- [ ] **Step 1: Create CRM controller**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.controller.ts`:

```ts
import { Request, Response } from "express";
import {
  getValidCustomerVouchers,
  issueCustomerVoucher,
  issueRefundCustomerVoucher,
  redeemCustomerVoucher,
  voidCustomerVoucherRedeem,
} from "./customerVoucher.service";

function companyIdFrom(res: Response): number {
  return Number(res.locals.companyId);
}

function deviceIdFrom(res: Response): number | null {
  const raw = res.locals.device?.id;
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}

export async function getValidCustomerVouchersController(
  req: Request,
  res: Response,
) {
  const memberId = String(req.query.memberId || "");
  if (!memberId) {
    res.status(400).json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  const result = await getValidCustomerVouchers(companyIdFrom(res), memberId);
  res.json(result);
}

export async function issueCustomerVoucherController(
  req: Request,
  res: Response,
) {
  const memberId = String(req.body?.memberId || "");
  if (!memberId) {
    res.status(400).json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  const result = await issueCustomerVoucher({
    companyId: companyIdFrom(res),
    memberId,
    deviceId: deviceIdFrom(res),
  });
  res.json(result);
}

export async function redeemCustomerVoucherController(
  req: Request,
  res: Response,
) {
  const voucherId = Number(req.body?.voucherId);
  const amount = Number(req.body?.amount);
  const memberId = String(req.body?.memberId || "");
  const requestId = String(req.body?.requestId || "");
  const entityType = String(req.body?.entityType || "");
  const entityId = String(req.body?.entityId || "");
  if (!memberId || !requestId || !entityType || !entityId) {
    res.status(400).json({ ok: false, msg: "redeem metadata is required", result: null });
    return;
  }
  if (!Number.isFinite(voucherId) || !Number.isFinite(amount)) {
    res.status(400).json({ ok: false, msg: "voucherId and amount are required", result: null });
    return;
  }
  const result = await redeemCustomerVoucher({
    companyId: companyIdFrom(res),
    memberId,
    voucherId,
    amount,
    requestId,
    entityType,
    entityId,
    entitySerial: req.body?.entitySerial ?? null,
    note: req.body?.note ?? null,
  });
  res.json(result);
}

export async function voidCustomerVoucherRedeemController(
  req: Request,
  res: Response,
) {
  const redeemRequestId = String(req.body?.redeemRequestId || "");
  const requestId = String(req.body?.requestId || "");
  if (!redeemRequestId || !requestId) {
    res.status(400).json({ ok: false, msg: "redeemRequestId and requestId are required", result: null });
    return;
  }
  const result = await voidCustomerVoucherRedeem({
    companyId: companyIdFrom(res),
    redeemRequestId,
    requestId,
    note: req.body?.note ?? null,
  });
  res.json(result);
}

export async function issueRefundCustomerVoucherController(
  req: Request,
  res: Response,
) {
  const amount = Number(req.body?.amount);
  const memberId = String(req.body?.memberId || "");
  const entityType = String(req.body?.entityType || "");
  const entityId = String(req.body?.entityId || "");
  if (!memberId || !entityType || !entityId) {
    res.status(400).json({ ok: false, msg: "refund issue metadata is required", result: null });
    return;
  }
  if (!Number.isFinite(amount)) {
    res.status(400).json({ ok: false, msg: "amount is required", result: null });
    return;
  }
  const result = await issueRefundCustomerVoucher({
    companyId: companyIdFrom(res),
    memberId,
    amount,
    entityType,
    entityId,
    entitySerial: req.body?.entitySerial ?? null,
    deviceId: deviceIdFrom(res),
    note: req.body?.note ?? null,
  });
  res.json(result);
}
```

- [ ] **Step 2: Create CRM route file**

Create `/Users/dev/ktpv5/ktpv5-crm-server/src/device/customer-voucher/customerVoucher.routes.ts`:

```ts
import { Router } from "express";
import { deviceMiddleware } from "../../middleware";
import {
  getValidCustomerVouchersController,
  issueCustomerVoucherController,
  issueRefundCustomerVoucherController,
  redeemCustomerVoucherController,
  voidCustomerVoucherRedeemController,
} from "./customerVoucher.controller";

const customerVoucherRouter = Router();

customerVoucherRouter.use(deviceMiddleware);
customerVoucherRouter.get("/valid", getValidCustomerVouchersController);
customerVoucherRouter.post("/issue", issueCustomerVoucherController);
customerVoucherRouter.post("/redeem", redeemCustomerVoucherController);
customerVoucherRouter.post("/redeem/void", voidCustomerVoucherRedeemController);
customerVoucherRouter.post("/refund-issue", issueRefundCustomerVoucherController);

export default customerVoucherRouter;
```

- [ ] **Step 3: Mount CRM route**

Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/router/device.router.ts`:

```ts
import { Router } from "express";
import { deviceMiddleware } from "../middleware";
import memberRouter from "../device/member/member.routes";
import customerVoucherRouter from "../device/customer-voucher/customerVoucher.routes";

const deviceRouter = Router();

deviceRouter.use(deviceMiddleware);

deviceRouter.use("/member", memberRouter);
deviceRouter.use("/customer-voucher", customerVoucherRouter);
export default deviceRouter;
```

- [ ] **Step 4: Build CRM**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
```

Expected: `tsc` passes.

- [ ] **Step 5: Commit CRM routes**

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
git add src/device/customer-voucher src/router/device.router.ts
git commit -m "feat: expose customer voucher device API"
```

---

### Task 4: Add POS Local Customer Voucher Proxy

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.types.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.controller.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.router.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/router.ts`

- [ ] **Step 1: Create POS proxy types**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.types.ts`:

```ts
export interface CustomerVoucherWire {
  id: number;
  memberId: string;
  serial: string;
  kind: "POINT_EXCHANGE" | "REFUND";
  initAmount: number;
  balance: number;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  validFrom: string;
  validTo: string;
  label: string;
}

export interface CustomerVoucherRedeemRequest {
  memberId: string;
  voucherId: number;
  amount: number;
  requestId: string;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  note?: string | null;
}

export interface CustomerVoucherRefundIssueRequest {
  memberId: string;
  amount: number;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  note?: string | null;
}

export interface CustomerVoucherRedeemResult {
  requestId: string;
  voucherId: number;
  amount: number;
}
```

- [ ] **Step 2: Create POS proxy service**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.service.ts`:

```ts
import { crmApiService } from "../../libs/cloud.api";
import { BadRequestException, InternalServerException } from "../../libs/exceptions";
import type {
  CustomerVoucherRedeemRequest,
  CustomerVoucherRefundIssueRequest,
  CustomerVoucherWire,
} from "./customer-voucher.types";

function requireOk<T>(res: {
  ok: boolean;
  msg?: string;
  result?: T | null;
}): T {
  if (!res.ok || res.result == null) {
    throw new BadRequestException(res.msg || "CRM customer voucher request failed");
  }
  return res.result;
}

export async function getValidCustomerVouchersService(memberId: string) {
  const res = await crmApiService.get<CustomerVoucherWire[]>(
    "/device/customer-voucher/valid",
    { memberId },
  );
  return { ok: true, result: requireOk(res) };
}

export async function issueCustomerVoucherService(memberId: string) {
  const res = await crmApiService.post<{
    voucher: CustomerVoucherWire;
    memberPoints: number;
  }>("/device/customer-voucher/issue", { memberId });
  return { ok: true, result: requireOk(res) };
}

export async function redeemCustomerVoucherService(
  input: CustomerVoucherRedeemRequest,
) {
  const res = await crmApiService.post("/device/customer-voucher/redeem", input);
  requireOk(res);
  return {
    requestId: input.requestId,
    voucherId: input.voucherId,
    amount: input.amount,
  };
}

export async function voidCustomerVoucherRedeemService({
  redeemRequestId,
  requestId,
  note,
}: {
  redeemRequestId: string;
  requestId: string;
  note?: string | null;
}) {
  const res = await crmApiService.post("/device/customer-voucher/redeem/void", {
    redeemRequestId,
    requestId,
    note: note ?? null,
  });
  requireOk(res);
  return { ok: true, result: { requestId, redeemRequestId } };
}

export async function issueRefundCustomerVoucherService(
  input: CustomerVoucherRefundIssueRequest,
) {
  const res = await crmApiService.post<{ voucher: CustomerVoucherWire }>(
    "/device/customer-voucher/refund-issue",
    input,
  );
  return { ok: true, result: requireOk(res).voucher };
}

export function customerVoucherFailure(message: string, cause: unknown): never {
  console.error(message, cause);
  throw new InternalServerException(message);
}
```

- [ ] **Step 3: Create POS proxy controller**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.controller.ts`:

```ts
import { Request, Response } from "express";
import {
  getValidCustomerVouchersService,
  issueCustomerVoucherService,
} from "./customer-voucher.service";

export async function getValidCustomerVouchersController(
  req: Request,
  res: Response,
) {
  const memberId = String(req.query.memberId || "");
  if (!memberId) {
    res.status(400).json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  res.json(await getValidCustomerVouchersService(memberId));
}

export async function issueCustomerVoucherController(req: Request, res: Response) {
  const memberId = String(req.body?.memberId || "");
  if (!memberId) {
    res.status(400).json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  res.json(await issueCustomerVoucherService(memberId));
}
```

- [ ] **Step 4: Create POS proxy router**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.router.ts`:

```ts
import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  getValidCustomerVouchersController,
  issueCustomerVoucherController,
} from "./customer-voucher.controller";

const customerVoucherRouter = Router();

customerVoucherRouter.get(
  "/valid",
  userMiddleware,
  scopeMiddleware("sale"),
  getValidCustomerVouchersController,
);

customerVoucherRouter.post(
  "/issue",
  userMiddleware,
  scopeMiddleware("sale"),
  issueCustomerVoucherController,
);

export default customerVoucherRouter;
```

- [ ] **Step 5: Mount POS proxy router**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/router.ts`:

```ts
import customerVoucherRouter from "./v1/customer-voucher/customer-voucher.router";
```

Add near `voucherRouter`:

```ts
router.use("/customer-voucher", customerVoucherRouter);
```

- [ ] **Step 6: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: `tsc` passes.

- [ ] **Step 7: Commit POS proxy**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/v1/customer-voucher retail_pos_server/src/router.ts
git commit -m "feat: proxy customer voucher API"
```

---

### Task 5: Add POS Renderer Customer Voucher Input

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/constants.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/customer-voucher.service.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/SearchCustomerVoucherModal.tsx`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/CustomerVoucherInput.tsx`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Add POS renderer constants**

Append to `retail_pos_app/src/renderer/src/libs/constants.ts`:

```ts
export const CUSTOMER_VOUCHER_ISSUE_POINTS = 1000;
export const CUSTOMER_VOUCHER_ISSUE_AMOUNT = 1000;
```

- [ ] **Step 2: Create renderer service**

Create `retail_pos_app/src/renderer/src/service/customer-voucher.service.ts`:

```ts
import apiService, { ApiResponse } from "../libs/api";

export type CustomerVoucher = {
  id: number;
  memberId: string;
  serial: string;
  kind: "POINT_EXCHANGE" | "REFUND";
  initAmount: number;
  balance: number;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  validFrom: string;
  validTo: string;
  label: string;
};

export type CustomerVoucherIssueResult = {
  voucher: CustomerVoucher;
  memberPoints: number;
};

export async function getValidCustomerVouchers(
  memberId: string,
): Promise<ApiResponse<CustomerVoucher[]>> {
  return apiService.get<CustomerVoucher[]>("/api/customer-voucher/valid", {
    memberId,
  });
}

export async function issueCustomerVoucher(
  memberId: string,
): Promise<ApiResponse<CustomerVoucherIssueResult>> {
  return apiService.post<CustomerVoucherIssueResult>(
    "/api/customer-voucher/issue",
    { memberId },
  );
}
```

- [ ] **Step 3: Create search/issue modal**

Create `SearchCustomerVoucherModal.tsx` modeled after `SearchUserVoucherModal.tsx`. Use this component contract:

```ts
type Props = {
  open: boolean;
  memberId: string;
  memberPoints: number;
  usedVoucherIds: number[];
  onClose: () => void;
  onSelect: (voucher: CustomerVoucher, memberPoints?: number) => void;
};
```

Required behavior:

- On open, call `getValidCustomerVouchers(memberId)`.
- Show only vouchers returned by the server.
- Disable rows whose id exists in `usedVoucherIds`, displaying `In use`.
- Show an `ISSUE $10` action when `memberPoints >= CUSTOMER_VOUCHER_ISSUE_POINTS`.
- Issue action calls `issueCustomerVoucher(memberId)`.
- On issue success, call `onSelect(result.voucher, result.memberPoints)` and close.
- On existing voucher select, call `onSelect(voucher)` and close.
- Display voucher `serial`, balance, and expiry.

- [ ] **Step 4: Create CustomerVoucherInput**

Create `CustomerVoucherInput.tsx` beside `UserVoucherInput.tsx`. Match `UserVoucherInput` layout and numpad behavior with this prop contract:

```ts
type Props = {
  amount: number;
  setAmount: (next: number) => void;
  left: number;
  voucher: CustomerVoucher | null;
  memberId: string;
  memberPoints: number;
  usedVoucherIds: number[];
  onSelectVoucher: (voucher: CustomerVoucher, memberPoints?: number) => void;
  onCommit: () => void;
};
```

Required behavior:

- Display `CUSTOMER VOUCHER` and current staged amount.
- If a voucher is selected, show `voucher.serial` and balance.
- If no voucher selected, show `No voucher selected`.
- Search button opens `SearchCustomerVoucherModal`.
- `EXACT` sets amount to `Math.min(left, voucher.balance)`.
- Numpad appends cents exactly like `UserVoucherInput`.
- `ADD CUSTOMER VOUCHER` is enabled only when voucher exists and amount > 0.

- [ ] **Step 5: Wire PaymentModal customer voucher state**

Modify `PaymentModal/index.tsx`:

- Import `CustomerVoucherInput`.
- Import `CustomerVoucher` type.
- Add state:

```ts
const [stagedCustomerVoucher, setStagedCustomerVoucher] =
  useState<CustomerVoucher | null>(null);
const [customerVoucherMemberPoints, setCustomerVoucherMemberPoints] = useState<
  number | null
>(null);
```

- When spend mode toggles, member changes, slot changes, or staged commit occurs, clear `stagedCustomerVoucher`.
- Add used customer voucher ids:

```ts
const usedCustomerVoucherIds = useMemo(
  () =>
    payments
      .filter(
        (p) => p.tender === "VOUCHER" && p.entityType === "customer-voucher",
      )
      .map((p) => p.entityId),
  [payments],
);
```

- Add select function:

```ts
function selectCustomerVoucher(
  voucher: CustomerVoucher,
  memberPoints?: number,
) {
  setStagedCustomerVoucher(voucher);
  if (memberPoints != null) setCustomerVoucherMemberPoints(memberPoints);
  setStagedPayment({
    key: "staged",
    tender: "VOUCHER",
    entityType: "customer-voucher",
    entityId: voucher.id,
    entityLabel: voucher.label,
    amount: 0,
  });
}
```

- Add amount updater:

```ts
function setStagedCustomerVoucherAmount(amount: number) {
  setStagedPayment((prev) => {
    if (prev.tender !== "VOUCHER") return prev;
    if (prev.entityType !== "customer-voucher") return prev;
    return { ...prev, amount };
  });
}
```

- Replace the Customer Voucher pending text with:

```tsx
<CustomerVoucherInput
  amount={stagedPayment.amount}
  setAmount={setStagedCustomerVoucherAmount}
  left={left}
  voucher={stagedCustomerVoucher}
  memberId={activeMember.id}
  memberPoints={customerVoucherMemberPoints ?? activeMember.points ?? 0}
  usedVoucherIds={usedCustomerVoucherIds}
  onSelectVoucher={selectCustomerVoucher}
  onCommit={commitStaged}
/>
```

- [ ] **Step 6: Build POS app**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: renderer TypeScript passes. Fix only files touched by this task and type mismatches caused by member type shape.

- [ ] **Step 7: Commit POS renderer Customer Voucher input**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_app/src/renderer/src/libs/constants.ts retail_pos_app/src/renderer/src/service/customer-voucher.service.ts retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal
git commit -m "feat: add customer voucher payment input"
```

---

### Task 6: Redeem Customer Vouchers During POS Sale Creation

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/sale/sale.create.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/customer-voucher/customer-voucher.service.ts`

- [ ] **Step 1: Add sale redeem helpers to POS proxy service**

Append to `customer-voucher.service.ts`:

```ts
export interface RedeemedCustomerVoucher {
  redeemRequestId: string;
  voucherId: number;
  amount: number;
}

export async function redeemCustomerVouchersForSale({
  invoiceRequestId,
  memberId,
  payments,
}: {
  invoiceRequestId: string;
  memberId: string;
  payments: Array<{
    type: string;
    amount: number;
    entityType?: string;
    entityId?: number;
    entityLabel?: string;
  }>;
}): Promise<RedeemedCustomerVoucher[]> {
  const customerVouchers = payments.filter(
    (payment) =>
      payment.type === "VOUCHER" &&
      payment.entityType === "customer-voucher" &&
      payment.entityId != null,
  );

  const redeemed: RedeemedCustomerVoucher[] = [];
  for (const payment of customerVouchers) {
    const redeemRequestId = `${invoiceRequestId}:cv:${payment.entityId}:${payment.amount}`;
    await redeemCustomerVoucherService({
      memberId,
      voucherId: payment.entityId!,
      amount: payment.amount,
      requestId: redeemRequestId,
      entityType: "pos-sale-request",
      entityId: invoiceRequestId,
      entitySerial: null,
      note: payment.entityLabel ?? null,
    });
    redeemed.push({
      redeemRequestId,
      voucherId: payment.entityId!,
      amount: payment.amount,
    });
  }
  return redeemed;
}

export async function voidRedeemedCustomerVouchersForSale({
  redeemed,
  reason,
}: {
  redeemed: RedeemedCustomerVoucher[];
  reason: string;
}) {
  for (const item of redeemed) {
    await voidCustomerVoucherRedeemService({
      redeemRequestId: item.redeemRequestId,
      requestId: `${item.redeemRequestId}:void`,
      note: reason,
    });
  }
}
```

- [ ] **Step 2: Modify sale creation service**

In `sale.create.service.ts`, import:

```ts
import {
  redeemCustomerVouchersForSale,
  voidRedeemedCustomerVouchersForSale,
} from "../customer-voucher/customer-voucher.service";
```

In `createSaleService`, after `validateAmounts(payload)` and before `nowAnchor()`, add:

```ts
const customerVoucherPayments = payload.payments.filter(
  (payment) =>
    payment.type === "VOUCHER" && payment.entityType === "customer-voucher",
);
if (customerVoucherPayments.length > 0 && !payload.member?.id) {
  throw new BadRequestException("customer voucher requires member");
}

const invoiceRequestId = crypto.randomUUID();
let redeemedCustomerVouchers: Awaited<
  ReturnType<typeof redeemCustomerVouchersForSale>
> = [];
if (customerVoucherPayments.length > 0) {
  redeemedCustomerVouchers = await redeemCustomerVouchersForSale({
    invoiceRequestId,
    memberId: payload.member!.id,
    payments: payload.payments,
  });
}
```

Wrap the existing DB transaction in a `try/catch`. On catch, void redeemed vouchers before rethrow:

```ts
try {
  const { dayStr, yyyymmdd, dayStart } = nowAnchor();
  const invoice = await db.$transaction(async (tx) => {
    return buildSaleInTx(tx, {
      payload,
      context,
      dayStr,
      yyyymmdd,
      dayStart,
    });
  });

  triggerSyncAllSaleInvoices();
  return { ok: true, result: invoice };
} catch (e) {
  if (redeemedCustomerVouchers.length > 0) {
    try {
      await voidRedeemedCustomerVouchersForSale({
        redeemed: redeemedCustomerVouchers,
        reason: "POS local sale creation failed after CRM redeem",
      });
    } catch (voidError) {
      console.error("[customer-voucher] redeem void failed", {
        voidError,
        redeemedCustomerVouchers,
        memberId: payload.member?.id,
        total: payload.total,
      });
    }
  }
  throw e;
}
```

Also add `import crypto from "node:crypto";` at the top of `sale.create.service.ts`.

- [ ] **Step 3: Build POS server**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

Expected: `tsc` passes. If Node crypto import style conflicts with tsconfig, use `import { randomUUID } from "node:crypto";` and call `randomUUID()`.

- [ ] **Step 4: Commit sale redeem integration**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/v1/customer-voucher/customer-voucher.service.ts retail_pos_server/src/v1/sale/sale.create.service.ts
git commit -m "feat: redeem customer vouchers on sale"
```

---

### Task 7: Implement Customer Voucher Refund Issue

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/sale/sale.refund.service.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/refund/compute.ts`
- Modify if needed: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/refund/build-payload.ts`
- Modify if needed: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen/index.tsx`

- [ ] **Step 1: Remove server-side customer-voucher refund block**

In `sale.refund.service.ts`, delete the block in `loadOriginalOrThrow` that throws:

```ts
"Invoice contains customer-voucher payment — refund blocked until CRM online check is implemented (D-21)"
```

Leave `orig.type !== "SALE"` validation and the existing include shape intact.

- [ ] **Step 2: Issue refund vouchers before local refund persistence**

Import:

```ts
import { issueRefundCustomerVoucherService } from "../customer-voucher/customer-voucher.service";
import { randomUUID } from "node:crypto";
```

In `createRefundService`, after aggregates and tender caps are validated but before `buildRefundInTx`, detect customer-voucher refund payments:

```ts
const customerVoucherRefunds = payload.payments.filter(
  (payment) =>
    payment.type === "VOUCHER" && payment.entityType === "customer-voucher",
);
for (const payment of customerVoucherRefunds) {
  if (!orig.memberId) {
    throw new BadRequestException("customer voucher refund requires member");
  }
  const refundVoucher = await issueRefundCustomerVoucherService({
    memberId: orig.memberId,
    amount: payment.amount,
    entityType: "pos-refund-request",
    entityId: `${payload.originalInvoiceId}:${randomUUID()}:${payment.amount}`,
    entitySerial: orig.serial,
    note: "Customer voucher refund",
  });
  payment.entityId = refundVoucher.result.id;
  payment.entityLabel = refundVoucher.result.label;
}
```

If TypeScript does not allow mutation of `payload.payments`, build a new `payments` array and pass it into later aggregate/build calls.

- [ ] **Step 3: Keep repay blocked**

Confirm `sale.repay.service.ts` still blocks customer-voucher repay through `loadOriginalOrThrow` or an explicit payment check. If removing the block from `loadOriginalOrThrow` also unlocks repay, add this to `validateEligibility`:

```ts
const hasCustomerVoucher = orig.payments.some(
  (payment) => payment.entityType === "customer-voucher",
);
if (hasCustomerVoucher) {
  throw new BadRequestException(
    "Repay is not allowed for customer-voucher invoices",
  );
}
```

- [ ] **Step 4: Remove renderer refund UI block**

In `retail_pos_app/src/renderer/src/libs/refund/compute.ts`, locate `hasCustomerVoucherPayment`. Keep the helper if useful for repay UI, but stop using it to block normal refund. The refund screen must allow customer-voucher tender caps to appear.

Expected behavior:

- Original customer-voucher payment appears as refundable tender.
- Refund payload uses `type="VOUCHER"`, `entityType="customer-voucher"`, original `entityId`, and original `entityLabel` before server replaces it with the new refund voucher metadata.

- [ ] **Step 5: Build both POS projects**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: both builds pass.

- [ ] **Step 6: Commit refund integration**

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git add retail_pos_server/src/v1/sale/sale.refund.service.ts retail_pos_server/src/v1/sale/sale.repay.service.ts retail_pos_app/src/renderer/src/libs/refund retail_pos_app/src/renderer/src/screens/SaleRefundDetailScreen
git commit -m "feat: issue customer voucher refunds"
```

---

### Task 8: Manual Verification With Live CRM Guardrails

**Files:**
- No source edits unless verification reveals a bug.

- [ ] **Step 1: Re-check CRM migration SQL**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > /tmp/customer-voucher-crm.sql
sed -n '1,260p' /tmp/customer-voucher-crm.sql
```

Expected: additive SQL only. Ask the user before applying SQL to the live CRM database.

- [ ] **Step 2: Build all touched projects**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: all builds pass.

- [ ] **Step 3: Verify issue below threshold**

Use a member with less than 1000 points.

Expected:

- POS Customer Voucher Issue button is disabled.
- Direct API call to POS `/api/customer-voucher/issue` fails if attempted.
- CRM does not create voucher rows or point ledger rows.

- [ ] **Step 4: Verify issue at threshold**

Use the intended test member account with at least 1000 points.

Expected:

- Issue creates one CRM `CustomerVoucher`.
- Voucher amount is 1000 cents.
- Voucher validity is 14 days.
- `Member.points` decreases by 1000.
- `MemberPointLedger` has `type=REDEEM`, `pointsDelta=-1000`.
- `CustomerVoucherEvent` has `type=ISSUE`, `amount=1000`.
- POS selects the newly issued voucher with amount 0.

- [ ] **Step 5: Verify sale redemption**

Create a member sale using Customer Voucher.

Expected:

- Customer Voucher appears in POS payment list.
- Complete Sale calls CRM redeem.
- CRM voucher balance decreases by redeemed amount.
- CRM `CustomerVoucherEvent REDEEM` exists.
- Local POS `SaleInvoicePayment` stores:
  - `type=VOUCHER`
  - `entityType=customer-voucher`
  - `entityId=<crm voucher id>`
  - `entityLabel=<serial - Exp date>`

- [ ] **Step 6: Verify duplicate redeem idempotency**

Call CRM `/device/customer-voucher/redeem` twice with the same `requestId`.

Expected:

- First call decreases balance.
- Second call returns success without another balance decrease.
- There is one `REDEEM` event for that `requestId`.

- [ ] **Step 7: Verify redeem void**

Call CRM `/device/customer-voucher/redeem/void` twice for the same redeem.

Expected:

- First void restores balance once.
- Second void returns success without another balance increase.
- There is one `VOID_REDEEM` event for the original redeem request id.

- [ ] **Step 8: Verify refund issue**

Refund a customer-voucher invoice.

Expected:

- Original voucher balance is unchanged by refund.
- CRM creates a new `CustomerVoucher kind=REFUND`.
- New voucher amount equals customer-voucher refund amount.
- New voucher validity is 7 days.
- POS refund invoice payment points at the new CRM voucher id.

- [ ] **Step 9: Verify repay remains blocked**

Open repay for an invoice that used customer voucher.

Expected:

- UI blocks repay or server returns `Repay is not allowed for customer-voucher invoices`.
- No refund invoice and no replacement sale invoice are created.

- [ ] **Step 10: Final git status**

Run:

```bash
git -C /Users/dev/ktpv5/ktpv5-pos-retail status --short
git -C /Users/dev/ktpv5/ktpv5-crm-server status --short
```

Expected: only intended changes remain. Report any unrelated pre-existing changes separately.

---

## Self-Review

- Spec coverage: This plan covers CRM-owned voucher schema, serial generation, constants, issue, valid list, redeem, void redeem, refund issue, POS local proxy, POS renderer CustomerVoucherInput, sale completion redemption, refund behavior, repay block, and live CRM DB safety.
- Migration safety: The plan never instructs `prisma db push` or destructive reset against CRM. It requires SQL inspection and user approval before live DB application.
- Type consistency: Customer voucher ids are numeric end-to-end because POS `SaleInvoicePayment.entityId` is `Int`.
- Risk note: Task 7 is the most coupled task because `loadOriginalOrThrow` currently blocks both refund and repay via a shared helper. Preserve repay blocking explicitly if normal refund is unlocked.
