// T-15 — till operation-id helper. Run: node --experimental-strip-types --test src/renderer/src/libs/operation-id.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const m = await import("./operation-id.ts");
test("same cart reuses, changed cart new, ok clears, cancel clears, network keeps, TTL", () => {
  const cart = { rows: [{ a: 1 }], payments: [{ type: "CASH", amount: 100 }] };
  const a = m.operationIdFor("sale", cart);
  assert.equal(m.operationIdFor("sale", { payments: cart.payments, rows: cart.rows }), a);
  m.settleOperation("sale", { ok: false, result: null });
  assert.equal(m.operationIdFor("sale", cart), a, "network error keeps");
  const b = m.operationIdFor("sale", { ...cart, note: "x" });
  assert.notEqual(b, a);
  m.settleOperation("sale", { ok: false, result: { code: "OPERATION_CANCELLED" } });
  const c = m.operationIdFor("sale", { ...cart, note: "x" });
  assert.notEqual(c, b);
  m.settleOperation("sale", { ok: true });
  assert.notEqual(m.operationIdFor("sale", { ...cart, note: "x" }), c);
  const d = m.operationIdFor("refund", cart, 0);
  assert.notEqual(m.operationIdFor("refund", cart, 16 * 60 * 1000), d, "TTL");
});
