import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import type { SaleInvoiceModel } from "../../generated/prisma/models";
import {
  createRefundService,
  prepareRefund,
  substituteIssuedVoucher,
  type OrigInvoice,
  type PersistRefundArgs,
  type RefundContext,
  type RefundCreateDeps,
} from "./sale.refund.service";
import { validateEligibility, validateRepayPayloadShape } from "./sale.repay.service";
import type { PaymentPayload, RefundCreatePayload } from "./sale.types";
import { FakeCrm, FakeOpsStore } from "../customer-voucher/customer-voucher.test-fakes";

// T-15 (platform/D-10) — refund operation identity (R-3), refund voucher issue
// outside the lock with ledger + void (R-4/V-2, V-3), whole-Invoice CRM
// reachability (V-6, owner #31) and Repay's customer-voucher guard (V-4).

const CONTEXT = {
  terminal: { id: 1, name: "T1" },
  storeSetting: { companyId: 1 },
  user: { id: 9, name: "Kim" },
  shift: { id: 3 },
} as unknown as RefundContext;

function original(payments: Array<Partial<OrigInvoice["payments"][number]>>): OrigInvoice {
  return {
    id: 50,
    type: "SALE",
    serial: "3-20261008-S000050",
    memberId: "m-1",
    pointsEarned: 0,
    shiftId: 3,
    createdAt: new Date(),
    rows: [
      {
        id: 11,
        qty: 2000,
        refunded_qty: 0,
        total: 1000,
        surcharge_share: 0,
        taxable: false,
        isPointExcluded: false,
      },
    ],
    payments: payments.map((p, i) => ({ id: i + 1, entityType: null, entityId: null, entityLabel: null, ...p })),
    refunds: [],
  } as unknown as OrigInvoice;
}

function harness(orig: OrigInvoice) {
  const crm = new FakeCrm();
  const ops = new FakeOpsStore();
  const invoices: SaleInvoiceModel[] = [];
  let failNext = false;
  const persisted: PersistRefundArgs[] = [];
  const deps: RefundCreateDeps = {
    crm,
    ops,
    findInvoiceByOperationId: async (operationId) =>
      invoices.find((inv) => inv.operationId === operationId) ?? null,
    loadOriginal: async () => orig,
    persistRefund: async (args) => {
      persisted.push(args);
      if (failNext) {
        failNext = false;
        throw new Error("serialization failure");
      }
      const { aggregates } = prepareRefund(orig, args.payload); // re-validate as under the lock
      const payments: PaymentPayload[] = substituteIssuedVoucher(args.payload.payments, args.customerVoucherIssue);
      const invoice = {
        id: 100 + invoices.length,
        type: "REFUND",
        total: aggregates.total,
        operationId: args.operationId,
        operationPayloadHash: args.payloadHash,
      } as unknown as SaleInvoiceModel;
      ops.link(args.customerVoucherIssue ? [args.customerVoucherIssue.issued.row.id] : [], invoice.id);
      // Record the child so the next refund's caps / remaining qty see it.
      for (const r of args.payload.rows) {
        const row = orig.rows.find((x) => x.id === r.originalInvoiceRowId)!;
        row.refunded_qty += r.refund_qty;
      }
      orig.refunds.push({
        id: invoice.id,
        rows: args.payload.rows.map((r) => ({ originalInvoiceRowId: r.originalInvoiceRowId, total: aggregates.linesTotal, surcharge_share: 0 })),
        payments: payments.map((p) => ({ type: p.type, amount: p.amount, entityType: p.entityType ?? null, entityId: p.entityId ?? null })),
      } as unknown as OrigInvoice["refunds"][number]);
      invoices.push(invoice);
      return invoice;
    },
    afterCommit: () => {},
  };
  return { crm, ops, invoices, deps, persisted, failOnce: () => (failNext = true) };
}

const CV_PAID = [{ type: "VOUCHER" as const, amount: 1000, entityType: "customer-voucher", entityId: 7, entityLabel: "CV-7" }];

function halfRefund(operationId?: string): RefundCreatePayload {
  return {
    originalInvoiceId: 50,
    rows: [{ originalInvoiceRowId: 11, refund_qty: 1000 }],
    payments: [{ type: "VOUCHER", amount: 500, entityType: "customer-voucher", entityId: 7, entityLabel: "CV-7" }],
    ...(operationId ? { operationId } : {}),
  };
}

test("V-3: two identical partial refunds with different operation ids issue two vouchers", async () => {
  const h = harness(original(CV_PAID));
  const a = await createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps);
  const b = await createRefundService(halfRefund("op-refund-b2"), CONTEXT, h.deps);
  assert.notEqual(a.result.id, b.result.id);
  assert.equal(h.crm.issues.size, 2);
  assert.deepEqual([...h.crm.issues.keys()], ["op-refund-a1:cv-refund:0", "op-refund-b2:cv-refund:0"]);
  assert.equal(h.ops.byKey("op-refund-a1:cv-refund:0")!.status, "LINKED");
});

