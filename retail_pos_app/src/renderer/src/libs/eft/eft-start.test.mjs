// npm run test:sale-core (retail-eftpos T-7 round 1) — PAY ON TERMINAL start
// guard: durable attempt id before the create (F-14, A-29), Cancel during
// persistence never sends (F-13), one start at a time.
import assert from "node:assert/strict";
import test from "node:test";

import { createEftStarter } from "./eft-start.ts";
import { operationIdFor, pendingOperation, setOperationStorage } from "../operation-id.ts";

function memoryStorage({ failWrites = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
  };
}

const realDeps = (persist = async () => undefined) => ({
  mint: (key) => operationIdFor(key),
  persist,
  stored: (key) => pendingOperation(key)?.operationId ?? null,
});

test("F-14: a storage write failure blocks the create (no id that a retry could not repeat)", async (t) => {
  setOperationStorage(memoryStorage({ failWrites: true }));
  t.after(() => setOperationStorage(null));
  const sent = [];
  const r = await createEftStarter(realDeps()).start("sale:cart:0", () => true, (id) => sent.push(id));
  assert.equal(r, "not-durable");
  assert.deepEqual(sent, []);
});

test("A-29: a stored attempt id is sent, and the same id again on the next tap", async (t) => {
  setOperationStorage(memoryStorage());
  t.after(() => setOperationStorage(null));
  const sent = [];
  const starter = createEftStarter(realDeps());
  assert.equal(await starter.start("sale:cart:1", () => true, (id) => sent.push(id)), "sent");
  assert.equal(await starter.start("sale:cart:1", () => true, (id) => sent.push(id)), "sent");
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], "same durable id → the server answers the same row");
});

test("F-13: Cancel while persistence is pending → no create; a second tap meanwhile is refused", async (t) => {
  setOperationStorage(memoryStorage());
  t.after(() => setOperationStorage(null));
  let release;
  const starter = createEftStarter(realDeps(() => new Promise((r) => (release = r))));
  const sent = [];
  const first = starter.start("sale:cart:2", () => true, (id) => sent.push(id));
  assert.equal(starter.isStarting(), true);
  assert.equal(await starter.start("sale:cart:2", () => true, (id) => sent.push(id)), "busy");
  starter.cancel(); // panel closed / unmounted
  release();
  assert.equal(await first, "abandoned");
  assert.deepEqual(sent, []);
  assert.equal(starter.isStarting(), false);
});

test("F-13: a start whose context changed during persistence (cart switched) is abandoned", async (t) => {
  setOperationStorage(memoryStorage());
  t.after(() => setOperationStorage(null));
  const sent = [];
  const r = await createEftStarter(realDeps()).start("sale:cart:3", () => false, (id) => sent.push(id));
  assert.equal(r, "abandoned");
  assert.deepEqual(sent, []);
});

test("A-29: a persist that throws blocks the create", async () => {
  const sent = [];
  const starter = createEftStarter({ mint: () => "op-12345678", persist: async () => Promise.reject(new Error("disk")), stored: () => "op-12345678" });
  assert.equal(await starter.start("k", () => true, (id) => sent.push(id)), "not-durable");
  assert.deepEqual(sent, []);
});
