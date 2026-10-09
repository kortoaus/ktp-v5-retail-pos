import assert from "node:assert/strict";
import test from "node:test";

import {
  SWEEP_BACKOFF_MS,
  SWEEP_PAGE_SIZE,
  createSweepRunner,
  isHaltingCloudFailure,
  type SweepPageResult,
  type SweepSource,
} from "./sweep-runner";
import {
  createInvoiceSweepRunner,
  type InvoiceSweepDeps,
  type PendingInvoice,
} from "./cloud.sync.service";
import {
  collectInvoiceOrder,
  createCollectSweepRunner,
  type CollectableInvoice,
} from "../order/order.collect.service";

// T-24 (audit R-5 + R-18 + R-8) — sweep runner with fakes: no DB, no network.

type Row = { id: number };

class FakeTimers {
  pending = new Map<number, { fn: () => void; ms: number }>();
  private seq = 0;
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.pending.set(id, { fn, ms });
    return id;
  };
  clear = (handle: unknown) => {
    this.pending.delete(handle as number);
  };
  delays() {
    return [...this.pending.values()].map((t) => t.ms);
  }
  fireAll() {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const t of all) t.fn();
  }
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// A source over an in-memory pending table; processPage settles every row
// unless `failIds` names it.
function tableSource(ids: number[], opts: { failIds?: Set<number>; halt?: boolean } = {}) {
  const pending = new Set(ids);
  const pageCalls: Array<{ afterId: number; limit: number; got: number }> = [];
  let runs = 0;
  let gate: Promise<void> | null = null;
  const source: SweepSource<Row> = {
    name: "test",
    async loadPage(afterId, limit) {
      if (afterId === 0) {
        runs++;
        if (gate) await gate;
      }
      const rows = [...pending]
        .filter((id) => id > afterId)
        .sort((a, b) => a - b)
        .slice(0, limit)
        .map((id) => ({ id }));
      pageCalls.push({ afterId, limit, got: rows.length });
      return rows;
    },
    async processPage(rows): Promise<SweepPageResult> {
      const r: SweepPageResult = { done: 0, deferred: 0, failed: 0, halted: false };
      for (const row of rows) {
        if (opts.failIds?.has(row.id)) {
          r.failed++;
          if (opts.halt) {
            r.halted = true;
            return r;
          }
          continue;
        }
        pending.delete(row.id);
        r.done++;
      }
      return r;
    },
    async pendingStats() {
      return { count: pending.size, oldestAt: null };
    },
  };
  return {
    source,
    pending,
    pageCalls,
    runs: () => runs,
    setGate: (g: Promise<void> | null) => (gate = g),
  };
}

function quietRunner<R extends Row>(source: SweepSource<R>, timers = new FakeTimers()) {
  const lines: string[] = [];
  const runner = createSweepRunner(source, {
    setTimer: timers.set,
    clearTimer: timers.clear,
    log: (l) => lines.push(l),
  });
  return { runner, timers, lines };
}

test("a trigger during a run coalesces into exactly one rerun", async () => {
  const t = tableSource([1, 2, 3]);
  const gate = deferred();
  t.setGate(gate.promise);
  const { runner } = quietRunner(t.source);

  const first = runner.trigger();
  // Three triggers arrive while the first run waits on its first page.
  const second = runner.trigger();
  runner.trigger();
  runner.trigger();
  assert.equal(second, first, "mid-run triggers share the running cycle");
  t.setGate(null);
  gate.resolve();
  await first;

  assert.equal(t.runs(), 2, "one run + exactly one coalesced rerun");
  assert.equal(t.pending.size, 0);
});

test("a trigger while the run's log line awaits pendingStats() causes one more run", async () => {
  const t = tableSource([1]);
  const statsGate = deferred();
  let statsCalls = 0;
  const pendingStats = t.source.pendingStats;
  t.source.pendingStats = async () => {
    statsCalls++;
    if (statsCalls === 1) await statsGate.promise;
    return pendingStats();
  };
  const { runner } = quietRunner(t.source);

  const cycle = runner.trigger();
  for (let i = 0; i < 5 && statsCalls === 0; i++) await new Promise((r) => setImmediate(r));
  assert.equal(statsCalls, 1, "first run is logging");
  t.pending.add(2); // committed after the first run's page query
  const again = runner.trigger(); // arrives during logRun
  assert.equal(again, cycle, "joins the running cycle");
  statsGate.resolve();
  await cycle;

  assert.equal(t.runs(), 2, "the late trigger got its own run");
  assert.equal(t.pending.size, 0, "row 2 did not wait for an unrelated trigger");
});

