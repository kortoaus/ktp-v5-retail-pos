import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderPendingCountPayload,
  computeOrderPendingTickOutcome,
  shouldEmitOrderNew,
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
