import assert from "node:assert/strict";
import test from "node:test";

import { issueCustomerVoucherController } from "./customer-voucher.controller";
import {
  CUSTOMER_VOUCHER_ISSUE_AMOUNTS,
  customerVoucherIssueRequestId,
  issueCustomerVoucherService,
  normalizeCustomerVoucherIssueAmount,
} from "./customer-voucher.service";
import { BadRequestException } from "../../libs/exceptions";

// T-17 (V-5) — POST /api/customer-voucher/issue forwards the till's
// operationId to CRM as requestId `<operationId>:cv-issue`; a request without
// it (Runner) is forwarded without requestId. Fake CRM client, no network.

const OP = "3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f";

function fakeCrm(result: unknown = { voucher: { id: 9, label: "CV - Exp 26-10-22" }, memberPoints: 500 }) {
  const calls: Array<{ endpoint: string; data: any }> = [];
  return {
    calls,
    async post<T>(endpoint: string, data?: any) {
      calls.push({ endpoint, data });
      return { ok: true, msg: "ok", status: 200, result: result as T, paging: null } as any;
    },
  };
}

test("issue forwards operationId as requestId <operationId>:cv-issue", async () => {
  const crm = fakeCrm();
  const res = await issueCustomerVoucherService("m-1", OP, 1000, crm);
  assert.equal(res.ok, true);
  assert.deepEqual(crm.calls, [
    { endpoint: "/device/customer-voucher/issue", data: { memberId: "m-1", amount: 1000, requestId: `${OP}:cv-issue` } },
  ]);
  assert.equal(customerVoucherIssueRequestId(OP), `${OP}:cv-issue`);
});

test("issue without operationId (Runner) is forwarded without requestId", async () => {
  const crm = fakeCrm();
  await issueCustomerVoucherService("m-1", null, 1000, crm);
  await issueCustomerVoucherService("m-1", undefined, 1000, crm);
  for (const call of crm.calls) {
    assert.deepEqual(call.data, { memberId: "m-1", amount: 1000 });
    assert.equal("requestId" in call.data, false);
  }
});

test("a CRM replay passes through (same voucher, replayed flag)", async () => {
  const crm = fakeCrm({ voucher: { id: 9 }, memberPoints: 500, replayed: true });
  const res = await issueCustomerVoucherService("m-1", OP, 1000, crm);
  assert.equal(res.result.replayed, true);
  assert.equal(res.result.voucher.id, 9);
});

test("controller rejects a malformed operationId before calling CRM", async () => {
  const req = { body: { memberId: "m-1", operationId: "bad:id" } } as any;
  const res = { json() {}, status() { return this; } } as any;
  await assert.rejects(issueCustomerVoucherController(req, res), /operationId must be/);
});

// D-24 (retail-delivery T-17) — four tiers in cents; absent → $10; anything else → 400.

test("issue forwards each tier amount to CRM with the requestId", async () => {
  assert.deepEqual([...CUSTOMER_VOUCHER_ISSUE_AMOUNTS], [1000, 2500, 5000, 10000]);
  for (const amount of CUSTOMER_VOUCHER_ISSUE_AMOUNTS) {
    const crm = fakeCrm();
    await issueCustomerVoucherService("m-1", OP, amount, crm);
    assert.deepEqual(crm.calls, [
      { endpoint: "/device/customer-voucher/issue", data: { memberId: "m-1", amount, requestId: `${OP}:cv-issue` } },
    ]);
  }
});

test("issue without an amount defaults to 1000 cents ($10)", async () => {
  assert.equal(normalizeCustomerVoucherIssueAmount(undefined), 1000);
  assert.equal(normalizeCustomerVoucherIssueAmount(null), 1000);
  const crm = fakeCrm();
  await issueCustomerVoucherService("m-1", OP, undefined, crm);
  assert.deepEqual(crm.calls[0].data, { memberId: "m-1", amount: 1000, requestId: `${OP}:cv-issue` });
});

test("any other amount is a 400 'Invalid voucher amount'", () => {
  for (const bad of [0, 999, 1500, 2000, 100000, -1000, 2500.5, "2500", "", true, {}, []]) {
    assert.throws(
      () => normalizeCustomerVoucherIssueAmount(bad),
      (err: unknown) =>
        err instanceof BadRequestException &&
        err.statusCode === 400 &&
        err.message === "Invalid voucher amount",
      `amount ${JSON.stringify(bad)}`,
    );
  }
});

test("controller rejects an invalid amount before calling CRM", async () => {
  const req = { body: { memberId: "m-1", operationId: OP, amount: 3000 } } as any;
  const res = { json() {}, status() { return this; } } as any;
  await assert.rejects(issueCustomerVoucherController(req, res), (err: unknown) =>
    err instanceof BadRequestException && err.statusCode === 400 && err.message === "Invalid voucher amount",
  );
  // the service guards a direct caller too
  const crm = fakeCrm();
  await assert.rejects(issueCustomerVoucherService("m-1", OP, 3000, crm), /Invalid voucher amount/);
  assert.equal(crm.calls.length, 0);
});
