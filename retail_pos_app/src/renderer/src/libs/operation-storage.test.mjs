// npm run test:sale-core (retail-runner T-1) — injectable attempt store.
import assert from "node:assert/strict";
import test from "node:test";

import {
  operationIdFor,
  saleAttemptKey,
  setOperationStorage,
  settleOperation,
} from "./operation-id.ts";

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

test.afterEach(() => setOperationStorage(null));

test("injected store: mint → record → replay returns the same operationId", () => {
  const store = memoryStorage();
  setOperationStorage(store);
  const key = saleAttemptKey(0);

  const minted = operationIdFor(key, 1000);
  assert.equal(store.map.size, 1, "the attempt is recorded before the request");
  assert.deepEqual(JSON.parse(store.map.get("ktpv5.operationAttempt.sale:cart:0")), {
    operationId: minted,
    createdAt: 1000,
  });

  // Lost answer (network): the attempt is kept, the retry replays the same id.
  settleOperation(key, { ok: false, result: null });
  assert.equal(operationIdFor(key), minted);

  // Server answered (replayed invoice): the attempt ends, next one is new.
  settleOperation(key, { ok: true, result: { replayed: true } });
  assert.equal(store.map.size, 0);
  assert.notEqual(operationIdFor(key), minted);
});

test("no store (node has no localStorage): each call mints a new id", () => {
  assert.equal(typeof localStorage, "undefined");
  const key = saleAttemptKey(1);
  assert.notEqual(operationIdFor(key), operationIdFor(key));
});

test("setOperationStorage(null) restores the default", () => {
  const store = memoryStorage();
  setOperationStorage(store);
  operationIdFor(saleAttemptKey(2));
  setOperationStorage(null);
  const key = saleAttemptKey(2);
  assert.notEqual(operationIdFor(key), operationIdFor(key));
  assert.equal(store.map.size, 1, "injected store untouched after reset");
});
