// npm run test:orders (T-10 review round 3) — shift state store + Close Shift
// screen view after a SHIFT_MISMATCH.
import assert from "node:assert/strict";
import test from "node:test";

import { createShiftStateStore } from "./shift-state.ts";
import {
  SHIFT_LOAD_FAILED_MESSAGE,
  closeShiftGuarded,
  closeShiftView,
  reloadStaleShift,
} from "./shift-close.ts";

// GET /api/shift/current with answers released by hand.
function controllableServer() {
  const pending = [];
  const fetchCurrent = () =>
    new Promise((resolve) => pending.push(resolve));
  return { pending, fetchCurrent, answer: (i, res) => pending[i](res) };
}

function recordLoading(store) {
  const seen = [];
  store.subscribe(() => seen.push(store.getSnapshot().loading));
  return seen;
}

const shiftAnswer = (id) => ({ ok: true, result: id == null ? null : { id } });
const NETWORK_DOWN = { ok: false, status: 0, msg: "Network Error", result: null };

async function bootTo(shiftId) {
  const server = controllableServer();
  const store = createShiftStateStore(server.fetchCurrent);
  const boot = store.setTerminal(1);
  server.answer(0, shiftAnswer(shiftId));
  assert.equal(await boot, true);
  return { server, store };
}

// The Close Shift flow wired as ShiftContext wires it.
function closeDeps(store, close) {
  return {
    close,
    reloadShift: () => store.reload({ inPlace: true }),
    onClosed: () => store.setShift(null),
    staleShiftId: () => store.getSnapshot().staleShiftId,
    setStaleShiftId: (id) => store.setStaleShiftId(id),
    shiftKnown: () => store.getSnapshot().shiftKnown,
  };
}

// What CloseShiftScreen derives from the store snapshot.
const viewOf = (store, preview) => {
  const snap = store.getSnapshot();
  return closeShiftView({
    hasShift: snap.shift != null,
    staleShiftId: snap.staleShiftId,
    preview,
    shiftKnown: snap.shiftKnown,
  });
};

const mismatch409 = (expectedShiftId, currentOpenShiftId) => async () => ({
  ok: false,
  status: 409,
  msg: "no longer open",
  result: { code: "SHIFT_MISMATCH", expectedShiftId, currentOpenShiftId },
});

test("boot read is a full load; the stale reload is in place (Gateway never unmounts the screen)", async () => {
  const server = controllableServer();
  const store = createShiftStateStore(server.fetchCurrent);
  const boot = store.setTerminal(1);
  assert.equal(store.getSnapshot().loading, true);
  server.answer(0, shiftAnswer(12));
  await boot;
  assert.equal(store.getSnapshot().loading, false);

  const seen = recordLoading(store);
  const retry = store.reload({ inPlace: true });
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().shift.id, 12, "current shift kept until the answer");
  server.answer(1, shiftAnswer(13));
  assert.equal(await retry, true);
  assert.deepEqual(seen, [false], "loading was never raised");
  assert.equal(store.getSnapshot().shift.id, 13);
});

test("mismatch → failed reload → the screen still shows Retry / Home / Cancel (no Loading), Close disabled, nothing resent", async () => {
  const { server, store } = await bootTo(12);
  const seen = recordLoading(store);
  let sent = 0;
  const close = async (body) => (sent++, mismatch409(body.expectedShiftId, 13)());

  const pressed = closeShiftGuarded({ endedCashActual: 1, expectedShiftId: 12 }, closeDeps(store, close));
  await new Promise((r) => setImmediate(r));
  server.answer(1, NETWORK_DOWN);
  const out = await pressed;
  assert.equal(out.kind, "mismatch");
  assert.equal(out.reloaded, false);
  assert.ok(!seen.includes(true), "the provider never went into full-screen loading");

  const snap = store.getSnapshot();
  assert.equal(snap.shift.id, 12);
  assert.equal(snap.staleShiftId, 12);
  // The preview of the old shift is still on screen (or failed): either way
  // the banner and header render and Close stays disabled.
  for (const preview of ["ready", "failed", "loading"]) {
    const view = closeShiftView({ hasShift: snap.shift != null, staleShiftId: snap.staleShiftId, preview });
    assert.equal(view.staleBanner, true);
    assert.equal(view.canClose, false);
  }
  const again = await closeShiftGuarded({ endedCashActual: 1, expectedShiftId: 12 }, closeDeps(store, close));
  assert.equal(again.kind, "stale");
  assert.equal(sent, 1);
});

