// T-15 — till operation-id helper (review F-4/F-5).
// Run: node --experimental-strip-types --test src/renderer/src/libs/operation-id.test.mjs
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const m = await import("./operation-id.ts");

beforeEach(() => store.clear());

test("F-4: two carts never share an id — an identical cart B is its own attempt", () => {
  const a = m.operationIdFor(m.saleAttemptKey(0));
  const b = m.operationIdFor(m.saleAttemptKey(1)); // identical contents do not matter
  assert.notEqual(a, b);
});

test("F-4: cart B's attempt does not overwrite cart A's unresolved attempt", () => {
  const a = m.operationIdFor(m.saleAttemptKey(0));
  m.settleOperation(m.saleAttemptKey(0), { ok: false, result: null }); // lost response
  const b = m.operationIdFor(m.saleAttemptKey(1));
  m.settleOperation(m.saleAttemptKey(1), { ok: true }); // B recorded
  assert.equal(m.operationIdFor(m.saleAttemptKey(0)), a, "A still retries with its own id");
  assert.notEqual(m.operationIdFor(m.saleAttemptKey(1)), b, "B's next sale is a new attempt");
});

test("F-5: an unchanged retry after any delay reuses the id (no expiry)", () => {
  const key = m.saleAttemptKey(2);
  const a = m.operationIdFor(key, 0);
  m.settleOperation(key, { ok: false, result: { code: "CUSTOMER_VOUCHER_UNRESOLVED" } });
  assert.equal(m.operationIdFor(key, 0 + 365 * 24 * 60 * 60 * 1000), a);
});

test("the attempt survives payload changes, 5xx and IN_PROGRESS; ends on ok, settling 409s or cart clear", () => {
  const key = m.saleAttemptKey(0);
  const a = m.operationIdFor(key);
  m.settleOperation(key, { ok: false, result: { code: "OPERATION_IN_PROGRESS" } });
  m.settleOperation(key, { ok: false, result: null });
  assert.equal(m.operationIdFor(key), a);

  m.settleOperation(key, { ok: false, result: { code: "OPERATION_CANCELLED" } });
  const b = m.operationIdFor(key);
  assert.notEqual(b, a);
  m.settleOperation(key, { ok: false, result: { code: "OPERATION_PAYLOAD_MISMATCH" } });
  const c = m.operationIdFor(key);
  assert.notEqual(c, b);
  m.clearOperation(key); // cashier cleared the cart
  const d = m.operationIdFor(key);
  assert.notEqual(d, c);
  m.settleOperation(key, { ok: true });
  assert.notEqual(m.operationIdFor(key), d);
});

test("refund and repay attempts are keyed by original invoice", () => {
  assert.notEqual(m.operationIdFor(m.refundAttemptKey(50)), m.operationIdFor(m.refundAttemptKey(51)));
  assert.equal(m.operationIdFor(m.refundAttemptKey(50)), m.operationIdFor(m.refundAttemptKey(50)));
  assert.notEqual(m.operationIdFor(m.repayAttemptKey(50)), m.operationIdFor(m.refundAttemptKey(50)));
});

test("F-7: a cart the cashier empties by any path ends its attempt; non-empty carts keep theirs", () => {
  const a = m.operationIdFor(m.saleAttemptKey(0));
  const b = m.operationIdFor(m.saleAttemptKey(1));
  // slot 0 had lines and was emptied (Clear / last line removed / qty 0); slot 1 still has lines
  m.endAttemptsOfEmptiedCarts([2, 3, 0, 0], [0, 3, 0, 0]);
  assert.notEqual(m.operationIdFor(m.saleAttemptKey(0)), a, "identical new sale in slot 0 is a new attempt");
  assert.equal(m.operationIdFor(m.saleAttemptKey(1)), b);
});

test("F-9: carts that start empty (till start) keep persisted attempts", () => {
  const a = m.operationIdFor(m.saleAttemptKey(0)); // persisted before the restart
  // store init: every cart empty before and after — no abandonment
  m.endAttemptsOfEmptiedCarts([0, 0, 0, 0], [0, 0, 0, 0]);
  // cashier rings the sale again in that slot: lines added, then retried
  m.endAttemptsOfEmptiedCarts([0, 0, 0, 0], [1, 0, 0, 0]);
  assert.equal(m.operationIdFor(m.saleAttemptKey(0)), a, "retry after restart replays the same attempt");
});

