// npm run test:orders (T-24 audit R-17 — shared store-setting cache)
import assert from "node:assert/strict";
import test from "node:test";

import { createStoreSettingCache } from "./store-setting-cache.ts";

function fakeServer() {
  let requests = 0;
  let version = 1;
  const pending = [];
  return {
    fetcher: () => {
      requests++;
      const v = version;
      return new Promise((resolve) => pending.push(() => resolve({ ok: true, result: { id: 1, version: v } })));
    },
    answerAll: async () => {
      while (pending.length) pending.shift()();
      await new Promise((r) => setImmediate(r));
    },
    requests: () => requests,
    bump: () => version++,
  };
}

// What useStoreSetting does on mount: subscribe + ensure().
function mount(cache) {
  let renders = 0;
  const unsubscribe = cache.subscribe(() => renders++);
  const p = cache.ensure();
  return { unsubscribe, p, renders: () => renders };
}

test("two consumers mounting together issue ONE request and share the value", async () => {
  const server = fakeServer();
  const cache = createStoreSettingCache(server.fetcher);
  const a = mount(cache);
  const b = mount(cache);
  assert.equal(server.requests(), 1);
  assert.equal(cache.getSnapshot().loading, true);
  await server.answerAll();
  await Promise.all([a.p, b.p]);
  assert.deepEqual(cache.getSnapshot(), { value: { id: 1, version: 1 }, loading: false });

  // a third consumer mounted later reuses the value
  mount(cache);
  assert.equal(server.requests(), 1);
});

test("invalidate (setting save / cloud Sync) refetches once for every mounted consumer", async () => {
  const server = fakeServer();
  const cache = createStoreSettingCache(server.fetcher);
  mount(cache);
  mount(cache);
  await server.answerAll();
  server.bump();
  cache.invalidate();
  assert.equal(server.requests(), 2);
  await server.answerAll();
  assert.equal(cache.getSnapshot().value.version, 2);
});

test("an answer in flight when invalidated is not kept", async () => {
  const server = fakeServer();
  const cache = createStoreSettingCache(server.fetcher);
  mount(cache);
  server.bump(); // the save lands while the first GET is in flight
  cache.invalidate();
  await server.answerAll();
  assert.equal(cache.getSnapshot().value.version, 2);
  assert.equal(server.requests(), 2);
});

test("a stale value (older than maxAge) is refetched on the next mount", async () => {
  const server = fakeServer();
  let t = 0;
  const cache = createStoreSettingCache(server.fetcher, { maxAgeMs: 1000, now: () => t });
  mount(cache);
  await server.answerAll();
  t = 500;
  mount(cache);
  assert.equal(server.requests(), 1);
  t = 1500;
  mount(cache);
  assert.equal(server.requests(), 2);
});

test("a failed GET ({ok:false,result:null}) is not fresh: the next mount retries", async () => {
  let requests = 0;
  const answers = [{ ok: false, result: null }, { ok: true, result: { id: 1, credit_surcharge_rate: 15 } }];
  const cache = createStoreSettingCache(async () => answers[Math.min(requests++, answers.length - 1)]);
  await mount(cache).p;
  assert.deepEqual(cache.getSnapshot(), { value: null, loading: false });
  await mount(cache).p; // e.g. PaymentModal opening right after
  assert.equal(requests, 2, "retried instead of pinning the failure for 5 min");
  assert.deepEqual(cache.getSnapshot().value, { id: 1, credit_surcharge_rate: 15 });
  await mount(cache).p;
  assert.equal(requests, 2, "a good value is cached");
});

test("a thrown fetch is not fresh either", async () => {
  let requests = 0;
  const cache = createStoreSettingCache(async () => {
    requests++;
    if (requests === 1) throw new Error("net");
    return { ok: true, result: { id: 1 } };
  });
  await mount(cache).p;
  await mount(cache).p;
  assert.equal(requests, 2);
  assert.deepEqual(cache.getSnapshot().value, { id: 1 });
});
