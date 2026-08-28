import assert from "node:assert/strict";
import test from "node:test";

import {
  SERIAL_CHUNK_SIZE,
  SERIAL_OVERALL_TIMEOUT_CAP_MS,
  SERIAL_OVERALL_TIMEOUT_FLOOR_MS,
  SerialPrinterConnection,
  chunkOffsets,
  resolveSerialChunkSize,
  serialOverallTimeoutMs,
} from "./serial-transport.ts";
import { normalizeTarget, targetKey, describeTarget, sameTarget } from "./target.ts";

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

test("chunks never exceed 4 KiB, whatever is asked for", () => {
  // The cap is the whole point: it bounds how much is in flight when a printer
  // stops reading, and it is the granularity progress moves at.
  assert.equal(resolveSerialChunkSize(undefined), SERIAL_CHUNK_SIZE);
  assert.equal(resolveSerialChunkSize(64 * 1024), SERIAL_CHUNK_SIZE);
  assert.equal(resolveSerialChunkSize(2048), 2048);
  assert.equal(resolveSerialChunkSize(0), SERIAL_CHUNK_SIZE);
  assert.equal(resolveSerialChunkSize(Number.NaN), SERIAL_CHUNK_SIZE);
  assert.equal(resolveSerialChunkSize(1), 256, "a chunk per byte would be absurd");
});

test("chunk offsets cover the payload exactly once", () => {
  assert.deepEqual(chunkOffsets(0), []);
  assert.deepEqual(chunkOffsets(1, 4096), [0]);
  assert.deepEqual(chunkOffsets(4096, 4096), [0]);
  assert.deepEqual(chunkOffsets(4097, 4096), [0, 4096]);
  assert.deepEqual(chunkOffsets(10_000, 4096), [0, 4096, 8192]);

  const total = 2_450_000;
  const offsets = chunkOffsets(total, SERIAL_CHUNK_SIZE);
  assert.equal(offsets.length, Math.ceil(total / SERIAL_CHUNK_SIZE));
  assert.equal(offsets.at(-1) < total, true);
});

test("the overall deadline is generous enough for a real font and still bounded", () => {
  // 2.45MB at 115200 baud is about 213s of wire time. The budget must clear
  // that comfortably — if it did not, every install would die at the same point.
  const font = 2_450_000;
  const budget = serialOverallTimeoutMs(font);
  assert.ok(budget > 213_000 * 1.3, `budget ${budget}ms leaves no headroom`);
  assert.ok(budget <= SERIAL_OVERALL_TIMEOUT_CAP_MS);

  assert.equal(serialOverallTimeoutMs(0), SERIAL_OVERALL_TIMEOUT_FLOOR_MS);
  assert.equal(serialOverallTimeoutMs(1), SERIAL_OVERALL_TIMEOUT_FLOOR_MS, "a query gets the floor");
  assert.equal(serialOverallTimeoutMs(-5), SERIAL_OVERALL_TIMEOUT_FLOOR_MS);
  assert.equal(serialOverallTimeoutMs(8192), SERIAL_OVERALL_TIMEOUT_FLOOR_MS);
  assert.equal(serialOverallTimeoutMs(8192 * 100), 100_000);
  assert.equal(serialOverallTimeoutMs(Number.POSITIVE_INFINITY), SERIAL_OVERALL_TIMEOUT_FLOOR_MS);
  assert.equal(serialOverallTimeoutMs(1e12), SERIAL_OVERALL_TIMEOUT_CAP_MS);
});

