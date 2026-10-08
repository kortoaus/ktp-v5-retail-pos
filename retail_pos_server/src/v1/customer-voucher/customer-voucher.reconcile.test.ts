import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import { claimOperation, releaseOperation } from "../sale/sale.operation";
import { FakeCrm, FakeOpsStore } from "./customer-voucher.test-fakes";
import {
  MAX_RECONCILE_ATTEMPTS,
  reconcileCustomerVoucherOperations,
  triggerCustomerVoucherReconcile,
  type ReconcileDeps,
} from "./customer-voucher.reconcile.service";
import {
  listCustomerVoucherOperationsService,
  parseOperationStatuses,
} from "./customer-voucher.operations.query";
import type { CvOperationStatus } from "./customer-voucher.operation.store";

// T-15 (platform/D-10) — each reconciliation branch with a fake CRM client.

const LATER = 3 * 60_000;

type TestInvoice = {
  operationId: string;
  id: number;
  type: string;
  payments?: Array<{ type: string; amount: number; entityType: string | null; entityId: number | null }>;
};

function setup(invoices: TestInvoice[] = []) {
  const crm = new FakeCrm();
  const ops = new FakeOpsStore();
  const deps: ReconcileDeps = {
    crm,
    ops,
    findInvoiceByOperationId: async (operationId) => {
      const inv = invoices.find((i) => i.operationId === operationId);
      return inv ? { id: inv.id, type: inv.type, payments: inv.payments ?? [] } : null;
    },
    now: () => new Date(Date.now() + LATER),
  };
  return { crm, ops, deps };
}

async function redeemRow(
  h: ReturnType<typeof setup>,
  operationId: string,
  status: CvOperationStatus,
  crmDid: "redeemed" | "voided" | "nothing",
) {
  const key = `${operationId}:cv:7:400`;
  if (crmDid !== "nothing") {
    await h.crm.redeem({ memberId: "m-1", voucherId: 7, amount: 400, requestId: key, entityType: "pos-sale-request", entityId: operationId });
    if (crmDid === "voided") await h.crm.voidRedeem({ redeemRequestId: key, requestId: `${key}:void` });
  }
  const row = await h.ops.ensureIntent({ operationId, kind: "REDEEM", voucherId: 7, memberId: "m-1", amount: 400, crmRequestId: key });
  if (status !== "INTENT") await h.ops.update(row.id, { status });
  return key;
}

async function refundIssueRow(h: ReturnType<typeof setup>, operationId: string, crmDid: "issued" | "voided" | "nothing") {
  const key = `${operationId}:cv-refund:0`;
  if (crmDid !== "nothing") {
    await h.crm.issueRefund({ memberId: "m-1", amount: 500, entityType: "pos-refund-request", entityId: key });
    if (crmDid === "voided") await h.crm.voidRefundIssue({ entityType: "pos-refund-request", entityId: key, requestId: `${key}:void` });
  }
  const row = await h.ops.ensureIntent({ operationId, kind: "REFUND_ISSUE", voucherId: null, memberId: "m-1", amount: 500, crmRequestId: key });
  await h.ops.update(row.id, { status: "UNRESOLVED" });
  return key;
}

test("REDEEM not_found at CRM → FAILED (nothing happened)", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-nf-00001", "INTENT", "nothing");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.failed, 1);
  assert.equal(h.ops.byKey(key)!.status, "FAILED");
});

test("REDEEM already voided at CRM → VOIDED", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-vd-00001", "UNRESOLVED", "voided");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.calls.filter((c) => c.startsWith("voidRedeem")).length, 1, "no second void");
});

test("REDEEM redeemed and no local invoice → void → VOIDED, balance restored", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-rd-00001", "CONFIRMED", "redeemed");
  assert.equal(h.crm.balances.get(7), 600);
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("REDEEM redeemed and the local invoice exists → LINKED (no void)", async () => {
  const h = setup([
    {
      operationId: "op-ln-00001",
      id: 42,
      type: "SALE",
      payments: [{ type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7 }],
    },
  ]);
  const key = await redeemRow(h, "op-ln-00001", "UNRESOLVED", "redeemed");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.linked, 1);
  assert.equal(h.ops.byKey(key)!.status, "LINKED");
  assert.equal(h.ops.byKey(key)!.invoiceId, 42);
  assert.equal(h.crm.balances.get(7), 600);
});

test("REDEEM redeemed, void gets no answer → UNRESOLVED, counted as transient (F-12), void row pending (F-11)", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-vf-00001", "CONFIRMED", "redeemed");
  h.crm.mode.voidRedeem = ["unknown"];
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.unreachable, 1, "a void with no answer is transient");
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED");
  assert.equal(h.ops.byKey(key)!.attempts, 0);
  assert.ok(h.ops.byKey(key)!.transientFailures >= 1);
  assert.equal(h.ops.byKey(`${key}:void`)!.status, "UNRESOLVED");
});

