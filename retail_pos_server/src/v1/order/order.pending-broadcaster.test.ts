import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderBucketsPayload,
  buildOrderPendingCountPayload,
  classifyBucketsResponse,
  ORDER_PENDING_COUNT_INTERVAL_MS,
  pendingCountFromBuckets,
  computeOrderPendingTickOutcome,
  computeBucketsRevision,
  noteLocalOrderWrite,
  shouldEmitOrderNew,
  stopOrderPendingBroadcasterForTest,
} from "./order.pending-broadcaster";

const NOW = new Date("2026-08-10T03:00:00.000Z");

test("buildOrderPendingCountPayload marks successful ticks ok", () => {
  const payload = buildOrderPendingCountPayload(3, [1, 4], NOW);
  assert.deepEqual(payload, {
    ok: true,
    count: 3,
    chimeTerminalIds: [1, 4],
    generatedAt: "2026-08-10T03:00:00.000Z",
  });
});

test("buildOrderPendingCountPayload marks crm failure as ok:false count:null", () => {
  const payload = buildOrderPendingCountPayload(null, [2], NOW);
  assert.deepEqual(payload, {
    ok: false,
    count: null,
    chimeTerminalIds: [2],
    generatedAt: "2026-08-10T03:00:00.000Z",
  });
});

test("shouldEmitOrderNew fires only on an increase vs previous successful tick", () => {
  assert.equal(shouldEmitOrderNew(2, 3), true);
  assert.equal(shouldEmitOrderNew(2, 2), false);
  assert.equal(shouldEmitOrderNew(3, 2), false);
  assert.equal(shouldEmitOrderNew(0, 1), true);
});

test("shouldEmitOrderNew never fires on the first tick or failed ticks", () => {
  assert.equal(shouldEmitOrderNew(null, 5), false); // first successful tick
  assert.equal(shouldEmitOrderNew(2, null), false); // crm failure tick
  assert.equal(shouldEmitOrderNew(null, null), false);
});

test("computeOrderPendingTickOutcome advances the successful-count baseline", () => {
  const outcome = computeOrderPendingTickOutcome(1, 4, [7], NOW);
  assert.equal(outcome.emitOrderNew, true);
  assert.equal(outcome.nextSuccessfulCount, 4);
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.count, 4);
});

test("computeOrderPendingTickOutcome keeps the baseline across failed ticks", () => {
  // 성공(2) → 실패(null) → 성공(3): 실패 틱이 기준을 지우면 3 에서 order:new
  // 를 놓친다. 기준은 "직전 성공 틱" 이어야 한다.
  const failed = computeOrderPendingTickOutcome(2, null, [], NOW);
  assert.equal(failed.emitOrderNew, false);
  assert.equal(failed.nextSuccessfulCount, 2);
  assert.equal(failed.payload.ok, false);
  assert.equal(failed.payload.count, null);

  const recovered = computeOrderPendingTickOutcome(
    failed.nextSuccessfulCount,
    3,
    [],
    NOW,
  );
  assert.equal(recovered.emitOrderNew, true);
  assert.equal(recovered.nextSuccessfulCount, 3);
});

const BUCKETS = {
  asOf: "2026-09-24T05:00:00.000Z",
  today: "2026-09-24",
  nextDeliveryDate: "2026-09-25",
  deliveryWindow: { startMinutes: 540, endMinutes: 1260 },
  counts: {
    new: { total: 3, pickup: 2, delivery: 1 },
    issues: {
      total: 1,
      byKind: {
        ACCEPT_OVERDUE: 1,
        NOT_SCHEDULED: 0,
        PAYMENT_FAILED: 0,
        AUTO_VOID_SOON: 0,
        PICKUP_NOT_READY: 0,
        NOT_COLLECTED: 0,
        DELIVERY_LATE: 0,
      },
    },
    pickup: { today: 1, ready: 1, upcoming: 0 },
    delivery: {
      today: 1,
      out: 0,
      tomorrow: 2,
      upcoming: 0,
      tomorrowToSchedule: 1,
      tomorrowScheduled: 1,
    },
  },
};

