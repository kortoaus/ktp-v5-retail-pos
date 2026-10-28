// npm run test:sale-core — retail-runner T-16 (S-4 §3): refund submit under
// the original invoice's operation attempt (libs/refund/submit-refund.ts).
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

const mem = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});

const { sendRefundWithOperation } = await import("./submit-refund.ts");
const { pendingOperation, refundAttemptKey } = await import("../operation-id.ts");

beforeEach(() => mem.clear());

const PAYLOAD = {
  originalInvoiceId: 42,
  rows: [{ originalInvoiceRowId: 1, refund_qty: 1000 }],
  payments: [{ type: "CASH", amount: 505 }],
};

function recorder(answers) {
  const bodies = [];
  const request = async (body) => {
    bodies.push(body);
    return answers.shift();
  };
  return { bodies, request };
}

test("the body is the payload plus the attempt's operationId", async () => {
  const { bodies, request } = recorder([{ ok: true, msg: "", result: { id: 9 } }]);
  const res = await sendRefundWithOperation(PAYLOAD, request);
  assert.equal(res.ok, true);
  assert.equal(bodies.length, 1);
  const { operationId, ...rest } = bodies[0];
  assert.deepEqual(rest, PAYLOAD);
  assert.match(operationId, /^[0-9a-f-]{36}$/);
});

test("ok settles the attempt: the next refund of that invoice is a new attempt", async () => {
  const { bodies, request } = recorder([
    { ok: true, msg: "", result: { id: 9 } },
    { ok: true, msg: "", result: { id: 10 } },
  ]);
  await sendRefundWithOperation(PAYLOAD, request);
  assert.equal(pendingOperation(refundAttemptKey(42)), null);
  await sendRefundWithOperation(PAYLOAD, request);
  assert.notEqual(bodies[0].operationId, bodies[1].operationId);
});

test("409 OPERATION_PAYLOAD_MISMATCH ends the attempt", async () => {
  const { bodies, request } = recorder([
    { ok: false, msg: "mismatch", status: 409, result: { code: "OPERATION_PAYLOAD_MISMATCH" } },
    { ok: true, msg: "", result: { id: 11 } },
  ]);
  const res = await sendRefundWithOperation(PAYLOAD, request);
  assert.equal(res.ok, false);
  assert.equal(pendingOperation(refundAttemptKey(42)), null);
  await sendRefundWithOperation(PAYLOAD, request);
  assert.notEqual(bodies[0].operationId, bodies[1].operationId);
});

test("network error, 503 and 409 IN_PROGRESS keep the attempt: the retry resends the same id", async () => {
  const { bodies, request } = recorder([
    { ok: false, msg: "Network Error", status: 0, result: null },
    { ok: false, msg: "CRM did not answer", status: 503, result: null },
    { ok: false, msg: "in progress", status: 409, result: { code: "OPERATION_IN_PROGRESS" } },
    { ok: true, msg: "", result: { id: 12, replayed: true } },
  ]);
  for (let i = 0; i < 3; i++) await sendRefundWithOperation(PAYLOAD, request);
  assert.notEqual(pendingOperation(refundAttemptKey(42)), null);
  const res = await sendRefundWithOperation(PAYLOAD, request);
  assert.equal(res.result.replayed, true);
  assert.equal(new Set(bodies.map((b) => b.operationId)).size, 1, "one id across every retry");
  assert.equal(pendingOperation(refundAttemptKey(42)), null);
});

test("attempts are per original invoice", async () => {
  const { bodies, request } = recorder([
    { ok: false, msg: "Network Error", status: 0, result: null },
    { ok: false, msg: "Network Error", status: 0, result: null },
  ]);
  await sendRefundWithOperation(PAYLOAD, request);
  await sendRefundWithOperation({ ...PAYLOAD, originalInvoiceId: 43 }, request);
  assert.notEqual(bodies[0].operationId, bodies[1].operationId);
});
