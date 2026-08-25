// node --experimental-strip-types src/renderer/src/hooks/order-load-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { getOrderLoadPolicy } from "./order-load-policy.ts";

const base = {
  paymentStatus: "UNPAID",
  fulfillment: "CLICK_AND_COLLECT",
  pickedQtys: [],
};

test("PLACED asks before loading the ordered quantities", () => {
  assert.deepEqual(getOrderLoadPolicy({ ...base, status: "PLACED" }), {
    mode: "confirm",
    message:
      "This order hasn't been accepted yet. Load it anyway with the ordered quantities?",
    qtySource: "ordered",
  });
});

test("PLACED cancellation is represented by the confirm policy", () => {
  const policy = getOrderLoadPolicy({ ...base, status: "PLACED" });
  assert.equal(policy.mode, "confirm");
  // The hook returns before cart mutation when window.confirm(policy.message) is false.
  assert.equal(policy.qtySource, "ordered");
});

test("closed statuses return their specified block messages", () => {
  assert.deepEqual(getOrderLoadPolicy({ ...base, status: "COLLECTED" }), {
    mode: "block",
    message: "This order has already been paid and collected.",
  });

  for (const status of ["CANCELLED", "REJECTED", "EXPIRED"]) {
    assert.deepEqual(getOrderLoadPolicy({ ...base, status }), {
      mode: "block",
      message: "This online order can't be loaded — it's been cancelled.",
    });
  }
});

test("READY uses recorded picked quantities and omits null lines in the hook", () => {
  assert.deepEqual(
    getOrderLoadPolicy({ ...base, status: "READY", pickedQtys: [2, 0, null] }),
    { mode: "load", qtySource: "picked" },
  );
});

test("READY falls back to ordered quantities only when every picked quantity is null", () => {
  assert.deepEqual(
    getOrderLoadPolicy({ ...base, status: "READY", pickedQtys: [null, null] }),
    {
      mode: "confirm",
      message:
        "Picking wasn't recorded for this order. Load it with the ordered quantities?",
      qtySource: "ordered",
    },
  );
});