test("tick interval is 30s (triage spec §5-3)", () => {
  assert.equal(ORDER_PENDING_COUNT_INTERVAL_MS, 30_000);
});

test("pending count is derived from buckets counts.new.total", () => {
  assert.equal(pendingCountFromBuckets(BUCKETS), 3);
});

test("classifyBucketsResponse: ok, old crm 404 fallback, and failure", () => {
  assert.deepEqual(classifyBucketsResponse({ ok: true, status: 200, result: BUCKETS }), {
    kind: "ok",
    buckets: BUCKETS,
  });
  assert.deepEqual(classifyBucketsResponse({ ok: false, status: 404, result: null }), {
    kind: "unsupported",
  });
  assert.deepEqual(classifyBucketsResponse({ ok: false, status: 500, result: null }), {
    kind: "failed",
  });
  // ok 이지만 형이 깨진 result 도 실패로 본다
  assert.deepEqual(
    classifyBucketsResponse({ ok: true, status: 200, result: {} as typeof BUCKETS }),
    { kind: "failed" },
  );
});

test("buildOrderBucketsPayload carries the result and chime terminals", () => {
  assert.deepEqual(buildOrderBucketsPayload(BUCKETS, [2], NOW, "rev-1"), {
    ok: true,
    result: BUCKETS,
    chimeTerminalIds: [2],
    generatedAt: "2026-08-10T03:00:00.000Z",
    revision: "rev-1",
  });
  assert.deepEqual(buildOrderBucketsPayload(null, [], NOW), {
    ok: false,
    result: null,
    chimeTerminalIds: [],
    generatedAt: "2026-08-10T03:00:00.000Z",
    revision: null,
  });
});

// ── T-24 (R-15) — revision moves only on content change ──

test("revision is unchanged for identical bucket content on a later tick", () => {
  const later = { ...BUCKETS, asOf: "2026-08-10T03:00:30.000Z" };
  const a = buildOrderBucketsPayload(BUCKETS, [2], NOW);
  const b = buildOrderBucketsPayload(later, [2], new Date("2026-08-10T03:00:30.000Z"));
  assert.ok(a.revision);
  assert.equal(b.revision, a.revision, "asOf / generatedAt do not move it");
  // key order of the crm JSON does not matter either
  const reordered = JSON.parse(
    JSON.stringify({ counts: BUCKETS.counts, deliveryWindow: BUCKETS.deliveryWindow, nextDeliveryDate: BUCKETS.nextDeliveryDate, today: BUCKETS.today, asOf: "x" }),
  ) as typeof BUCKETS;
  assert.equal(computeBucketsRevision(reordered, 0), computeBucketsRevision(BUCKETS, 0));
});

test("revision changes when a count, the day, or a proxied order write changes", () => {
  const base = computeBucketsRevision(BUCKETS, 0);
  const moreNew = {
    ...BUCKETS,
    counts: { ...BUCKETS.counts, new: { ...BUCKETS.counts.new, total: BUCKETS.counts.new.total + 1 } },
  };
  assert.notEqual(computeBucketsRevision(moreNew, 0), base);
  assert.notEqual(computeBucketsRevision({ ...BUCKETS, today: "2026-08-11" }, 0), base);
  assert.notEqual(computeBucketsRevision(BUCKETS, 1), base);
  assert.equal(computeBucketsRevision(null, 0), null);
});

test("noteLocalOrderWrite moves the next payload's revision once", () => {
  stopOrderPendingBroadcasterForTest(); // resets module state
  const before = buildOrderBucketsPayload(BUCKETS, [], NOW).revision;
  assert.equal(buildOrderBucketsPayload(BUCKETS, [], NOW).revision, before);
  noteLocalOrderWrite();
  const after = buildOrderBucketsPayload(BUCKETS, [], NOW).revision;
  assert.notEqual(after, before);
  assert.equal(buildOrderBucketsPayload(BUCKETS, [], NOW).revision, after);
  stopOrderPendingBroadcasterForTest();
});
