import assert from "node:assert/strict";
import test from "node:test";
import {
  createPickupOrderSyncService,
  subtractCursorOverlap,
} from "./pickup-order.sync.service";
import type { PickupOrderSyncPage } from "./pickup-order.types";

test("subtractCursorOverlap subtracts five seconds", () => {
  const result = subtractCursorOverlap(new Date("2026-07-07T01:00:05.000Z"));
  assert.equal(result.toISOString(), "2026-07-07T01:00:00.000Z");
});

test("syncPickupOrders advances cursor after page persistence", async () => {
  const calls: Array<{ updatedAfter?: Date; afterId?: number; limit: number }> =
    [];
  const emitted: unknown[] = [];
  const page: PickupOrderSyncPage = {
    items: [
      {
        id: 1,
        companyId: 1,
        documentId: "1-260707-101",
        status: "PENDING",
        memberId: "m1",
        memberName: "Jane",
        memberLevel: 1,
        memberPhoneLast4: "1234",
        pickupStartsAt: "2026-07-08T01:00:00.000Z",
        linesTotal: 1500,
        total: 1500,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:01:00.000Z",
        lines: [],
      },
    ],
    nextCursor: { updatedAt: "2026-07-07T00:01:00.000Z", orderId: 1 },
    hasMore: false,
  };

  const service = createPickupOrderSyncService({
    async fetchPage(input) {
      calls.push(input);
      return page;
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess(input) {
      assert.equal(
        input.cursorUpdatedAt?.toISOString(),
        "2026-07-07T00:01:00.000Z",
      );
      assert.equal(input.cursorOrderId, 1);
    },
    async markFailure() {
      assert.fail("markFailure should not be called");
    },
    emitNewOrders(payload) {
      emitted.push(payload);
    },
  });

  const outcome = await service.syncPickupOrders();
  assert.equal(calls.length, 1);
  assert.equal(outcome.pulled, 1);
  assert.equal(outcome.inserted, 1);
  assert.equal(outcome.emittedNewOrderCount, 1);
  assert.equal(emitted.length, 1);
});

test("syncPickupOrders keeps cursor on failure", async () => {
  let failureMarked = false;
  const service = createPickupOrderSyncService({
    async fetchPage() {
      throw new Error("network down");
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess() {
      assert.fail("markSuccess should not be called");
    },
    async markFailure(error) {
      failureMarked = error instanceof Error && error.message === "network down";
    },
    emitNewOrders() {
      assert.fail("emitNewOrders should not be called");
    },
  });

  await assert.rejects(() => service.syncPickupOrders(), /network down/);
  assert.equal(failureMarked, true);
});

test("syncPickupOrders skips overlapping runs", async () => {
  let releaseFetch: () => void = () => {
    assert.fail("fetch should have started");
  };
  const service = createPickupOrderSyncService({
    async fetchPage() {
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      return { items: [], nextCursor: null, hasMore: false };
    },
    async getState() {
      return { cursorUpdatedAt: null, cursorOrderId: null };
    },
    async findExistingIds() {
      return new Set<number>();
    },
    async upsertPage() {},
    async markSuccess() {},
    async markFailure() {},
    emitNewOrders() {},
  });

  const first = service.syncPickupOrders();
  const second = await service.syncPickupOrders();
  assert.equal(second.pulled, 0);
  assert.equal(second.inserted, 0);
  releaseFetch();
  await first;
});
