// npm run test:orders (T-10 review) — shift close after a 409 SHIFT_MISMATCH.
import assert from "node:assert/strict";
import test from "node:test";

import { closeShiftGuarded, shiftMismatchMessage, shiftMismatchOf } from "./shift-close.ts";

// A fake store server: one open shift per terminal; close guarded like
// shift.service closeTerminalShiftService.
function fakeServer(openShiftId) {
  const server = { open: openShiftId, closes: [] };
  server.close = async (body) => {
    if (body.expectedShiftId != null && body.expectedShiftId !== server.open) {
      return {
        ok: false,
        msg: "Shift is no longer the open shift",
        result: { code: "SHIFT_MISMATCH", expectedShiftId: body.expectedShiftId, currentOpenShiftId: server.open },
      };
    }
    if (server.open == null) return { ok: false, msg: "No open shift found" };
    server.closes.push({ id: server.open, endedCashActual: body.endedCashActual });
    server.open = null;
    return { ok: true, msg: "Terminal shift closed successfully", result: {} };
  };
  return server;
}

// Till state as ShiftContext holds it.
function till(server, shiftId) {
  const state = { shift: shiftId == null ? null : { id: shiftId }, reloads: 0 };
  const deps = {
    close: server.close,
    reloadShift: async () => {
      state.reloads++;
      state.shift = server.open == null ? null : { id: server.open };
    },
    onClosed: () => (state.shift = null),
  };
  const press = (endedCashActual) =>
    closeShiftGuarded({ closedNote: "", endedCashActual, expectedShiftId: state.shift.id }, deps);
  return { state, press };
}

test("mismatch → shift reloaded from the server → the next close targets the current shift, once", async () => {
  // Shift 12's close committed, its answer was lost; shift 13 opened since.
  const server = fakeServer(13);
  const t = till(server, 12);

  const first = await t.press(12_345);
  assert.equal(first.kind, "mismatch");
  assert.deepEqual(first.mismatch, { expectedShiftId: 12, currentOpenShiftId: 13 });
  assert.match(first.message, /Shift 12 is no longer open\. Shift 13 is open now/);
  assert.equal(t.state.reloads, 1);
  assert.equal(t.state.shift.id, 13, "till state now holds the open shift");
  assert.equal(server.closes.length, 0, "nothing closed by the stale press");

  const second = await t.press(20_000); // fresh count for shift 13
  assert.deepEqual(second, { kind: "closed" });
  assert.deepEqual(server.closes, [{ id: 13, endedCashActual: 20_000 }]);
  assert.equal(t.state.shift, null);
});

test("mismatch with no open shift → state reloaded to none; message says no shift is open", async () => {
  const server = fakeServer(null);
  const t = till(server, 12);
  const out = await t.press(100);
  assert.equal(out.kind, "mismatch");
  assert.equal(out.mismatch.currentOpenShiftId, null);
  assert.match(out.message, /No shift is open on this terminal now/);
  assert.equal(t.state.shift, null);
  assert.equal(server.closes.length, 0);
});

test("matching shift closes without a reload; other failures are not mismatches", async () => {
  const server = fakeServer(7);
  const t = till(server, 7);
  assert.deepEqual(await t.press(500), { kind: "closed" });
  assert.equal(t.state.reloads, 0);

  const failed = await closeShiftGuarded(
    { endedCashActual: 0, expectedShiftId: 7 },
    { close: async () => ({ ok: false, status: 0, msg: "", result: null }), reloadShift: async () => assert.fail(), onClosed: () => assert.fail() },
  );
  assert.deepEqual(failed, { kind: "failed", message: "Failed to close shift" });
  assert.equal(shiftMismatchOf({ ok: false, msg: "x", result: { code: "OPERATION_IN_PROGRESS" } }), null);
  assert.equal(
    shiftMismatchMessage({ expectedShiftId: 4, currentOpenShiftId: 5 }),
    "Shift 4 is no longer open. Shift 5 is open now — nothing was closed. Count the drawer again to close shift 5.",
  );
});
