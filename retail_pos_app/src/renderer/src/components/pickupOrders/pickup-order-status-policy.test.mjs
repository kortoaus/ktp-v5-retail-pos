import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionPickupOrderStatus,
  isPickupOrderLabelPrintable,
  requiresManagerForPickupOrderStatusTransition,
} from "./pickup-order-status-policy.ts";

test("isPickupOrderLabelPrintable blocks completed and cancelled orders", () => {
  assert.equal(isPickupOrderLabelPrintable("PENDING"), true);
  assert.equal(isPickupOrderLabelPrintable("ORDER_CONFIRMED"), true);
  assert.equal(isPickupOrderLabelPrintable("READY"), true);
  assert.equal(isPickupOrderLabelPrintable("COMPLETED"), false);
  assert.equal(isPickupOrderLabelPrintable("CANCELLED_BY_STORE"), false);
  assert.equal(isPickupOrderLabelPrintable("CANCELLED_BY_CUSTOMER"), false);
});

test("renderer pickup status policy exposes forward actions and manager-only ready cancellation", () => {
  assert.equal(canTransitionPickupOrderStatus("PENDING", "ORDER_CONFIRMED"), true);
  assert.equal(canTransitionPickupOrderStatus("READY", "PENDING"), false);
  assert.equal(
    requiresManagerForPickupOrderStatusTransition(
      "READY",
      "CANCELLED_BY_STORE",
    ),
    true,
  );
  assert.equal(
    requiresManagerForPickupOrderStatusTransition(
      "PENDING",
      "CANCELLED_BY_STORE",
    ),
    false,
  );
});
