// node --experimental-strip-types src/renderer/src/components/orders/order-status-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionOrderStatus,
  getVisibleOrderStatusActions,
  requiresAdminForOrderStatusTransition,
} from "./order-status-policy.ts";

const TERMINAL_STATUSES = ["COLLECTED", "CANCELLED", "REJECTED", "EXPIRED"];

test("transition map: PLACED -> ACCEPTED | REJECTED", () => {
  assert.equal(canTransitionOrderStatus("PLACED", "ACCEPTED"), true);
  assert.equal(canTransitionOrderStatus("PLACED", "REJECTED"), true);
  assert.equal(canTransitionOrderStatus("PLACED", "READY"), false);
});

test("transition map: ACCEPTED -> READY | REJECTED", () => {
  assert.equal(canTransitionOrderStatus("ACCEPTED", "READY"), true);
  assert.equal(canTransitionOrderStatus("ACCEPTED", "REJECTED"), true);
  assert.equal(canTransitionOrderStatus("ACCEPTED", "ACCEPTED"), false);
});

test("transition map: READY -> REJECTED only", () => {
  assert.equal(canTransitionOrderStatus("READY", "REJECTED"), true);
  assert.equal(canTransitionOrderStatus("READY", "ACCEPTED"), false);
});

test("terminal statuses allow no transition", () => {
  for (const from of TERMINAL_STATUSES) {
    assert.equal(canTransitionOrderStatus(from, "ACCEPTED"), false, from);
    assert.equal(canTransitionOrderStatus(from, "READY"), false, from);
    assert.equal(canTransitionOrderStatus(from, "REJECTED"), false, from);
  }
});

test("admin is required only for READY -> REJECTED", () => {
  assert.equal(requiresAdminForOrderStatusTransition("READY", "REJECTED"), true);
  assert.equal(
    requiresAdminForOrderStatusTransition("PLACED", "REJECTED"),
    false,
  );
  assert.equal(
    requiresAdminForOrderStatusTransition("ACCEPTED", "REJECTED"),
    false,
  );
  assert.equal(
    requiresAdminForOrderStatusTransition("ACCEPTED", "READY"),
    false,
  );
});

test("getVisibleOrderStatusActions exposes valid transitions for sale scope", () => {
  assert.deepEqual(getVisibleOrderStatusActions("PLACED", ["sale"]), [
    "ACCEPTED",
    "REJECTED",
  ]);
  assert.deepEqual(getVisibleOrderStatusActions("ACCEPTED", ["sale"]), [
    "READY",
    "REJECTED",
  ]);
});

test("getVisibleOrderStatusActions hides READY reject without admin scope", () => {
  assert.deepEqual(getVisibleOrderStatusActions("READY", ["sale"]), []);
  assert.deepEqual(getVisibleOrderStatusActions("READY", ["sale", "admin"]), [
    "REJECTED",
  ]);
});

test("getVisibleOrderStatusActions returns nothing on terminal statuses", () => {
  for (const from of TERMINAL_STATUSES) {
    assert.deepEqual(getVisibleOrderStatusActions(from, ["admin"]), [], from);
  }
});

// --- 2026-09-24 DELIVERY 전이 map ---

test("delivery map hides READY and walks ACCEPTED -> SCHEDULED -> DISPATCHED -> DELIVERED", () => {
  assert.equal(canTransitionOrderStatus("ACCEPTED", "READY", "DELIVERY"), false);
  assert.deepEqual(getVisibleOrderStatusActions("PLACED", ["sale"], "DELIVERY"), [
    "ACCEPTED",
    "REJECTED",
  ]);
  assert.deepEqual(getVisibleOrderStatusActions("ACCEPTED", ["sale"], "DELIVERY"), [
    "SCHEDULED",
    "REJECTED",
  ]);
  // post-capture reject is admin-only (owner 2026-09-24)
  assert.deepEqual(getVisibleOrderStatusActions("SCHEDULED", ["sale"], "DELIVERY"), [
    "DISPATCHED",
  ]);
  assert.deepEqual(getVisibleOrderStatusActions("DISPATCHED", ["sale"], "DELIVERY"), [
    "DELIVERED",
  ]);
  assert.deepEqual(getVisibleOrderStatusActions("SCHEDULED", ["sale", "admin"], "DELIVERY"), [
    "DISPATCHED",
    "REJECTED",
  ]);
  assert.deepEqual(getVisibleOrderStatusActions("DELIVERED", ["admin"], "DELIVERY"), []);
});

test("click-and-collect map is unchanged and never offers delivery actions", () => {
  assert.deepEqual(
    getVisibleOrderStatusActions("ACCEPTED", ["sale"], "CLICK_AND_COLLECT"),
    ["READY", "REJECTED"],
  );
  assert.equal(canTransitionOrderStatus("ACCEPTED", "SCHEDULED"), false);
  assert.equal(canTransitionOrderStatus("SCHEDULED", "DISPATCHED"), false);
});

test("pending-payment / abandoned expose no actions", () => {
  for (const from of ["PENDING_PAYMENT", "ABANDONED"]) {
    assert.deepEqual(getVisibleOrderStatusActions(from, ["admin"]), [], from);
    assert.deepEqual(getVisibleOrderStatusActions(from, ["admin"], "DELIVERY"), [], from);
  }
});

test("post-capture DELIVERY reject is admin-only (owner 2026-09-24)", () => {
  assert.equal(requiresAdminForOrderStatusTransition("SCHEDULED", "REJECTED"), true);
  assert.equal(requiresAdminForOrderStatusTransition("DISPATCHED", "REJECTED"), true);
  assert.equal(
    getVisibleOrderStatusActions("SCHEDULED", ["sale"], "DELIVERY").includes("REJECTED"),
    false,
  );
  assert.equal(
    getVisibleOrderStatusActions("SCHEDULED", ["sale", "admin"], "DELIVERY").includes("REJECTED"),
    true,
  );
});