test("a retry of one refund (lost response) replays the invoice and issues once", async () => {
  const h = harness(original(CV_PAID));
  const first = await createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps);
  const retry = await createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.id, first.result.id);
  assert.equal(h.crm.issues.size, 1);
  assert.equal(h.crm.calls.filter((c) => c.startsWith("issueRefund")).length, 1);
});

test("refund issue answer lost → UNRESOLVED 503; the retry replays the same entityId → one voucher", async () => {
  const h = harness(original(CV_PAID));
  h.crm.mode.issueRefund = ["unknown-after-effect"];
  await assert.rejects(
    createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503,
  );
  assert.equal(h.ops.byKey("op-refund-a1:cv-refund:0")!.status, "UNRESOLVED");
  assert.equal(h.persisted.length, 0);
  const retry = await createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps);
  assert.equal(retry.ok, true);
  assert.equal(h.crm.issues.size, 1);
  assert.equal(h.ops.byKey("op-refund-a1:cv-refund:0")!.status, "LINKED");
});

test("local refund transaction fails → issued voucher voided through CRM → VOIDED", async () => {
  const h = harness(original(CV_PAID));
  h.failOnce();
  await assert.rejects(createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps));
  assert.deepEqual(h.ops.history.get("op-refund-a1:cv-refund:0"), ["INTENT", "CONFIRMED", "VOIDED"]);
  assert.equal(h.crm.issues.get("op-refund-a1:cv-refund:0")!.voided, true);
  assert.equal(h.ops.byKey("op-refund-a1:cv-refund:0:void")!.kind, "VOID_REFUND_ISSUE");
  assert.equal(h.invoices.length, 0);
});

test("local refund failure + refund void failure → UNRESOLVED for the reconciler", async () => {
  const h = harness(original(CV_PAID));
  h.failOnce();
  h.crm.mode.voidRefundIssue = ["unknown"];
  await assert.rejects(createRefundService(halfRefund("op-refund-a1"), CONTEXT, h.deps));
  assert.equal(h.ops.byKey("op-refund-a1:cv-refund:0")!.status, "UNRESOLVED");
});

test("more than one customer-voucher refund tender → 400 with the reason", async () => {
  const h = harness(original(CV_PAID));
  const payload: RefundCreatePayload = {
    originalInvoiceId: 50,
    rows: [{ originalInvoiceRowId: 11, refund_qty: 1000 }],
    payments: [
      { type: "VOUCHER", amount: 250, entityType: "customer-voucher", entityId: 7 },
      { type: "VOUCHER", amount: 250, entityType: "customer-voucher", entityId: 7 },
    ],
    operationId: "op-refund-a1",
  };
  await assert.rejects(
    createRefundService(payload, CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400 && /Only one Customer Voucher refund line/.test(e.message),
  );
  assert.equal(h.crm.calls.length, 0);
});

test("V-6: mixed original + cash-only partial refund while CRM is unreachable → refused, no local Refund", async () => {
  const h = harness(
    original([
      { type: "CASH", amount: 500 },
      { type: "VOUCHER", amount: 500, entityType: "customer-voucher", entityId: 7, entityLabel: "CV-7" },
    ]),
  );
  h.crm.mode.ping = ["throw"];
  const cashOnly: RefundCreatePayload = {
    originalInvoiceId: 50,
    rows: [{ originalInvoiceRowId: 11, refund_qty: 1000 }],
    payments: [{ type: "CASH", amount: 500 }],
    operationId: "op-refund-c3",
  };
  await assert.rejects(
    createRefundService(cashOnly, CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503 && /CRM is unreachable/.test(e.message),
  );
  assert.equal(h.persisted.length, 0, "no local Refund written");
  assert.equal(h.invoices.length, 0);

  // CRM back → the same cash-only refund goes through without any CRM money call.
  const ok = await createRefundService(cashOnly, CONTEXT, h.deps);
  assert.equal(ok.ok, true);
  assert.equal(h.crm.issues.size, 0);
});

test("V-6 does not touch originals without a customer voucher", async () => {
  const h = harness(original([{ type: "CASH", amount: 1000 }]));
  h.crm.mode.ping = ["throw"];
  const res = await createRefundService(
    { originalInvoiceId: 50, rows: [{ originalInvoiceRowId: 11, refund_qty: 1000 }], payments: [{ type: "CASH", amount: 500 }] },
    CONTEXT,
    h.deps,
  );
  assert.equal(res.ok, true);
  assert.equal(h.crm.calls.length, 0);
});

test("V-4: Repay rejects a Customer Voucher replacement tender and a Customer Voucher original", () => {
  assert.throws(
    () =>
      validateRepayPayloadShape({
        originalInvoiceId: 50,
        cashChange: 0,
        payments: [{ type: "VOUCHER", amount: 500, entityType: "customer-voucher", entityId: 7 }],
      }),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.doesNotThrow(() =>
    validateRepayPayloadShape({ originalInvoiceId: 50, cashChange: 0, payments: [{ type: "CASH", amount: 500 }] }),
  );
  assert.throws(
    () => validateEligibility(original(CV_PAID), { shift: { id: 3 } } as unknown as Parameters<typeof validateEligibility>[1], new Date()),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
});
