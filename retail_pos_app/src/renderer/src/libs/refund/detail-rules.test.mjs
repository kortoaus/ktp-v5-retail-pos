// npm run test:sale-core — retail-runner T-16 (S-4 §3): the till's Refund
// detail-screen rules, hoisted into libs/refund/detail-rules.ts.
import assert from "node:assert/strict";
import test from "node:test";

const r = await import("./detail-rules.ts");
const { computeInvoice, computeTenderCaps } = await import("./compute.ts");

const row = (id, type, qty, total, over = {}) => ({
  id,
  type,
  qty,
  total,
  surcharge_share: 0,
  refunded_qty: 0,
  taxable: false,
  tax_amount: 0,
  isPointExcluded: false,
  ...over,
});
const pay = (type, amount, over = {}) => ({
  id: amount,
  type,
  amount,
  entityType: null,
  entityId: null,
  entityLabel: null,
  createdAt: "2026-10-28T00:00:00.000Z",
  ...over,
});
const invoiceOf = (rows, payments, refunds = []) => ({ id: 7, rows, payments, refunds });

const CASH_CREDIT = invoiceOf(
  [row(1, "NORMAL", 3000, 3003), row(2, "WEIGHT", 1250, 1000)],
  [pay("CASH", 2000), pay("CREDIT", 2003)],
);

test("all-cash mode: cash > 0 and every non-cash tender 0", () => {
  const caps = computeTenderCaps(CASH_CREDIT);
  assert.equal(r.isAllCashMode(caps, {}), false, "nothing entered");
  assert.equal(r.isAllCashMode(caps, { CASH: 500 }), true);
  assert.equal(r.isAllCashMode(caps, { CASH: 500, CREDIT: 0 }), true);
  assert.equal(r.isAllCashMode(caps, { CASH: 500, CREDIT: 1 }), false);
  assert.equal(r.isAllCashMode(caps, { CREDIT: 500 }), false);
});

test("row qty clamp: 0 … refundable; weighed rows whole only", () => {
  const normal = row(1, "NORMAL", 3000, 3003, { refunded_qty: 1000 });
  assert.equal(r.clampRowQty(normal, 5000), 2000);
  assert.equal(r.clampRowQty(normal, -1000), 0);
  assert.equal(r.clampRowQty(normal, 1000), 1000);
  assert.deepEqual(r.withRowQty({ 9: 1000 }, normal, 9000), { 9: 1000, 1: 2000 });
  assert.deepEqual(r.withRowRefundAll({}, normal), { 1: 2000 });
  const weighedPartly = row(2, "WEIGHT", 1250, 1000, { refunded_qty: 250 });
  assert.equal(r.clampRowQty(weighedPartly, 1000), 0, "partly refunded weighed row is not refundable");
});

test("Refund All Rows replaces the selection; Clear empties rows and tenders", () => {
  assert.deepEqual(r.refundAllRowsSelection(CASH_CREDIT.rows), { 1: 3000, 2: 1250 });
  assert.deepEqual(r.clearedRefundInputs(), { selections: {}, tenderAmounts: {} });
});

test("tender amount clamps to the cap on Set; unknown tender is ignored", () => {
  const caps = computeTenderCaps(CASH_CREDIT);
  assert.equal(r.clampTenderAmount(caps, "CASH", 99999), 2000);
  assert.equal(r.clampTenderAmount(caps, "CASH", -5), 0);
  assert.equal(r.clampTenderAmount(caps, "CREDIT", 1500), 1500);
  assert.equal(r.clampTenderAmount(caps, "GIFTCARD", 100), null);
});

test("Fill: cash-only refund fills the round-5 total", () => {
  const inv = invoiceOf([row(1, "NORMAL", 1000, 1003)], [pay("CASH", 2000), pay("CREDIT", 500)]);
  const caps = computeTenderCaps(inv);
  const sel = { 1: 1000 };
  const before = computeInvoice(inv, sel, { allCashMode: false });
  assert.equal(before.subtotalBeforeRounding, 1003);
  const cash = r.fillTenderAmount(caps, {}, "CASH", before.subtotalBeforeRounding);
  assert.equal(cash, 1005);
  // The till's next render: all-cash mode → total rounds the same way → Remaining 0.
  const tenders = { CASH: cash };
  const allCash = r.isAllCashMode(caps, tenders);
  const after = computeInvoice(inv, sel, { allCashMode: allCash });
  const paid = r.refundPaid(tenders);
  const remaining = r.refundRemaining(after.total, paid);
  assert.equal(after.total, 1005);
  assert.equal(remaining, 0);
  assert.equal(r.canCompleteRefund(sel, after.total, remaining), true);
  // 1002 rounds down.
  assert.equal(r.fillTenderAmount(caps, {}, "CASH", 1002), 1000);
});

test("Fill: with a card tender entered there is no rounding", () => {
  const caps = computeTenderCaps(CASH_CREDIT);
  assert.equal(r.fillTenderAmount(caps, { CREDIT: 500 }, "CASH", 1003), 503);
  assert.equal(r.fillTenderAmount(caps, {}, "CREDIT", 1003), 1003, "card fills exact");
  assert.equal(r.fillTenderAmount(caps, { CASH: 300 }, "CREDIT", 1003), 703);
  assert.equal(r.fillTenderAmount(caps, {}, "CREDIT", 5000), 2003, "clamped to the cap");
  assert.equal(r.fillTenderAmount(caps, { CASH: 2000, CREDIT: 2003 }, "CASH", 1003), 0, "never negative");
  assert.equal(r.fillTenderAmount(caps, {}, "GIFTCARD", 1003), null);
});

test("canComplete: a row, a positive total and Remaining 0", () => {
  assert.equal(r.canCompleteRefund({ 1: 1000 }, 1003, 0), true);
  assert.equal(r.canCompleteRefund({}, 1003, 0), false, "no row");
  assert.equal(r.canCompleteRefund({ 1: 0 }, 1003, 0), false, "zero-qty row only");
  assert.equal(r.canCompleteRefund({ 1: 1000 }, 0, 0), false, "zero total");
  assert.equal(r.canCompleteRefund({ 1: 1000 }, 1003, 3), false, "under-allocated");
  assert.equal(r.canCompleteRefund({ 1: 1000 }, 1003, -2), false, "over-allocated");
  assert.equal(r.anyRefundRowSelected({ 1: 0, 2: 250 }), true);
});

test("drawer opens only when the refund sends cash", () => {
  assert.equal(r.refundOpensDrawer([{ type: "CASH", amount: 505 }, { type: "CREDIT", amount: 100 }]), true);
  assert.equal(r.refundCashAmount([{ type: "CASH", amount: 505 }, { type: "CASH", amount: 5 }]), 510);
  assert.equal(r.refundOpensDrawer([{ type: "CREDIT", amount: 100 }, { type: "VOUCHER", amount: 50 }]), false);
  assert.equal(r.refundOpensDrawer([]), false);
});

test("review / confirm texts are the till's", () => {
  assert.equal(r.REFUND_TEXTS.reviewTitle, "Review Refund");
  assert.equal(r.REFUND_TEXTS.confirmTitle, "⚠ Confirm Refund");
  assert.equal(r.REFUND_TEXTS.confirmSubmit, "REFUND NOW");
  assert.match(r.REFUND_TEXTS.confirmWarning, /EFTPOS \/ gift card entries must be keyed in manually on the terminal\.$/);
  assert.equal(
    r.refundConfirmSentence("$10.05", "3-20261028-S12"),
    "$10.05 will be refunded from invoice 3-20261028-S12.",
  );
});
