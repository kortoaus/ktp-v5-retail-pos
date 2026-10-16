// npm run test:sale-core (retail-runner T-1) — tender queue reducer + selector.
import assert from "node:assert/strict";
import test from "node:test";

import {
  changeSlotDecision,
  createTenderState,
  paymentTypesFor,
  readyStagedPayment,
  removePaymentPrompt,
  selectTender,
  tenderRates,
  tenderReducer,
} from "./tender-queue.ts";
import { buildNewLine } from "../../store/SalesStore.helper.ts";

const RATES = { creditSurchargeRate: 15, cashPointRate: 10, otherPointRate: 10 };

// One taxable normal line at `cents` (qty 1).
function line(cents, index = 0) {
  return buildNewLine(
    {
      type: "normal",
      itemId: index + 1,
      name_en: `Item ${index}`,
      name_ko: "",
      price: { prices: [cents] },
      promoPrice: null,
      taxable: true,
      isPointExcluded: false,
      uom: "ea",
      barcode: String(index),
    },
    0,
    index,
  );
}

const run = (state, ...actions) => actions.reduce(tenderReducer, state);
const view = (state, lines, hasMember = false) =>
  selectTender(state, { lines, rates: RATES, hasMember });
let n = 0;
const commit = () => ({ type: "commit-staged", key: `k${++n}` });

// ── CASH ─────────────────────────────────────────────────────
test("CASH: 5c rounding down, change from the rounded due", () => {
  const lines = [line(1002)];
  const s = run(createTenderState(), { type: "set-cash-received", cashReceived: 2000 });
  const v = view(s, lines);
  assert.equal(v.cal.rounding, -2);
  assert.equal(v.cal.due, 1000);
  assert.equal(v.cal.total, 1000);
  assert.equal(v.cal.change, 1000);
  assert.equal(v.cal.remaining, 0);
  assert.equal(v.completeDisabled, false);
  assert.equal(v.exactCashAmount, 1000, "EXACT offers round5(left)");
  assert.equal(v.derivedPayments.length, 1);
  assert.equal(v.derivedPayments[0].amount, 1000, "staged cash shows its allocation");
});

test("CASH: 5c rounding up; short cash leaves the unrounded remainder", () => {
  const lines = [line(1003)];
  const paid = view(run(createTenderState(), { type: "set-cash-received", cashReceived: 1005 }), lines);
  assert.equal(paid.cal.rounding, 2);
  assert.equal(paid.cal.total, 1005);
  assert.equal(paid.cal.change, 0);

  const short = view(run(createTenderState(), { type: "set-cash-received", cashReceived: 500 }), lines);
  assert.equal(short.cal.rounding, 0);
  assert.equal(short.cal.remaining, 503);
  assert.equal(short.completeDisabled, true);
});

test("CASH: multi-cash splits allocate FIFO (committed first, staged last)", () => {
  const lines = [line(1500)];
  const s = run(
    createTenderState(),
    { type: "set-cash-received", cashReceived: 1000 },
    commit(),
    { type: "set-cash-received", cashReceived: 1000 },
  );
  assert.equal(s.payments.length, 1);
  assert.equal(s.staged.tender, "CASH", "commit keeps the same slot");
  const v = view(s, lines);
  assert.deepEqual(
    v.derivedPayments.map((p) => [p.key === "staged" ? "staged" : "committed", p.amount]),
    [
      ["staged", 500],
      ["committed", 1000],
    ],
  );
  assert.equal(v.cal.change, 500);
  assert.equal(v.tenderSums.get("CASH"), 1500);
});

// ── CREDIT ───────────────────────────────────────────────────
test("CREDIT partial: bill portion stored as EFTPOS amount, surcharge on top", () => {
  const lines = [line(10000)];
  let s = run(
    createTenderState(),
    { type: "change-slot", slot: "CREDIT" },
    { type: "set-credit-bill", billPortion: 4000, left: 10000, surchargeRate: 15 },
  );
  assert.deepEqual(s.staged, { key: "staged", tender: "CREDIT", amount: 4060 });
  s = run(s, commit());
  const v = view(s, lines);
  assert.equal(v.left, 6000);
  assert.equal(v.cal.creditSurcharge, 60);
  assert.equal(v.cal.total, 10060);
  assert.equal(v.cal.remaining, 6000);
  assert.equal(v.cal.rounding, 0);
  assert.equal(v.exactCashAmount, 6000, "no 5c rounding once an exact tender is in");
  assert.equal(v.cashLocked, true);
  assert.equal(v.completeDisabled, true);
});

