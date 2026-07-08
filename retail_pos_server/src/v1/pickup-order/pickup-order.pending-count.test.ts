import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPickupPendingCountPayload,
  getPickupPendingCountFrom,
  PICKUP_PENDING_COUNT_INTERVAL_MS,
} from "./pickup-order.pending-count";

test("getPickupPendingCountFrom returns Australia/Sydney start of day", () => {
  const from = getPickupPendingCountFrom(
    new Date("2026-07-08T03:30:00.000Z"),
  );

  assert.equal(from.toISOString(), "2026-07-07T14:00:00.000Z");
});

test("buildPickupPendingCountPayload uses pending count and stable interval", async () => {
  const payload = await buildPickupPendingCountPayload({
    now: () => new Date("2026-07-08T03:30:00.000Z"),
    countPendingPickupOrdersFrom: async (from) => {
      assert.equal(from.toISOString(), "2026-07-07T14:00:00.000Z");
      return 7;
    },
  });

  assert.deepEqual(payload, {
    count: 7,
    from: "2026-07-07T14:00:00.000Z",
    generatedAt: "2026-07-08T03:30:00.000Z",
    intervalMs: PICKUP_PENDING_COUNT_INTERVAL_MS,
  });
});