test("the deadline grows monotonically with the payload", () => {
  let previous = 0;
  for (const bytes of [0, 100_000, 1_000_000, 2_450_000, 7_350_000]) {
    const budget = serialOverallTimeoutMs(bytes);
    assert.ok(budget >= previous, `${bytes} bytes went backwards`);
    previous = budget;
  }
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

test("a legacy host/port target still means net", () => {
  // Older renderer bundles send this shape; coercing it costs one branch and
  // saves a flag day between the main and renderer builds.
  assert.deepEqual(normalizeTarget({ host: "10.0.0.5", port: 9100 }), {
    type: "net",
    host: "10.0.0.5",
    port: 9100,
  });
  assert.deepEqual(normalizeTarget({ type: "serial", path: "COM3" }), {
    type: "serial",
    path: "COM3",
  });
  assert.throws(() => normalizeTarget({ type: "serial", path: "  " }), /no port path/);
});

test("target keys separate the transports and describe themselves", () => {
  const net = normalizeTarget({ host: "10.0.0.5", port: 9100 });
  const serial = normalizeTarget({ type: "serial", path: "COM3" });

  assert.notEqual(targetKey(net), targetKey(serial));
  assert.equal(describeTarget(net), "10.0.0.5:9100");
  assert.equal(describeTarget(serial), "COM3");
  assert.equal(sameTarget(net, normalizeTarget({ type: "net", host: "10.0.0.5", port: 9100 })), true);
  assert.equal(sameTarget(net, serial), false);
});

// ---------------------------------------------------------------------------
// The connection, against a fake port
//
// No serialport import and no real device: the transport takes its port as an
// injected object precisely so this can be exercised on a build machine.
// ---------------------------------------------------------------------------

/**
 * A serial port that behaves, or misbehaves in one specific way.
 *
 * `mode`: "ok" drains everything; "stall" accepts the write and never drains,
 * which is exactly what a paused or powered-off printer does — no error, no
 * event, just silence.
 */
function fakePort(opts = {}) {
  const { mode = "ok", reply = "", path = "COM-TEST" } = opts;
  const listeners = { data: [], error: [], close: [] };
  const port = {
    path,
    written: [],
    writes: [],
    closed: false,
    destroyed: false,
    drainCount: 0,

    write(data, callback) {
      if (port.destroyed) {
        callback(new Error("write after destroy"));
        return false;
      }
      port.writes.push(data.length);
      port.written.push(Buffer.from(data));
      callback(null);
      return true;
    },
    drain(callback) {
      if (mode === "stall") return; // no callback, ever — the realistic failure
      port.drainCount += 1;
      // Async, like the real one: a synchronous callback would hide re-entrancy.
      setTimeout(() => {
        callback(null);
        if (reply) port.emit("data", Buffer.from(reply, "latin1"));
      }, 1);
    },
    async close() {
      port.closed = true;
    },
    destroy() {
      port.destroyed = true;
      port.closed = true;
    },
    onData: (l) => subscribe("data", l),
    onError: (l) => subscribe("error", l),
    onClose: (l) => subscribe("close", l),

    emit(event, arg) {
      for (const l of [...listeners[event]]) l(arg);
    },
    get body() {
      return Buffer.concat(port.written);
    },
  };

  function subscribe(event, listener) {
    listeners[event].push(listener);
    return () => {
      const at = listeners[event].indexOf(listener);
      if (at >= 0) listeners[event].splice(at, 1);
    };
  }

  return port;
}

const linkOpts = (port, extra = {}) => ({ open: async () => port, ...extra });

test("a payload is delivered byte-for-byte in 4 KiB pieces, each one drained", async () => {
  const port = fakePort();
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port), 100_000);

  const payload = Buffer.alloc(10_000, 0x41);
  payload.write("^XZ~DY", 0, "latin1"); // ZPL bytes must pass through untouched
  await conn.write(payload);
  await conn.close();

  assert.deepEqual(port.body, payload, "the printer must receive exactly what was sent");
  assert.deepEqual(port.writes, [4096, 4096, 1808]);
  assert.equal(port.drainCount, 3, "every chunk waits for drain before the next");
  assert.equal(conn.chunkSize, SERIAL_CHUNK_SIZE);
  assert.equal(port.closed, true);
});

