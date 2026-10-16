import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import type { Terminal, TerminalShift, User } from "../../generated/prisma/client";
import {
  createCashIOService,
  parseCashIODto,
  type CashIOCreateDeps,
  type PersistCashIOArgs,
  type RecordedCashIO,
} from "./cashio.service";
import { OPERATION_CODES, claimOperation, releaseOperation } from "../sale/sale.operation";

// T-10 (retail-runner, F-27) — Cash In/Out operation identity: the sale
// discipline with an in-memory CashInOut table (no DB).

const SHIFT = { id: 3 } as TerminalShift;
const TERMINAL = { id: 1, name: "T1" } as Terminal;
const USER = { id: 9, name: "Kim" } as User;

type PersistMode = "ok" | "fail" | "commit-then-throw" | "unique-race";

function harness() {
  const rows: Array<RecordedCashIO & PersistCashIOArgs["dto"] & { operationId: string }> = [];
  const persisted: PersistCashIOArgs[] = [];
  let mode: PersistMode = "ok";
  const record = (args: PersistCashIOArgs) => {
    const row = {
      id: rows.length + 1,
      ...args.dto,
      terminalId: args.terminal.id,
      operationId: args.operationId,
      operationPayloadHash: args.payloadHash,
    };
    rows.push(row);
    return { id: row.id };
  };
  const deps: CashIOCreateDeps = {
    findByOperationId: async (operationId) => {
      const row = rows.find((r) => r.operationId === operationId);
      return row
        ? { id: row.id, terminalId: row.terminalId, operationPayloadHash: row.operationPayloadHash }
        : null;
    },
    persist: async (args) => {
      persisted.push(args);
      if (mode === "fail") throw new Error("disk full");
      if (mode === "commit-then-throw") {
        mode = "ok";
        record(args);
        throw new Error("Connection terminated unexpectedly");
      }
      if (mode === "unique-race") {
        mode = "ok";
        record(args);
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      return record(args);
    },
  };
  return { rows, persisted, deps, setPersist: (m: PersistMode) => (mode = m) };
}

const OP = "cccccccc-1111-4222-8333-444444444444";
const create = (h: ReturnType<typeof harness>, body: unknown) =>
  createCashIOService(SHIFT, TERMINAL, USER, body, h.deps);

const is409 = (code: string) => (e: unknown) =>
  e instanceof HttpException &&
  e.statusCode === 409 &&
  (e.result as { code?: string }).code === code;

test("Cash In with an operationId stores it with the payload hash; result stays the row id", async () => {
  const h = harness();
  const res = await create(h, { type: "in", amount: 5000, operationId: OP });
  assert.deepEqual(res, { ok: true, msg: "Cash in out created", result: 1, replayed: false });
  assert.equal(h.persisted[0].operationId, OP);
  assert.deepEqual(h.persisted[0].dto, { type: "in", amount: 5000, note: undefined });
});

test("Cash In twice with a lost answer in between → one row, the retry replays it", async () => {
  const h = harness();
  const first = await create(h, { type: "in", amount: 5000, note: "float", operationId: OP });
  const retry = await create(h, { type: "in", amount: 5000, note: "float", operationId: OP });
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result, first.result);
  assert.equal(h.rows.length, 1);
  assert.equal(h.persisted.length, 1);
});

test("same operationId with another amount, type or note → 409 PAYLOAD_MISMATCH, nothing written", async () => {
  const h = harness();
  await create(h, { type: "in", amount: 5000, operationId: OP });
  for (const body of [
    { type: "in", amount: 5001, operationId: OP },
    { type: "out", amount: 5000, operationId: OP },
    { type: "in", amount: 5000, note: "x", operationId: OP },
  ]) {
    await assert.rejects(create(h, body), is409(OPERATION_CODES.PAYLOAD_MISMATCH));
  }
  assert.equal(h.rows.length, 1);
});

test("no operationId (older till) still works; each request is its own row", async () => {
  const h = harness();
  const a = await create(h, { type: "out", amount: 200 });
  const b = await create(h, { type: "out", amount: 200 });
  assert.equal(a.ok, true);
  assert.notEqual(a.result, b.result);
  assert.equal(h.rows.length, 2);
  assert.ok(h.persisted[0].operationId, "server-minted");
  assert.notEqual(h.persisted[0].operationId, h.persisted[1].operationId);
});