test("CREDIT: input capped at left; clamp when left shrinks", () => {
  let s = run(
    createTenderState(),
    { type: "change-slot", slot: "CREDIT" },
    { type: "set-credit-bill", billPortion: 999999, left: 2000, surchargeRate: 15 },
  );
  assert.equal(s.staged.amount, 2030);
  const same = tenderReducer(s, { type: "clamp-credit", left: 5000, surchargeRate: 15 });
  assert.equal(same, s, "no change when the bill still fits");
  s = tenderReducer(s, { type: "clamp-credit", left: 1000, surchargeRate: 15 });
  assert.equal(s.staged.amount, 1015);
});

// ── GIFTCARD ─────────────────────────────────────────────────
test("GIFTCARD: no surcharge, capped at left, settles exactly", () => {
  const lines = [line(2501)];
  const s = run(
    createTenderState(),
    { type: "change-slot", slot: "GIFTCARD" },
    { type: "set-giftcard-amount", amount: 9999, left: 2501 },
  );
  assert.equal(s.staged.amount, 2501);
  const v = view(s, lines);
  assert.equal(v.cal.creditSurcharge, 0);
  assert.equal(v.cal.rounding, 0);
  assert.equal(v.cal.total, 2501);
  assert.equal(v.cal.remaining, 0);
  assert.equal(v.completeDisabled, false);
  assert.equal(v.tenderSums.get("GIFTCARD"), 2501);
  assert.equal(readyStagedPayment(s.staged), s.staged, "1-step Complete includes it");
});

// ── split ────────────────────────────────────────────────────
test("split CASH + CREDIT: cash first, credit takes the rest, no rounding", () => {
  const lines = [line(10001)];
  let s = run(createTenderState(), { type: "set-cash-received", cashReceived: 5000 }, commit());
  let v = view(s, lines);
  assert.equal(v.left, 5001);
  s = run(
    s,
    { type: "change-slot", slot: "CREDIT" },
    { type: "set-credit-bill", billPortion: v.left, left: v.left, surchargeRate: 15 },
  );
  v = view(s, lines);
  assert.equal(s.staged.amount, 5076);
  assert.equal(v.cal.rounding, 0);
  assert.equal(v.cal.cashApplied, 5000);
  assert.equal(v.cal.remaining, 0);
  assert.equal(v.cal.total, 10001 + 75);
  assert.equal(v.cal.change, 0);
  assert.equal(v.completeDisabled, false);
});

test("split VOUCHER + CASH: cash remainder still rounds to 5c", () => {
  const lines = [line(1003)];
  const s = run(
    createTenderState(),
    { type: "change-slot", slot: "USER_VOUCHER" },
    { type: "select-user-voucher", user: { id: 1, name: "Kim" }, voucher: { id: 3, balance: 500 } },
    { type: "set-user-voucher-amount", amount: 500 },
    commit(),
    { type: "change-slot", slot: "CASH" },
    { type: "set-cash-received", cashReceived: 1000 },
  );
  const v = view(s, lines);
  assert.equal(v.cal.rounding, 2, "503 → 505");
  assert.equal(v.cal.total, 1005);
  assert.equal(v.cal.change, 495);
  assert.equal(v.voucherLocked, false, "only vouchers committed so far");
});

// ── vouchers ─────────────────────────────────────────────────
test("Staff Voucher: select, amount relabels balance, commit, remove", () => {
  const voucher = { id: 3, balance: 2000, extra: "kept" };
  let s = run(
    createTenderState(),
    { type: "change-slot", slot: "USER_VOUCHER" },
    { type: "select-user-voucher", user: { id: 1, name: "Kim" }, voucher },
  );
  assert.equal(s.stagedVoucher, voucher, "whole object kept for the input");
  assert.equal(s.staged.entityLabel, "Kim - Est. balance $20.00");
  s = tenderReducer(s, { type: "set-user-voucher-amount", amount: 500 });
  assert.equal(s.staged.amount, 500);
  assert.equal(s.staged.entityLabel, "Kim - Est. balance $15.00");
  s = tenderReducer(s, { type: "commit-staged", key: "v1" });
  assert.equal(s.payments.length, 1);
  assert.equal(s.stagedVoucher, null);
  assert.equal(s.stagedVoucherUserName, null);
  assert.equal(s.staged.entityType, "user-voucher", "fresh draft of the same slot");
  assert.equal(s.staged.entityId, 0);
  assert.deepEqual(view(s, [line(3000)]).usedUserVoucherIds, [3]);

  assert.equal(removePaymentPrompt(s.payments, "v1"), "Remove VOUCHER payment ($5.00)?");
  assert.equal(removePaymentPrompt(s.payments, "nope"), null);
  s = tenderReducer(s, { type: "remove-payment", key: "v1" });
  assert.deepEqual(s.payments, []);
});

