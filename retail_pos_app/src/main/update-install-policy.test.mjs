// npm run test:orders (T-24 audit R-10 — main-side install policy)
import assert from "node:assert/strict";
import test from "node:test";

import { UPDATE_IDLE_RETRY_MS, createUpdateInstallGate } from "./update-install-policy.ts";

function harness(answers) {
  const timers = [];
  let installs = 0;
  let asks = 0;
  const gate = createUpdateInstallGate({
    askIdle: async () => {
      const a = answers[Math.min(asks, answers.length - 1)];
      asks++;
      if (a instanceof Error) throw a;
      return a;
    },
    install: () => {
      installs++;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const fire = async () => {
    const t = timers.shift();
    t.fn();
    await new Promise((r) => setImmediate(r));
  };
  return { gate, timers, fire, installs: () => installs, asks: () => asks };
}

const flush = () => new Promise((r) => setImmediate(r));

test("idle at download → installs once, no retry scheduled", async () => {
  const h = harness([true]);
  h.gate.onUpdateDownloaded();
  await flush();
  assert.equal(h.installs(), 1);
  assert.equal(h.timers.length, 0);
  h.gate.onUpdateDownloaded(); // a second event changes nothing
  await flush();
  assert.equal(h.installs(), 1);
});

test("busy → re-asks every 60 s and installs at the first idle answer", async () => {
  const h = harness([false, false, true]);
  h.gate.onUpdateDownloaded();
  await flush();
  assert.equal(h.installs(), 0);
  assert.deepEqual(h.timers.map((t) => t.ms), [UPDATE_IDLE_RETRY_MS]);
  assert.equal(UPDATE_IDLE_RETRY_MS, 60_000);
  assert.equal(h.gate.isWaiting(), true);

  await h.fire(); // 60 s later: still busy
  assert.equal(h.installs(), 0);
  assert.equal(h.timers.length, 1);

  await h.fire(); // idle now
  assert.equal(h.installs(), 1);
  assert.equal(h.timers.length, 0);
  assert.equal(h.asks(), 3);
});

test("no answer (renderer not ready / timeout / error) counts as busy", async () => {
  const h = harness([null, new Error("ipc gone"), true]);
  h.gate.onUpdateDownloaded();
  await flush();
  assert.equal(h.timers.length, 1);
  await h.fire();
  assert.equal(h.timers.length, 1);
  await h.fire();
  assert.equal(h.installs(), 1);
});

test("dispose (app quitting) stops the retry loop", async () => {
  const h = harness([false]);
  h.gate.onUpdateDownloaded();
  await flush();
  h.gate.dispose();
  assert.equal(h.timers.length, 0);
  assert.equal(h.installs(), 0);
});