test("REFUND_ISSUE issued with no local REFUND invoice → refund-issue void → VOIDED", async () => {
  const h = setup();
  const key = await refundIssueRow(h, "op-ri-00001", "issued");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.issues.get(key)!.voided, true);
});

test("REFUND_ISSUE issued with the local REFUND invoice → LINKED", async () => {
  // FakeCrm issues refund voucher ids from 500.
  const h = setup([
    {
      operationId: "op-rl-00001",
      id: 77,
      type: "REFUND",
      payments: [{ type: "VOUCHER", amount: 500, entityType: "customer-voucher", entityId: 500 }],
    },
  ]);
  const key = await refundIssueRow(h, "op-rl-00001", "issued");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.linked, 1);
  assert.equal(h.ops.byKey(key)!.invoiceId, 77);
});

test("REFUND_ISSUE already voided → VOIDED; never issued → FAILED", async () => {
  const h = setup();
  const voided = await refundIssueRow(h, "op-rv-00001", "voided");
  const none = await refundIssueRow(h, "op-rn-00001", "nothing");
  await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(h.ops.byKey(voided)!.status, "VOIDED");
  assert.equal(h.ops.byKey(none)!.status, "FAILED");
});

test("REFUND_ISSUE voucher already spent → void 409 → stays UNRESOLVED for a person", async () => {
  const h = setup();
  const key = await refundIssueRow(h, "op-rs-00001", "issued");
  h.crm.issues.get(key)!.spent = true;
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.unresolved, 1);
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED");
  assert.match(h.ops.byKey(key)!.lastError ?? "", /already spent/);
});

test("CRM unreachable → transientFailures+1 (not attempts), lastError, status unchanged", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-un-00001", "CONFIRMED", "redeemed");
  h.crm.mode.getOperation = ["unknown"];
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.unreachable, 1);
  const row = h.ops.byKey(key)!;
  assert.equal(row.status, "CONFIRMED");
  assert.equal(row.attempts, 0);
  assert.equal(row.transientFailures, 1);
  assert.match(row.lastError ?? "", /reconcile: CRM unknown/);
});

test("young rows and claimed operations are skipped", async () => {
  const h = setup();
  await redeemRow(h, "op-cl-00001", "CONFIRMED", "redeemed");
  const young = await reconcileCustomerVoucherOperations({ ...h.deps, now: () => new Date() });
  assert.equal(young.checked, 0);
  assert.ok(claimOperation("op-cl-00001"));
  try {
    const s = await reconcileCustomerVoucherOperations(h.deps);
    assert.equal(s.skipped, 1);
    assert.equal(s.checked, 0);
  } finally {
    releaseOperation("op-cl-00001");
  }
});

test("scheduler: one run in flight, triggers during a run coalesce into exactly one rerun", async () => {
  const h = setup();
  let runs = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const deps: ReconcileDeps = {
    ...h.deps,
    ops: Object.assign(Object.create(h.ops), {
      listForReconcile: async () => {
        runs += 1;
        if (runs === 1) await gate;
        return [];
      },
    }),
  };
  const first = triggerCustomerVoucherReconcile(deps);
  assert.ok(first);
  assert.equal(triggerCustomerVoucherReconcile(deps), null);
  assert.equal(triggerCustomerVoucherReconcile(deps), null);
  release();
  await first;
  assert.equal(runs, 2, "first run + one coalesced rerun, nothing dropped");
});

test("operations listing: status filter parsing and open count", async () => {
  assert.deepEqual(parseOperationStatuses("unresolved, CONFIRMED"), ["UNRESOLVED", "CONFIRMED"]);
  assert.deepEqual(parseOperationStatuses(undefined), ["INTENT", "CONFIRMED", "UNRESOLVED", "UNRESOLVED_MANUAL"]);
  assert.throws(() => parseOperationStatuses("BOGUS"), HttpException);
  const h = setup();
  await redeemRow(h, "op-ls-00001", "UNRESOLVED", "redeemed");
  await redeemRow(h, "op-ls-00002", "LINKED", "redeemed");
  const res = await listCustomerVoucherOperationsService("UNRESOLVED,CONFIRMED", h.ops);
  assert.equal(res.result.length, 1);
  assert.equal(res.openCount, 1);
});

