import assert from "node:assert/strict";
import test from "node:test";

import {
  SerialPortBusyError,
  SerialPortLock,
  createSerialPortHolder,
} from "./serial-port-lock.ts";

const label = () => createSerialPortHolder("a label print job");
const font = () => createSerialPortHolder("a Korean font install");

test("a free path can be claimed", () => {
  const lock = new SerialPortLock();
  assert.equal(lock.isBusy("COM3"), false);
  lock.acquire("COM3", label());
  assert.equal(lock.isBusy("COM3"), true);
  assert.equal(lock.heldBy("COM3"), "a label print job");
});

test("a different holder is refused by name, not queued", () => {
  // Fail fast: a font install runs for ten minutes over serial, and a label
  // that waited that long would be reprinted by hand long before it appeared.
  const lock = new SerialPortLock();
  lock.acquire("COM3", font());

  assert.throws(() => lock.acquire("COM3", label()), SerialPortBusyError);
  try {
    lock.acquire("COM3", label());
  } catch (err) {
    assert.match(err.message, /COM3/);
    assert.match(err.message, /Korean font install/);
  }
});

test("the refusal runs both ways", () => {
  const lock = new SerialPortLock();
  lock.acquire("COM3", label());
  assert.throws(() => lock.acquire("COM3", font()), /label print job/);
});

test("other paths are unaffected", () => {
  const lock = new SerialPortLock();
  lock.acquire("COM3", font());
  lock.acquire("COM4", label()); // must not throw
  assert.equal(lock.isBusy("COM4"), true);
});

test("the same holder nests, and only the outermost release frees the path", () => {
  // This is what an install relies on: it holds the path for the whole run and
  // re-takes it once per font as each connection opens.
  const lock = new SerialPortLock();
  const holder = font();

  const outer = lock.acquire("COM3", holder);
  const inner = lock.acquire("COM3", holder);

  inner();
  assert.equal(lock.isBusy("COM3"), true, "the run is still holding it");
  assert.throws(() => lock.acquire("COM3", label()), SerialPortBusyError);

  outer();
  assert.equal(lock.isBusy("COM3"), false);
  lock.acquire("COM3", label()); // now free
});

test("releasing twice does not hand the port away early", () => {
  // Every caller releases in a finally; a double release that decremented twice
  // would let a label open the port while a font was still streaming.
  const lock = new SerialPortLock();
  const holder = font();

  const outer = lock.acquire("COM3", holder);
  const inner = lock.acquire("COM3", holder);
  inner();
  inner();
  inner();

  assert.equal(lock.isBusy("COM3"), true);
  outer();
  assert.equal(lock.isBusy("COM3"), false);
});

test("a stale release cannot free somebody else's claim", () => {
  const lock = new SerialPortLock();
  const stale = lock.acquire("COM3", font());
  stale();

  lock.acquire("COM3", label());
  stale(); // already spent, and for the wrong holder besides
  assert.equal(lock.heldBy("COM3"), "a label print job");
});

test("isHeldBy distinguishes the holder from any other", () => {
  const lock = new SerialPortLock();
  const holder = font();
  lock.acquire("COM3", holder);

  assert.equal(lock.isHeldBy("COM3", holder), true);
  assert.equal(lock.isHeldBy("COM3", label()), false);
  assert.equal(lock.isHeldBy("COM9", holder), false);
  assert.equal(lock.heldBy("COM9"), null);
});

test("two holders built from the same description are still distinct", () => {
  // Identity is the object, not the text — two label jobs must still conflict.
  const lock = new SerialPortLock();
  lock.acquire("COM3", label());
  assert.throws(() => lock.acquire("COM3", label()), SerialPortBusyError);
});