test("a trigger after the cycle ends starts a fresh run (nothing dropped)", async () => {
  const t = tableSource([1]);
  const { runner } = quietRunner(t.source);
  await runner.trigger();
  t.pending.add(2);
  await runner.trigger();
  assert.equal(t.runs(), 2);
  assert.equal(t.pending.size, 0);
});

test("120 pending rows are processed as 3 id-ordered pages of at most 50", async () => {
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const t = tableSource(ids);
  const { runner, lines } = quietRunner(t.source);
  await runner.trigger();

  assert.equal(SWEEP_PAGE_SIZE, 50);
  assert.deepEqual(
    t.pageCalls.map((c) => [c.afterId, c.limit, c.got]),
    [
      [0, 50, 50],
      [50, 50, 50],
      [100, 50, 20],
    ],
  );
  assert.equal(t.pending.size, 0);
  assert.equal(lines.length, 1, "one log line per run");
  assert.match(lines[0], /^\[sweep:test\] done=120 failed=0 deferred=0 pages=3 pending=0 oldestPendingAge=-$/);
});

test("failure schedules a retry with backoff 1→2→5→10 min (cap); success clears it", async () => {
  const fail = new Set([2]);
  const t = tableSource([1, 2, 3], { failIds: fail });
  const { runner, timers, lines } = quietRunner(t.source);

  await runner.trigger();
  assert.equal(runner.isRetryScheduled(), true);
  assert.deepEqual(timers.delays(), [60_000]);
  assert.match(lines[lines.length - 1], /failed=1 .*pending=1 .*retryIn=60s/);

  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    const retry = runner.trigger(); // what the timer would do
    await retry;
    seen.push(...timers.delays());
  }
  assert.deepEqual(seen, [120_000, 300_000, 600_000, 600_000]);
  assert.deepEqual([...SWEEP_BACKOFF_MS], [60_000, 120_000, 300_000, 600_000]);

  // The row recovers: the next (timer) run succeeds → timer cleared, backoff reset.
  fail.clear();
  timers.fireAll();
  await runner.trigger(); // join/complete the timer-started cycle
  assert.equal(runner.isRetryScheduled(), false);
  assert.equal(timers.pending.size, 0);
  assert.equal(t.pending.size, 0);

  // A later failure starts from 1 min again.
  fail.add(9);
  t.pending.add(9);
  await runner.trigger();
  assert.deepEqual(timers.delays(), [60_000]);
});

test("a halted page stops the run and schedules a retry", async () => {
  const t = tableSource([1, 2, 3], { failIds: new Set([1]), halt: true });
  const { runner, timers } = quietRunner(t.source);
  await runner.trigger();
  assert.equal(t.pending.size, 3, "rows after the halt are not attempted");
  assert.deepEqual(timers.delays(), [60_000]);
});

test("isHaltingCloudFailure — transport/5xx/auth/throttle halt, a row-level 4xx does not", () => {
  assert.equal(isHaltingCloudFailure({ ok: false, status: 500, transport: "timeout" }), true);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 0 }), true);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 503 }), true);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 429 }), true);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 401 }), true);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 400 }), false);
  assert.equal(isHaltingCloudFailure({ ok: false, status: 200 }), false);
  assert.equal(isHaltingCloudFailure({ ok: true, status: 200 }), false);
});

// ── Invoice sweep: parent-before-child ordering ──────────────────

function invoice(id: number, originalInvoiceId: number | null = null): PendingInvoice {
  return {
    id,
    originalInvoiceId,
    serial: `1-20261009-S${String(id).padStart(6, "0")}`,
    rows: [],
    payments: [],
  } as unknown as PendingInvoice;
}

function invoiceHarness(rows: PendingInvoice[], rejectIds: Set<number>) {
  const table = new Map(rows.map((r) => [r.id, { inv: r, cloudId: null as number | null }]));
  const pushed: number[] = [];
  const deps: InvoiceSweepDeps = {
    async loadPage(afterId, limit) {
      return [...table.values()]
        .filter((r) => r.cloudId == null && r.inv.id > afterId)
        .sort((a, b) => a.inv.id - b.inv.id)
        .slice(0, limit)
        .map((r) => r.inv);
    },
    async loadParentCloudIds(ids) {
      return new Map(ids.map((id) => [id, table.get(id)?.cloudId ?? null]));
    },
    async push(payload) {
      if (rejectIds.has(payload.localId)) {
        return { ok: false, status: 400, msg: "bad invoice" };
      }
      pushed.push(payload.localId);
      return { ok: true, status: 200, result: { id: 1000 + payload.localId } };
    },
    async markSynced(localId, cloudId) {
      table.get(localId)!.cloudId = cloudId;
    },
    async pendingStats() {
      const left = [...table.values()].filter((r) => r.cloudId == null);
      return { count: left.length, oldestAt: null };
    },
  };
  return { deps, table, pushed };
}