test("F-6: an Invoice under the id that does NOT carry the voucher tender → the redeem is voided, not linked", async () => {
  const h = setup([
    { operationId: "op-cs-00001", id: 43, type: "SALE", payments: [{ type: "CASH", amount: 1000, entityType: null, entityId: null }] },
  ]);
  const key = await redeemRow(h, "op-cs-00001", "UNRESOLVED", "redeemed");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(s.linked, 0);
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("F-6: a REFUND Invoice without the issued voucher tender → the refund issue is voided, not linked", async () => {
  const h = setup([
    { operationId: "op-rc-00001", id: 78, type: "REFUND", payments: [{ type: "CASH", amount: 500, entityType: null, entityId: null }] },
  ]);
  const key = await refundIssueRow(h, "op-rc-00001", "issued");
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(h.crm.issues.get(key)!.voided, true);
});

test("F-10: a stuck row rotates to the back — a newer orphaned debit is reconciled in the next sweep", async () => {
  const h = setup();
  const stuck = await refundIssueRow(h, "op-st-00001", "issued");
  h.crm.issues.get(stuck)!.spent = true; // its void keeps answering 409
  const orphan = await redeemRow(h, "op-or-00001", "CONFIRMED", "redeemed");
  const deps = { ...h.deps, batchSize: 1 };

  const first = await reconcileCustomerVoucherOperations(deps);
  assert.equal(first.checked, 1);
  assert.equal(h.ops.byKey(stuck)!.status, "UNRESOLVED");
  const second = await reconcileCustomerVoucherOperations(deps);
  assert.equal(second.voided, 1);
  assert.equal(h.ops.byKey(orphan)!.status, "VOIDED", "the newer debit got its turn");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("F-10: after MAX attempts a row CRM cannot settle becomes UNRESOLVED_MANUAL — out of the sweep, still counted open", async () => {
  const h = setup();
  const key = await refundIssueRow(h, "op-mx-00001", "issued");
  h.crm.issues.get(key)!.spent = true;
  const row = h.ops.byKey(key)!;
  row.attempts = MAX_RECONCILE_ATTEMPTS - 1;
  await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED_MANUAL");
  assert.equal(await h.ops.countOpen(), 1);
  const again = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(again.checked, 0);
  const listed = await listCustomerVoucherOperationsService(undefined, h.ops);
  assert.equal(listed.result.length, 1);
});

test("F-10: CRM unreachable never moves a row to UNRESOLVED_MANUAL", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-ux-00001", "UNRESOLVED", "redeemed");
  h.ops.byKey(key)!.attempts = MAX_RECONCILE_ATTEMPTS + 5;
  h.crm.mode.getOperation = ["unknown"];
  await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED");
});

test("F-11: a void whose answer was lost is settled first — CRM shows it voided → void row CONFIRMED, primary VOIDED", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-vl-00001", "CONFIRMED", "redeemed");
  // The void landed at CRM but its answer was lost: the local void row is UNRESOLVED.
  await h.crm.voidRedeem({ redeemRequestId: key, requestId: `${key}:void` });
  const voidRow = await h.ops.ensureIntent({ operationId: "op-vl-00001", kind: "VOID_REDEEM", voucherId: 7, memberId: "m-1", amount: 400, crmRequestId: `${key}:void` });
  await h.ops.update(voidRow.id, { status: "UNRESOLVED" });
  await h.ops.update(h.ops.byKey(key)!.id, { status: "UNRESOLVED" });

  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.voided, 1);
  assert.equal(h.ops.byKey(`${key}:void`)!.status, "CONFIRMED");
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("F-11: pending void and CRM still shows the redeem → the same void is re-sent; the primary is never linked meanwhile", async () => {
  const h = setup([
    {
      operationId: "op-vr-00001",
      id: 44,
      type: "SALE",
      payments: [{ type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7 }],
    },
  ]);
  const key = await redeemRow(h, "op-vr-00001", "UNRESOLVED", "redeemed");
  const voidRow = await h.ops.ensureIntent({ operationId: "op-vr-00001", kind: "VOID_REDEEM", voucherId: 7, memberId: "m-1", amount: 400, crmRequestId: `${key}:void` });
  await h.ops.update(voidRow.id, { status: "UNRESOLVED" });
  const s = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(s.linked, 0, "never linked while its void was pending");
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.deepEqual(
    h.crm.calls.filter((c) => c.startsWith("voidRedeem")),
    [`voidRedeem ${key}`],
  );
});

test("F-12: 50 lookup failures in an outage, then recovery + one void timeout → still UNRESOLVED, retried next sweep", async () => {
  const h = setup();
  const key = await redeemRow(h, "op-ot-00001", "UNRESOLVED", "redeemed");
  for (let i = 0; i < 50; i++) {
    h.crm.mode.getOperation = ["unknown"];
    await reconcileCustomerVoucherOperations(h.deps);
  }
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED");
  assert.equal(h.ops.byKey(key)!.transientFailures, 50);
  assert.equal(h.ops.byKey(key)!.attempts, 0);

  h.crm.mode.voidRedeem = ["unknown"]; // CRM back, the void times out once
  await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(h.ops.byKey(key)!.status, "UNRESOLVED", "never UNRESOLVED_MANUAL for timeouts");

  const next = await reconcileCustomerVoucherOperations(h.deps);
  assert.equal(next.voided, 1);
  assert.equal(h.ops.byKey(key)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});