test("a malformed operationId is a 400 before anything is written", async () => {
  const h = harness();
  await assert.rejects(
    create(h, { type: "in", amount: 100, operationId: "short" }),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.persisted.length, 0);
});

test("the same id in flight → 409 OPERATION_IN_PROGRESS", async () => {
  const h = harness();
  assert.equal(claimOperation(OP), true);
  try {
    await assert.rejects(create(h, { type: "in", amount: 100, operationId: OP }), is409(OPERATION_CODES.IN_PROGRESS));
  } finally {
    releaseOperation(OP);
  }
  assert.equal(h.persisted.length, 0);
});

test("COMMIT landed but its ack was lost → the recorded row is returned", async () => {
  const h = harness();
  h.setPersist("commit-then-throw");
  const res = await create(h, { type: "in", amount: 100, operationId: OP });
  assert.equal(res.ok, true);
  assert.equal(res.result, 1);
  assert.equal(h.rows.length, 1);
});

test("a racing request committed the same id first (P2002) → replayed", async () => {
  const h = harness();
  h.setPersist("unique-race");
  const res = await create(h, { type: "in", amount: 100, operationId: OP });
  assert.equal(res.replayed, true);
  assert.equal(h.rows.length, 1);
});

test("a persistence failure with nothing committed is a 500; the retry records once", async () => {
  const h = harness();
  h.setPersist("fail");
  await assert.rejects(
    create(h, { type: "in", amount: 100, operationId: OP }),
    (e: unknown) => e instanceof HttpException && e.statusCode === 500,
  );
  h.setPersist("ok");
  const retry = await create(h, { type: "in", amount: 100, operationId: OP });
  assert.equal(retry.replayed, false);
  assert.equal(h.rows.length, 1);
});

test("shape guards still run first (negative amount → 400, nothing written)", async () => {
  const h = harness();
  await assert.rejects(
    create(h, { type: "in", amount: -5, operationId: OP }),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.persisted.length, 0);
});

// Older store servers (before T-10) build the row from parseCashIODto's output
// only — unchanged here — so an operationId from a newer till is dropped, not
// rejected. (The pre-T-10 SPEND service likewise copies named fields only.)
test("parseCashIODto ignores operationId (what an older server does with the field)", () => {
  assert.deepEqual(parseCashIODto({ type: "in", amount: 500, operationId: OP }), {
    type: "in",
    amount: 500,
    note: undefined,
  });
});

// T-10 review fix — the replay lookup runs before the open-shift requirement.

test("lost answer, then the shift closed → the retry still replays the recorded row", async () => {
  const h = harness();
  const first = await create(h, { type: "in", amount: 5000, operationId: OP });
  const retry = await createCashIOService(null, TERMINAL, USER, { type: "in", amount: 5000, operationId: OP }, h.deps);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result, first.result);
  assert.equal(h.rows.length, 1);
});

test("a new entry (no recorded id, or no id) without an open shift is still 404, nothing written", async () => {
  const h = harness();
  for (const body of [{ type: "in", amount: 100, operationId: OP }, { type: "in", amount: 100 }]) {
    await assert.rejects(
      createCashIOService(null, TERMINAL, USER, body, h.deps),
      (e: unknown) => e instanceof HttpException && e.statusCode === 404 && /Shift not found/.test(e.message),
    );
  }
  assert.equal(h.persisted.length, 0);
});

test("after the shift closed, the same id with another amount is still 409", async () => {
  const h = harness();
  await create(h, { type: "in", amount: 5000, operationId: OP });
  await assert.rejects(
    createCashIOService(null, TERMINAL, USER, { type: "in", amount: 4000, operationId: OP }, h.deps),
    is409(OPERATION_CODES.PAYLOAD_MISMATCH),
  );
});

test("a recorded entry is never replayed to another terminal → 409", async () => {
  const h = harness();
  await create(h, { type: "in", amount: 5000, operationId: OP });
  await assert.rejects(
    createCashIOService(SHIFT, { id: 2, name: "T2" } as Terminal, USER, { type: "in", amount: 5000, operationId: OP }, h.deps),
    is409(OPERATION_CODES.PAYLOAD_MISMATCH),
  );
  assert.equal(h.rows.length, 1);
});
