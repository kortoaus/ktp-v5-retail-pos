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
