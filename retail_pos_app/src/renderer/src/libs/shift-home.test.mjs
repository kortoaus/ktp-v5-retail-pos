// npm run test:orders (T-10 review round 5) — Home / Open Shift recovery when
// the terminal's shift read failed.
import assert from "node:assert/strict";
import test from "node:test";

import { createShiftStateStore } from "./shift-state.ts";
import {
  homeShiftRow,
  isShiftAlreadyOpened,
  openShiftWithRecovery,
  reloadStaleShift,
} from "./shift-close.ts";

function controllableServer() {
  const pending = [];
  return {
    fetchCurrent: () => new Promise((resolve) => pending.push(resolve)),
    answer: (i, res) => pending[i](res),
  };
}
const shiftAnswer = (id) => ({ ok: true, result: id == null ? null : { id } });
const NETWORK_DOWN = { ok: false, status: 0, msg: "Network Error", result: null };
const homeOf = (store) => {
  const s = store.getSnapshot();
  return homeShiftRow({ hasShift: s.shift != null, shiftKnown: s.shiftKnown });
};
const retryFrom = (store) =>
  reloadStaleShift({
    reloadShift: () => store.reload({ inPlace: true }),
    setStaleShiftId: (id) => store.setStaleShiftId(id),
  });

test("failed read → Home shows 'Shift status unknown — Retry' → Retry succeeds → Sale / Close Shift appear", async () => {
  const server = controllableServer();
  const store = createShiftStateStore(server.fetchCurrent);
  const boot = store.setTerminal(2);
  server.answer(0, NETWORK_DOWN);
  assert.equal(await boot, false);
  assert.deepEqual(homeOf(store), { row: "unknown", showShiftActions: false });

  // The Close Shift entry retry failed too; back on Home, still unknown.
  const entry = retryFrom(store);
  server.answer(1, NETWORK_DOWN);
  assert.equal(await entry, false);
  assert.equal(homeOf(store).row, "unknown", "never the Open-Shift-only layout");

  const retry = retryFrom(store);
  server.answer(2, shiftAnswer(40));
  assert.equal(await retry, true);
  assert.deepEqual(homeOf(store), { row: "close-shift", showShiftActions: true });
});

test("a known terminal with no shift shows Open Shift only; with a shift, Close Shift + Sale", () => {
  assert.deepEqual(homeShiftRow({ hasShift: false, shiftKnown: true }), { row: "open-shift", showShiftActions: false });
  assert.deepEqual(homeShiftRow({ hasShift: true, shiftKnown: true }), { row: "close-shift", showShiftActions: true });
});

test("'Shift already opened' 400 → in-place reload → shift known, Close Shift / Sale reachable", async () => {
  const server = controllableServer();
  const store = createShiftStateStore(server.fetchCurrent);
  const boot = store.setTerminal(2);
  server.answer(0, NETWORK_DOWN);
  await boot;

  const seenLoading = [];
  store.subscribe(() => seenLoading.push(store.getSnapshot().loading));
  const opening = openShiftWithRecovery(
    { cashInDrawer: 0 },
    {
      open: async () => ({ ok: false, status: 400, msg: "Shift already opened", result: null }),
      reload: () => assert.fail("no full reload on 'already opened'"),
      reloadInPlace: () => store.reload({ inPlace: true }),
    },
  );
  await new Promise((r) => setImmediate(r));
  server.answer(1, shiftAnswer(40));
  const out = await opening;
  assert.equal(out.kind, "already-open");
  assert.equal(out.reloaded, true);
  assert.equal(store.getSnapshot().shiftKnown, true);
  assert.equal(store.getSnapshot().shift.id, 40);
  assert.ok(!seenLoading.includes(true));
  assert.deepEqual(homeOf(store), { row: "close-shift", showShiftActions: true });
});

test("'already opened' with the reload failing again → still unknown, message offers Retry", async () => {
  const out = await openShiftWithRecovery(
    {},
    {
      open: async () => ({ ok: false, status: 400, msg: "Shift already opened" }),
      reload: async () => assert.fail(),
      reloadInPlace: async () => false,
    },
  );
  assert.equal(out.kind, "already-open");
  assert.equal(out.reloaded, false);
  assert.match(out.message, /Could not load the shift — Retry/);
});

test("a normal open still does the full reload; other errors are plain failures", async () => {
  let full = 0;
  const opened = await openShiftWithRecovery(
    {},
    { open: async () => ({ ok: true, msg: "" }), reload: async () => (full++, true), reloadInPlace: async () => assert.fail() },
  );
  assert.deepEqual(opened, { kind: "opened" });
  assert.equal(full, 1);
  const failed = await openShiftWithRecovery(
    {},
    { open: async () => ({ ok: false, status: 400, msg: "cashInDrawer must be >= 0" }), reload: async () => assert.fail(), reloadInPlace: async () => assert.fail() },
  );
  assert.deepEqual(failed, { kind: "failed", message: "cashInDrawer must be >= 0" });
  assert.equal(isShiftAlreadyOpened({ ok: false, status: 0, msg: "Shift already opened" }), false);
});
