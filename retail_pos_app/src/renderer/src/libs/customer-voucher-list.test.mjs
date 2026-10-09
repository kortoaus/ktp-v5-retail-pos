// npm run test:orders — T-25 (T-14 V-10): voucher list states and member badges.
import assert from "node:assert/strict";
import test from "node:test";

const { voucherListStateFromAnswer, memberVoucherIndicators, VOUCHER_LIST_UNAVAILABLE } = await import(
  "./customer-voucher-list.ts"
);

const NOW = new Date("2026-10-09T01:00:00.000Z");
const v = (over = {}) => ({
  id: 1,
  memberId: "m-1",
  serial: "CV-1",
  kind: "REFUND",
  initAmount: 500,
  balance: 500,
  status: "ACTIVE",
  validFrom: "2026-10-01T00:00:00.000Z",
  validTo: "2026-10-31T12:59:59.999Z",
  label: "CV-1",
  ...over,
});

test("list failure → unavailable (Retry), never 'No vouchers'", () => {
  for (const answer of [
    { ok: false, msg: "CRM customer voucher service unavailable", result: null },
    { ok: true, result: null },
    null,
  ]) {
    assert.deepEqual(voucherListStateFromAnswer(answer, NOW), { kind: "unavailable", message: VOUCHER_LIST_UNAVAILABLE });
  }
});

test("empty answer → empty; only ineligible vouchers → empty", () => {
  assert.deepEqual(voucherListStateFromAnswer({ ok: true, result: [] }, NOW), { kind: "empty" });
  const ineligible = [v({ balance: 0 }), v({ id: 2, status: "EXPIRED" }), v({ id: 3, validTo: "2026-10-08T12:59:59.999Z" })];
  assert.deepEqual(voucherListStateFromAnswer({ ok: true, result: ineligible }, NOW), { kind: "empty" });
});

test("eligible vouchers → ready with the rows", () => {
  const state = voucherListStateFromAnswer({ ok: true, result: [v(), v({ id: 2, balance: 0 })] }, NOW);
  assert.equal(state.kind, "ready");
  assert.deepEqual(state.rows.map((r) => r.id), [1]);
});

test("badge: a refund voucher with few points → 'Voucher available', exchange not ready", () => {
  const ind = memberVoucherIndicators({
    state: voucherListStateFromAnswer({ ok: true, result: [v({ balance: 300 })] }, NOW),
    points: 120,
    issuePoints: 1000,
  });
  assert.deepEqual(ind, { voucherBadge: "available", ownedBalance: 300, exchangeReady: false });
});

test("badge: enough points but no owned voucher → exchange ready, badge 'none' (separate indicators)", () => {
  const ind = memberVoucherIndicators({ state: { kind: "empty" }, points: 1500, issuePoints: 1000 });
  assert.deepEqual(ind, { voucherBadge: "none", ownedBalance: 0, exchangeReady: true });
});

test("badge: CRM unavailable or still loading → unknown, never 'available'", () => {
  for (const state of [{ kind: "loading" }, { kind: "unavailable", message: "x" }]) {
    const ind = memberVoucherIndicators({ state, points: null, issuePoints: 1000 });
    assert.equal(ind.voucherBadge, "unknown");
    assert.equal(ind.ownedBalance, null);
    assert.equal(ind.exchangeReady, false);
  }
});