test("preview failure with no open shift → not stuck on Loading; the body says so and Home is reachable", () => {
  const view = closeShiftView({ hasShift: true, staleShiftId: null, preview: "failed" });
  assert.deepEqual(view, { staleBanner: false, unknownBanner: false, body: "preview-failed", canClose: false });
  assert.deepEqual(closeShiftView({ hasShift: false, staleShiftId: null, preview: "loading" }), {
    staleBanner: false,
    unknownBanner: false,
    body: "no-shift",
    canClose: false,
  });
  assert.deepEqual(closeShiftView({ hasShift: true, staleShiftId: null, preview: "ready" }), {
    staleBanner: false,
    unknownBanner: false,
    body: "ready",
    canClose: true,
  });
});

test("Home, then re-entry → the entry Retry reload succeeds → no stuck banner; the next close targets the current shift once", async () => {
  const { server, store } = await bootTo(12);
  const closes = [];
  const close = async (body) => {
    closes.push(body.expectedShiftId);
    return body.expectedShiftId === 13 ? { ok: true, msg: "" } : mismatch409(body.expectedShiftId, 13)();
  };
  const pressed = closeShiftGuarded({ endedCashActual: 1, expectedShiftId: 12 }, closeDeps(store, close));
  await new Promise((r) => setImmediate(r));
  server.answer(1, NETWORK_DOWN);
  await pressed;
  assert.equal(store.getSnapshot().staleShiftId, 12);

  // Home → back to Close Shift: the screen retries on entry while stale.
  const entry = reloadStaleShift({
    reloadShift: () => store.reload({ inPlace: true }),
    setStaleShiftId: (id) => store.setStaleShiftId(id),
  });
  server.answer(2, shiftAnswer(13));
  assert.equal(await entry, true);
  const snap = store.getSnapshot();
  assert.equal(snap.staleShiftId, null, "banner gone");
  assert.equal(closeShiftView({ hasShift: true, staleShiftId: snap.staleShiftId, preview: "ready" }).staleBanner, false);

  const out = await closeShiftGuarded({ endedCashActual: 2, expectedShiftId: snap.shift.id }, closeDeps(store, close));
  assert.deepEqual(out, { kind: "closed" });
  assert.deepEqual(closes, [12, 13]);
});

test("latest-read ownership: an older GET answering after a successful Retry is ignored", async () => {
  const { server, store } = await bootTo(12);
  store.setStaleShiftId(12);
  const older = store.reload(); // e.g. the post-open / refresh read, slow
  const retry = reloadStaleShift({
    reloadShift: () => store.reload({ inPlace: true }),
    setStaleShiftId: (id) => store.setStaleShiftId(id),
  });
  server.answer(2, shiftAnswer(13)); // Retry answers first
  assert.equal(await retry, true);
  server.answer(1, shiftAnswer(12)); // the old answer lands late
  assert.equal(await older, false, "the older read no longer owns the state");
  assert.equal(store.getSnapshot().shift.id, 13, "the rejected shift 12 did not come back");
  assert.equal(store.getSnapshot().staleShiftId, null);
  assert.equal(store.getSnapshot().loading, false);
});

test("a Retry overtaken by a newer read does not clear the stale marker", async () => {
  const { server, store } = await bootTo(12);
  store.setStaleShiftId(12);
  const retry = reloadStaleShift({
    reloadShift: () => store.reload({ inPlace: true }),
    setStaleShiftId: (id) => store.setStaleShiftId(id),
  });
  const newer = store.reload({ inPlace: true });
  server.answer(1, shiftAnswer(13));
  assert.equal(await retry, false);
  assert.equal(store.getSnapshot().staleShiftId, 12);
  server.answer(2, shiftAnswer(13));
  assert.equal(await newer, true);
});