test("Customer Voucher: select, amount, commit; voucher without entity cannot commit", () => {
  let s = run(createTenderState(), { type: "change-slot", slot: "CUSTOMER_VOUCHER" });
  s = tenderReducer(s, { type: "set-customer-voucher-amount", amount: 300 });
  const blocked = tenderReducer(s, commit());
  assert.equal(blocked, s, "entityId 0 = none selected");

  s = run(
    s,
    { type: "select-customer-voucher", voucher: { id: 77, label: "CV-77" } },
    { type: "set-customer-voucher-amount", amount: 300 },
    { type: "commit-staged", key: "c1" },
  );
  assert.equal(s.payments[0].entityLabel, "CV-77");
  assert.equal(s.payments[0].amount, 300);
  assert.equal(s.stagedCustomerVoucher, null);
  const v = view(s, [line(1000)], true);
  assert.deepEqual(v.usedCustomerVoucherIds, [77]);
  assert.equal(v.tenderSums.get("CUSTOMER_VOUCHER"), 300);
});

// ── slot rules ───────────────────────────────────────────────
test("slot locks: vouchers lead; exact tenders lock cash", () => {
  const afterCash = run(createTenderState(), { type: "set-cash-received", cashReceived: 100 }, commit());
  assert.deepEqual(changeSlotDecision(afterCash, "USER_VOUCHER"), { kind: "ignore" });
  assert.equal(tenderReducer(afterCash, { type: "change-slot", slot: "USER_VOUCHER" }), afterCash);

  const afterCard = run(
    createTenderState(),
    { type: "change-slot", slot: "GIFTCARD" },
    { type: "set-giftcard-amount", amount: 100, left: 1000 },
    commit(),
  );
  assert.deepEqual(changeSlotDecision(afterCard, "CASH"), { kind: "ignore" });
  assert.deepEqual(changeSlotDecision(afterCard, "CREDIT"), { kind: "switch" });
});

test("changing slot with a draft asks first; the switch drops the draft and vouchers", () => {
  const s = run(
    createTenderState(),
    { type: "change-slot", slot: "USER_VOUCHER" },
    { type: "select-user-voucher", user: { id: 1, name: "Kim" }, voucher: { id: 3, balance: 900 } },
    { type: "set-user-voucher-amount", amount: 250 },
  );
  assert.deepEqual(changeSlotDecision(s, "CASH"), {
    kind: "confirm",
    message: "Discard staged USER VOUCHER ($2.50) and switch to CASH?",
  });
  assert.deepEqual(changeSlotDecision(s, "USER_VOUCHER"), { kind: "ignore" });
  const next = tenderReducer(s, { type: "change-slot", slot: "CASH" });
  assert.deepEqual(next.staged, { key: "staged", tender: "CASH", amount: 0, cashReceived: 0 });
  assert.equal(next.stagedVoucher, null);
  assert.equal(next.stagedVoucherUserName, null);
});

test("empty drafts do not commit; empty draft is hidden from the list", () => {
  const s = createTenderState();
  assert.equal(tenderReducer(s, commit()), s);
  assert.deepEqual(view(s, [line(100)]).derivedPayments, []);
  assert.equal(readyStagedPayment(s.staged), undefined);
});

test("SPEND toggle and member change reset every tender", () => {
  const busy = run(
    createTenderState(),
    { type: "set-cash-received", cashReceived: 100 },
    commit(),
    { type: "set-customer-voucher-member-points", memberPoints: 40 },
  );
  const spend = tenderReducer(busy, { type: "toggle-spend" });
  assert.equal(spend.spendMode, true);
  assert.deepEqual(spend.payments, []);
  assert.equal(spend.staged.cashReceived, 0);
  assert.equal(spend.customerVoucherMemberPoints, 40, "SPEND keeps exchanged points");
  assert.equal(tenderReducer(spend, { type: "toggle-spend" }).spendMode, false);

  const member = tenderReducer(busy, { type: "member-changed" });
  assert.deepEqual(member.payments, []);
  assert.equal(member.customerVoucherMemberPoints, null);
});

test("COMPLETE stays disabled for an empty or $0 cart", () => {
  const s = run(createTenderState(), { type: "set-cash-received", cashReceived: 100 });
  assert.equal(view(s, []).completeDisabled, true);
  assert.equal(view(createTenderState(), [line(0)]).completeDisabled, true);
});

test("store-rate fallbacks and picker order", () => {
  assert.deepEqual(tenderRates(null), RATES);
  assert.deepEqual(
    tenderRates({ credit_surcharge_rate: 20, cash_point_rate: null, other_point_rate: 5 }),
    { creditSurchargeRate: 20, cashPointRate: 10, otherPointRate: 5 },
  );
  assert.deepEqual(paymentTypesFor(false), ["USER_VOUCHER", "CASH", "CREDIT", "GIFTCARD"]);
  assert.deepEqual(paymentTypesFor(true), ["CUSTOMER_VOUCHER", "CASH", "CREDIT", "GIFTCARD"]);
});
