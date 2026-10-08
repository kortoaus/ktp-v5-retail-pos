import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { parseCashIODto } from "./cashio.service";

// R-9 — CashIO shape guard (pure; no DB).

test("valid cash in / out pass", () => {
  assert.deepEqual(parseCashIODto({ type: "in", amount: 500 }), {
    type: "in",
    amount: 500,
    note: undefined,
  });
  assert.deepEqual(parseCashIODto({ type: "out", amount: 1, note: "float" }), {
    type: "out",
    amount: 1,
    note: "float",
  });
});

test("CashIO amount -5 → 400", () => {
  assert.throws(
    () => parseCashIODto({ type: "in", amount: -5 }),
    (e: unknown) => e instanceof BadRequestException && e.statusCode === 400,
  );
});

test("amount must be a safe integer > 0", () => {
  for (const amount of [0, 1.5, "500", null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseCashIODto({ type: "in", amount }), BadRequestException);
  }
});

test("type must be exactly in | out", () => {
  for (const type of ["IN", "Out", "refund", "", null, undefined]) {
    assert.throws(() => parseCashIODto({ type, amount: 500 }), /type must be/);
  }
  assert.throws(() => parseCashIODto(null), BadRequestException);
  assert.throws(() => parseCashIODto({ type: "in", amount: 5, note: 3 }), /note/);
});