test("a port that stops draining fails inside the chunk timeout instead of hanging", async () => {
  // The realistic serial failure: the write is accepted, the bytes sit in the
  // OS buffer, and nothing ever fires. Only the timer can end that wait.
  const port = fakePort({ mode: "stall" });
  const conn = await SerialPrinterConnection.open(
    "COM-TEST",
    linkOpts(port, { chunkTimeoutMs: 120 }),
    100_000,
  );

  const started = Date.now();
  await assert.rejects(() => conn.write(Buffer.alloc(9_000)), /accepted no data/);
  assert.ok(Date.now() - started < 2_000, "a stalled port must not hang the transfer");
  assert.equal(port.destroyed, true, "a half-written ~DY must leave the port unusable");
});

test("the overall deadline stops a port that is slow rather than dead", async () => {
  // Every chunk lands inside the per-chunk timeout, so only the payload-scaled
  // deadline can end this.
  const port = fakePort();
  const conn = await SerialPrinterConnection.open(
    "COM-TEST",
    linkOpts(port, { overallTimeoutMs: 30 }),
    100_000,
  );

  await new Promise((r) => setTimeout(r, 60));
  await assert.rejects(() => conn.write(Buffer.alloc(9_000)), /past its deadline/);
  assert.equal(port.destroyed, true);
});

test("an error on the port ends the write in progress", async () => {
  const port = fakePort({ mode: "stall" });
  const conn = await SerialPrinterConnection.open(
    "COM-TEST",
    linkOpts(port, { chunkTimeoutMs: 5_000 }),
    100_000,
  );

  const writing = conn.write(Buffer.alloc(5_000));
  setTimeout(() => port.emit("error", new Error("device disconnected")), 10);
  await assert.rejects(() => writing, /device disconnected/);
});

test("the port closing mid-transfer is an error, not a silent success", async () => {
  const port = fakePort({ mode: "stall" });
  const conn = await SerialPrinterConnection.open(
    "COM-TEST",
    linkOpts(port, { chunkTimeoutMs: 5_000 }),
    100_000,
  );

  const writing = conn.write(Buffer.alloc(5_000));
  setTimeout(() => port.emit("close"), 10);
  await assert.rejects(() => writing, /closed mid-transfer/);
});

test("a reply is collected once the port goes quiet", async () => {
  const port = fakePort({ reply: "ZD421-200dpi,V93.21.37Z,8,8192KB" });
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port));

  await conn.write("~HI");
  const raw = await conn.collect({ idleMs: 60, maxMs: 2_000 });
  await conn.close();

  assert.match(raw, /ZD421-200dpi/);
});

test("a printer that never answers yields an empty string, not an error", async () => {
  // Silence is a classification, not a failure: a Bixolon answers nothing, and
  // a TX-only cable cannot answer at all. service.ts reads "" as work blind.
  const port = fakePort();
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port));

  await conn.write("~HI");
  const raw = await conn.collect({ idleMs: 50, maxMs: 200 });
  await conn.close();

  assert.equal(raw, "");
});

test("settle reports a port that dropped after the last bytes went out", async () => {
  const port = fakePort();
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port), 1_000);

  await conn.write(Buffer.alloc(100));
  port.emit("close");
  await assert.rejects(() => conn.settle(5), /closed before the transfer was acknowledged/);
});

test("close is idempotent and always lets the port go", async () => {
  const port = fakePort();
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port));

  await conn.close();
  await conn.close();
  assert.equal(port.closed, true);
});

test("a close that hangs is escalated to destroy rather than left open", async () => {
  // The lease on the path is released by close or destroy and by nothing else;
  // a close that never resolves would lock the printer out until a restart.
  const port = fakePort();
  port.close = () => new Promise(() => {});
  const conn = await SerialPrinterConnection.open("COM-TEST", linkOpts(port));

  // The internal escalation timeout is 5s; drive it by failing the close fast.
  port.close = async () => {
    throw new Error("close failed");
  };
  await conn.close();
  assert.equal(port.destroyed, true);
});
