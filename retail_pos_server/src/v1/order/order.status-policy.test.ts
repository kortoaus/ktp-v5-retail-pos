import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  UnauthorizedException,
} from "../../libs/exceptions";
import {
  assertOrderStatusAdminAllowed,
  assertOrderStatusTransitionAllowed,
  canTransitionOrderStatus,
  getVisibleOrderStatusActions,
  requiresAdminForOrderStatusTransition,
} from "./order.status-policy";
import type { OrderStatusWire } from "./order.types";

const TERMINAL_STATUSES: OrderStatusWire[] = [
  "COLLECTED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
];

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
  assert.equal(canTransitionOrderStatus("READY", "READY"), false);
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
  assert.equal(requiresAdminForOrderStatusTransition("ACCEPTED", "READY"), false);
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

test("assertOrderStatusTransitionAllowed throws BadRequest on invalid transition", () => {
  assert.doesNotThrow(() =>
    assertOrderStatusTransitionAllowed("PLACED", "ACCEPTED"),
  );
  assert.throws(
    () => assertOrderStatusTransitionAllowed("COLLECTED", "REJECTED"),
    BadRequestException,
  );
});

test("assertOrderStatusAdminAllowed gates READY -> REJECTED on admin", () => {
  assert.doesNotThrow(() =>
    assertOrderStatusAdminAllowed("PLACED", "REJECTED", ["sale"]),
  );
  assert.doesNotThrow(() =>
    assertOrderStatusAdminAllowed("READY", "REJECTED", ["admin"]),
  );
  assert.throws(
    () => assertOrderStatusAdminAllowed("READY", "REJECTED", ["sale"]),
    UnauthorizedException,
  );
});
