// npm run test:orders — T-24 (audit R-15)
import assert from "node:assert/strict";
import test from "node:test";

import { bucketsRevisionOf, nextBucketsSignal } from "./buckets-revision.ts";
import {
  applyOrderBuckets,
  getOrderInboxState,
  normalizeOrderBucketsPayload,
} from "./orderInboxStore.ts";

const BUCKETS = {
  asOf: "2026-10-09T00:00:00.000Z",
  today: "2026-10-09",
  nextDeliveryDate: "2026-10-10",
  deliveryWindow: { startMinutes: 600, endMinutes: 1080 },
  counts: {
    new: { total: 2, pickup: 1, delivery: 1 },
    issues: { total: 0, byKind: {} },
    pickup: { today: 1, ready: 0, upcoming: 0 },
    delivery: { today: 1, out: 0, tomorrow: 0, upcoming: 0, tomorrowToSchedule: 0, tomorrowScheduled: 0 },
  },
};
const tick = (asOf) => ({ ...BUCKETS, asOf });

test("same server revision on every heartbeat → no refetch signal", () => {
  const before = getOrderInboxState().bucketsSeq;
  applyOrderBuckets(tick("2026-10-09T00:00:00Z"), 1, "abc");
  const first = getOrderInboxState().bucketsSeq;
  assert.equal(first, before + 1, "first revision seen → one signal");
  for (let i = 1; i <= 10; i++) applyOrderBuckets(tick(`2026-10-09T00:0${i % 10}:30Z`), 1 + i, "abc");
  assert.equal(getOrderInboxState().bucketsSeq, first, "10 identical heartbeats → zero refetches");
  assert.equal(getOrderInboxState().bucketsReceivedAt, 11, "receipt time still tracked (fallback timer)");
});

test("a new revision → exactly one refetch signal", () => {
  const before = getOrderInboxState().bucketsSeq;
  applyOrderBuckets(BUCKETS, 20, "def");
  applyOrderBuckets(BUCKETS, 21, "def");
  assert.equal(getOrderInboxState().bucketsSeq, before + 1);
});

test("a failed tick (no buckets) never signals and keeps the last buckets", () => {
  const before = getOrderInboxState();
  applyOrderBuckets(null, 30, null);
  const after = getOrderInboxState();
  assert.equal(after.bucketsSeq, before.bucketsSeq);
  assert.equal(after.buckets, before.buckets);
  assert.equal(after.bucketsOk, false);
});

test("old server / fallback poll without revision: content key ignores asOf", () => {
  assert.equal(
    bucketsRevisionOf(tick("2026-10-09T00:00:00Z")),
    bucketsRevisionOf(tick("2026-10-09T00:05:00Z")),
  );
  const changed = { ...BUCKETS, counts: { ...BUCKETS.counts, new: { total: 3, pickup: 2, delivery: 1 } } };
  assert.notEqual(bucketsRevisionOf(changed), bucketsRevisionOf(BUCKETS));
  assert.equal(bucketsRevisionOf(null, "x"), null);
});

test("nextBucketsSignal is a pure gate", () => {
  const s0 = { seq: 4, revision: "rev:a" };
  assert.equal(nextBucketsSignal(s0, "rev:a"), s0);
  assert.equal(nextBucketsSignal(s0, null), s0);
  assert.deepEqual(nextBucketsSignal(s0, "rev:b"), { seq: 5, revision: "rev:b" });
});

test("normalizeOrderBucketsPayload carries the server revision", () => {
  assert.equal(normalizeOrderBucketsPayload({ ok: true, result: BUCKETS, chimeTerminalIds: [], revision: "r1" }).revision, "r1");
  assert.equal(normalizeOrderBucketsPayload({ ok: true, result: BUCKETS, chimeTerminalIds: [] }).revision, null);
});