test("T-17 V-5: exchange press — a retry after a lost answer reuses the id; ok ends the attempt", async () => {
  const key = m.customerVoucherIssueAttemptKey("member-1");
  assert.equal(key, "cv-issue:member-1");
  const sent = [];
  const lost = { ok: false, status: 0, msg: "Network Error", result: null };
  const ok = { ok: true, status: 200, msg: "Customer voucher already issued", result: { voucher: { id: 1 } } };

  await m.sendWithOperation(key, async (operationId) => (sent.push(operationId), lost));
  await m.sendWithOperation(key, async (operationId) => (sent.push(operationId), ok));
  assert.equal(sent[1], sent[0], "the retry resends the first press's id");

  await m.sendWithOperation(key, async (operationId) => (sent.push(operationId), ok));
  assert.notEqual(sent[2], sent[0], "after ok the next press is a new exchange");
});

test("T-17 V-5: exchange id survives a restart (persisted) and is per member", async () => {
  const a = m.operationIdFor(m.customerVoucherIssueAttemptKey("member-1"));
  m.settleOperation(m.customerVoucherIssueAttemptKey("member-1"), { ok: false, result: null });
  // a till restart re-imports the module; the id lives in localStorage
  const again = await import("./operation-id.ts?restart");
  assert.equal(again.operationIdFor(again.customerVoucherIssueAttemptKey("member-1")), a);
  assert.notEqual(m.operationIdFor(m.customerVoucherIssueAttemptKey("member-2")), a);
  assert.notEqual(m.operationIdFor(m.saleAttemptKey(0)), a, "exchange and checkout attempts never share an id");
});

// retail-delivery D-24 review round 1 — one pending exchange per member; the
// chosen amount is stored with the attempt; previous-release records have none.

const { pendingVoucherIssueFromAttempt } = await import("./customer-voucher-issue.ts");

test("D-24: the payload is stored with a newly minted attempt and kept on retries", () => {
  const key = m.customerVoucherIssueAttemptKey("member-1");
  const id = m.operationIdFor(key, 1000, { amount: 2500 });
  assert.deepEqual(JSON.parse(store.get("ktpv5.operationAttempt.cv-issue:member-1")), {
    operationId: id,
    createdAt: 1000,
    payload: { amount: 2500 },
  });
  // a later call (even with another payload) reuses the attempt and its payload
  assert.equal(m.operationIdFor(key, 2000, { amount: 10000 }), id);
  assert.deepEqual(m.pendingOperation(key), { operationId: id, createdAt: 1000, payload: { amount: 2500 } });
  assert.deepEqual(pendingVoucherIssueFromAttempt(m.pendingOperation(key)), { amount: 2500 });
});

test("D-24: an attempt without payload keeps the previous storage format", () => {
  const id = m.operationIdFor(m.saleAttemptKey(0), 5);
  assert.deepEqual(JSON.parse(store.get("ktpv5.operationAttempt.sale:cart:0")), { operationId: id, createdAt: 5 });
  assert.equal("payload" in m.pendingOperation(m.saleAttemptKey(0)), false);
});

test("D-24: a previous-release record (cv-issue:<memberId>, no payload) is pending with amount undefined", () => {
  const legacyId = "3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f";
  store.set("ktpv5.operationAttempt.cv-issue:member-1", JSON.stringify({ operationId: legacyId, createdAt: 1 }));
  const key = m.customerVoucherIssueAttemptKey("member-1");
  assert.equal(m.pendingOperation(key).operationId, legacyId);
  assert.deepEqual(pendingVoucherIssueFromAttempt(m.pendingOperation(key)), { amount: undefined });
  assert.equal(m.operationIdFor(key), legacyId, "the retry resends the previous release's id");
});

test("D-24: pendingOperation never mints; sendWithOperation records the payload and an ok answer ends it", async () => {
  const key = m.customerVoucherIssueAttemptKey("member-3");
  assert.equal(m.pendingOperation(key), null);
  assert.equal(store.size, 0);
  const lost = { ok: false, status: 0, msg: "Network Error", result: null };
  await m.sendWithOperation(key, async () => lost, { amount: 5000 });
  assert.deepEqual(pendingVoucherIssueFromAttempt(m.pendingOperation(key)), { amount: 5000 });
  await m.sendWithOperation(key, async () => ({ ok: true, result: { voucher: { id: 1 } } }));
  assert.equal(m.pendingOperation(key), null);
});

test("D-24: a malformed payload is ignored", () => {
  store.set("ktpv5.operationAttempt.cv-issue:member-4", JSON.stringify({ operationId: "abcdefgh-1234", createdAt: 1, payload: [1] }));
  const attempt = m.pendingOperation(m.customerVoucherIssueAttemptKey("member-4"));
  assert.equal("payload" in attempt, false);
  assert.deepEqual(pendingVoucherIssueFromAttempt(attempt), { amount: undefined });
});
