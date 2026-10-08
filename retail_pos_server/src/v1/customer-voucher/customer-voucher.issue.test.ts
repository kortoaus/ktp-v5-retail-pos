import assert from "node:assert/strict";
import test from "node:test";

import { issueCustomerVoucherController } from "./customer-voucher.controller";
import {
  customerVoucherIssueRequestId,
  issueCustomerVoucherService,
} from "./customer-voucher.service";

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
  const res = await issueCustomerVoucherService("m-1", OP, crm);
  assert.equal(res.ok, true);
  assert.deepEqual(crm.calls, [
    { endpoint: "/device/customer-voucher/issue", data: { memberId: "m-1", requestId: `${OP}:cv-issue` } },
  ]);
  assert.equal(customerVoucherIssueRequestId(OP), `${OP}:cv-issue`);
});

test("issue without operationId (Runner) is forwarded without requestId", async () => {
  const crm = fakeCrm();
  await issueCustomerVoucherService("m-1", null, crm);
  await issueCustomerVoucherService("m-1", undefined, crm);
  for (const call of crm.calls) {
    assert.deepEqual(call.data, { memberId: "m-1" });
    assert.equal("requestId" in call.data, false);
  }
});

test("a CRM replay passes through (same voucher, replayed flag)", async () => {
  const crm = fakeCrm({ voucher: { id: 9 }, memberPoints: 500, replayed: true });
  const res = await issueCustomerVoucherService("m-1", OP, crm);
  assert.equal(res.result.replayed, true);
  assert.equal(res.result.voucher.id, 9);
});

test("controller rejects a malformed operationId before calling CRM", async () => {
  const req = { body: { memberId: "m-1", operationId: "bad:id" } } as any;
  const res = { json() {}, status() { return this; } } as any;
  await assert.rejects(issueCustomerVoucherController(req, res), /operationId must be/);
});
