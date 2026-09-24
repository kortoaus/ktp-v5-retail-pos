// node --experimental-strip-types src/renderer/src/components/orders/order-payment-alerts.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrderPaymentAlerts,
  getOrderPaymentStateLabel,
  isOrderCharged,
} from "./order-payment-alerts.ts";

const NOW = Date.parse("2026-09-24T10:00:00Z");
const base = {
  paymentMethod: "STRIPE",
  payment: { state: "AUTHORIZED", refundDue: false, lastError: null },
  autoVoidAt: null,
  autoVoidSoon: false,
};

test("in-store orders never get payment alerts", () => {
  assert.deepEqual(
    getOrderPaymentAlerts(
      {
        ...base,
        paymentMethod: "IN_STORE",
        payment: { state: "UNPAID", refundDue: true, lastError: "X" },
        autoVoidSoon: true,
        autoVoidAt: "2026-09-24T12:00:00Z",
      },
      NOW,
    ),
    [],
  );
});

test("healthy authorised stripe order has no alerts", () => {
  assert.deepEqual(getOrderPaymentAlerts(base, NOW), []);
});

test("AUTH_EXPIRED shows card hold expired; other codes show the code", () => {
  const expired = getOrderPaymentAlerts(
    { ...base, payment: { ...base.payment, state: "VOIDED", lastError: "AUTH_EXPIRED" } },
    NOW,
  );
  assert.deepEqual(expired.map((a) => [a.key, a.label, a.tone]), [
    ["captureFailed", "Card hold expired", "red"],
  ]);
  const other = getOrderPaymentAlerts(
    { ...base, payment: { ...base.payment, lastError: "card_declined" } },
    NOW,
  );
  assert.equal(other[0].label, "Payment failed (card_declined)");
});

test("refundDue and auto-void-soon (hours rounded up from server autoVoidAt)", () => {
  const alerts = getOrderPaymentAlerts(
    {
      ...base,
      payment: { ...base.payment, refundDue: true },
      autoVoidSoon: true,
      autoVoidAt: "2026-09-24T20:30:00Z",
    },
    NOW,
  );
  assert.deepEqual(alerts.map((a) => a.key), ["refundDue", "autoVoidSoon"]);
  assert.equal(alerts[1].label, "Auto-cancels in 11h — schedule now");
  assert.equal(alerts[1].tone, "amber");
});

test("autoVoidSoon without autoVoidAt shows nothing; past due clamps to 0h", () => {
  assert.deepEqual(getOrderPaymentAlerts({ ...base, autoVoidSoon: true }, NOW), []);
  const past = getOrderPaymentAlerts(
    { ...base, autoVoidSoon: true, autoVoidAt: "2026-09-24T09:00:00Z" },
    NOW,
  );
  assert.equal(past[0].label, "Auto-cancels in 0h — schedule now");
});

test("state labels and charged check", () => {
  assert.equal(getOrderPaymentStateLabel("CAPTURED"), "Charged to card");
  assert.equal(isOrderCharged({ ...base, payment: { ...base.payment, state: "CAPTURED" } }), true);
  assert.equal(isOrderCharged(base), false);
  assert.equal(
    isOrderCharged({ paymentMethod: "IN_STORE", payment: { state: "PAID", refundDue: false, lastError: null } }),
    false,
  );
});

test("payment method line: brand •••• last4, wallet wraps the card, unknown brand title-cased", async () => {
  const { formatOrderPaymentMethod } = await import("./order-payment-alerts.ts");
  assert.equal(
    formatOrderPaymentMethod({ brand: "visa", last4: "4242", wallet: null }),
    "Visa •••• 4242",
  );
  assert.equal(
    formatOrderPaymentMethod({ brand: "mastercard", last4: "0716", wallet: "apple_pay" }),
    "Apple Pay (Mastercard •••• 0716)",
  );
  assert.equal(
    formatOrderPaymentMethod({ brand: null, last4: null, wallet: "google_pay" }),
    "Google Pay",
  );
  assert.equal(
    formatOrderPaymentMethod({ brand: "link", last4: "1111", wallet: null }),
    "Link •••• 1111",
  );
  assert.equal(formatOrderPaymentMethod(null), null);
  assert.equal(formatOrderPaymentMethod(undefined), null);
});