test("a child whose original is not synced is deferred without blocking its siblings", async () => {
  // 1 = SALE rejected by the cloud (400), 2 = its refund (child), 3 = an
  // unrelated SALE, 4 = refund of 3 (parent pushed earlier in the same page).
  const h = invoiceHarness(
    [invoice(1), invoice(2, 1), invoice(3), invoice(4, 3)],
    new Set([1]),
  );
  const timers = new FakeTimers();
  const lines: string[] = [];
  const restore = console.error;
  console.error = () => {};
  try {
    const runner = createInvoiceSweepRunner(h.deps, {
      setTimer: timers.set,
      clearTimer: timers.clear,
      log: (l) => lines.push(l),
    });
    await runner.trigger();
  } finally {
    console.error = restore;
  }

  assert.deepEqual(h.pushed, [3, 4], "sibling and its child still go up");
  assert.equal(h.table.get(2)!.cloudId, null, "child of the failed original stays pending");
  assert.match(lines[0], /done=2 failed=1 deferred=1 .*pending=2/);
  assert.deepEqual(timers.delays(), [60_000], "failure → timed retry");
});

test("the child payload carries the original's cloud id", async () => {
  const h = invoiceHarness([invoice(5), invoice(6, 5)], new Set());
  const payloads: Array<{ localId: number; originalInvoiceId: number | null }> = [];
  const push = h.deps.push;
  h.deps.push = async (p) => {
    payloads.push({ localId: p.localId, originalInvoiceId: p.originalInvoiceId });
    return push(p);
  };
  const runner = createInvoiceSweepRunner(h.deps, { log: () => {} });
  await runner.trigger();
  runner.stop();
  assert.deepEqual(payloads, [
    { localId: 5, originalInvoiceId: null },
    { localId: 6, originalInvoiceId: 1005 },
  ]);
});

// ── Collect: retryable outcomes are never stamped (R-8) ───────────

test("collectInvoiceOrder stamps synced/conflict/permanent and never a retryable answer", async () => {
  const inv: CollectableInvoice = { id: 7, serial: "1-20261009-S000007", externalOrderId: "o-1" };
  const cases: Array<[Record<string, unknown>, string, boolean]> = [
    [{ ok: true, status: 200 }, "synced", true],
    [{ ok: false, status: 409 }, "conflict", true],
    [{ ok: false, status: 404 }, "permanent", true],
    [{ ok: false, status: 408 }, "retry", false],
    [{ ok: false, status: 429 }, "retry", false],
    [{ ok: false, status: 500, transport: "timeout" }, "retry", false],
    [{ ok: false, status: 500, transport: "network" }, "retry", false],
  ];
  const restoreErr = console.error;
  const restoreWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    for (const [answer, expected, stamped] of cases) {
      const stamps: number[] = [];
      const outcome = await collectInvoiceOrder(inv, {
        post: async () => ({ msg: "x", ...answer }) as unknown as { ok: boolean },
        stampSynced: async (id) => {
          stamps.push(id);
        },
      });
      assert.equal(outcome, expected, JSON.stringify(answer));
      assert.equal(stamps.length > 0, stamped, `stamp for ${JSON.stringify(answer)}`);
    }
  } finally {
    console.error = restoreErr;
    console.warn = restoreWarn;
  }
});

test("collect sweep halts on a retryable outcome and schedules the backoff retry", async () => {
  const rows: CollectableInvoice[] = [1, 2, 3].map((id) => ({
    id,
    serial: `s${id}`,
    externalOrderId: `o${id}`,
  }));
  const attempted: number[] = [];
  const timers = new FakeTimers();
  const runner = createCollectSweepRunner(
    {
      loadPage: async (afterId, limit) => rows.filter((r) => r.id > afterId).slice(0, limit),
      collect: async (inv) => {
        attempted.push(inv.id);
        return inv.id === 2 ? "retry" : "synced";
      },
      pendingStats: async () => ({ count: 2, oldestAt: null }),
    },
    { setTimer: timers.set, clearTimer: timers.clear, log: () => {} },
  );
  await runner.trigger();
  assert.deepEqual(attempted, [1, 2]);
  assert.deepEqual(timers.delays(), [60_000]);
});