test("terminal identity change clears the stale marker; a refresh of the same terminal keeps it", async () => {
  const { server, store } = await bootTo(12);
  store.setStaleShiftId(12);
  const same = store.setTerminal(1);
  server.answer(1, NETWORK_DOWN);
  await same;
  assert.equal(store.getSnapshot().staleShiftId, 12, "same terminal: still stale");

  const other = store.setTerminal(2);
  assert.equal(store.getSnapshot().staleShiftId, null, "another terminal: marker dropped");
  server.answer(2, shiftAnswer(40));
  await other;
  assert.equal(store.getSnapshot().shift.id, 40);

  store.setStaleShiftId(40);
  await store.setTerminal(null);
  assert.equal(store.getSnapshot().staleShiftId, null);
  assert.equal(store.getSnapshot().loading, false);
});

// T-10 review round 4 — a terminal change drops the old terminal's shift.

test("repro: terminal 1 stale on shift 12 → terminal 2 whose GET fails → Close disabled, nothing sent; Retry → closes terminal 2's shift once", async () => {
  const { server, store } = await bootTo(12);
  let sent = [];
  const close = async (body) => (sent.push(body.expectedShiftId), { ok: true, msg: "" });
  store.setStaleShiftId(12);

  const switched = store.setTerminal(2);
  assert.equal(store.getSnapshot().shift, null, "terminal 1's shift dropped at once");
  server.answer(1, NETWORK_DOWN);
  assert.equal(await switched, false);

  const snap = store.getSnapshot();
  assert.equal(snap.shift, null);
  assert.equal(snap.staleShiftId, null);
  assert.equal(snap.shiftKnown, false);
  // Even if a preview (for the new terminal's shift 40) succeeded, Close
  // stays unavailable and the retryable banner shows.
  for (const preview of ["ready", "failed", "loading"]) {
    const view = viewOf(store, preview);
    assert.equal(view.unknownBanner, true);
    assert.equal(view.canClose, false);
  }
  assert.equal(viewOf(store, "ready").body, "unknown");
  // A close attempt with the old id is refused before any request.
  const refused = await closeShiftGuarded({ endedCashActual: 1, expectedShiftId: 12 }, closeDeps(store, close));
  assert.deepEqual(refused, { kind: "stale", message: SHIFT_LOAD_FAILED_MESSAGE });
  assert.deepEqual(sent, []);

  // Retry (the banner's button / screen entry) → terminal 2's shift 40.
  const retry = reloadStaleShift({
    reloadShift: () => store.reload({ inPlace: true }),
    setStaleShiftId: (id) => store.setStaleShiftId(id),
  });
  server.answer(2, shiftAnswer(40));
  assert.equal(await retry, true);
  assert.equal(store.getSnapshot().shiftKnown, true);
  assert.equal(viewOf(store, "ready").canClose, true);

  const out = await closeShiftGuarded(
    { endedCashActual: 2, expectedShiftId: store.getSnapshot().shift.id },
    closeDeps(store, close),
  );
  assert.deepEqual(out, { kind: "closed" });
  assert.deepEqual(sent, [40]);
});

test("a late answer from the old terminal's read cannot fill the new terminal's state", async () => {
  const { server, store } = await bootTo(12);
  const oldRead = store.reload({ inPlace: true }); // terminal 1, slow
  const switched = store.setTerminal(2);
  server.answer(1, shiftAnswer(12)); // terminal 1's answer lands late
  assert.equal(await oldRead, false);
  assert.equal(store.getSnapshot().shift, null);
  assert.equal(store.getSnapshot().shiftKnown, false);
  server.answer(2, shiftAnswer(40));
  assert.equal(await switched, true);
  assert.equal(store.getSnapshot().shift.id, 40);
});

test("same-terminal refresh is unchanged: shift kept and known even when the refresh read fails", async () => {
  const { server, store } = await bootTo(12);
  const refresh = store.setTerminal(1);
  assert.equal(store.getSnapshot().shift.id, 12);
  server.answer(1, NETWORK_DOWN);
  assert.equal(await refresh, false);
  const snap = store.getSnapshot();
  assert.equal(snap.shift.id, 12);
  assert.equal(snap.shiftKnown, true);
  assert.equal(viewOf(store, "ready").canClose, true);
});
