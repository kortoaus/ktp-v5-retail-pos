import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import { isUniqueViolation } from "../../libs/prisma-errors";
import {
  redeemUserVoucherInTx,
  voucherIneligibility,
  type VoucherEligibilityRow,
  type VoucherRedeemTx,
} from "./voucher.redeem";

// R-2 — pure-logic tests with a fake tx (no DB). The fake applies each
// updateMany's WHERE + decrement as one step, the way Postgres re-checks the
// WHERE of a waiting UPDATE after the first one commits.

const NOW = new Date("2026-10-08T03:00:00Z");

function store(initial: VoucherEligibilityRow) {
  const row = { ...initial };
  const calls: string[] = [];
  const tx: VoucherRedeemTx = {
    voucher: {
      async updateMany({ where, data }) {
        calls.push("updateMany");
        await new Promise((r) => setImmediate(r)); // interleave callers
        const ok =
          row.id === where.id &&
          row.status === where.status &&
          row.validFrom <= where.validFrom.lte &&
          row.validTo >= where.validTo.gte &&
          row.balance >= where.balance.gte;
        if (!ok) return { count: 0 };
        row.balance -= data.balance.decrement;
        return { count: 1 };
      },
      async findUnique({ where }) {
        return where.id === row.id ? { ...row } : null;
      },
    },
  };
  return { row, tx, calls };
}

const ACTIVE: VoucherEligibilityRow = {
  id: 5,
  status: "ACTIVE",
  validFrom: new Date("2026-10-07T13:00:00Z"),
  validTo: new Date("2026-10-08T12:59:59.999Z"),
  balance: 1000,
};

test("two concurrent redeems of 700 against 1000 → exactly one succeeds, balance 300", async () => {
  const { row, tx } = store(ACTIVE);
  // Both pass the old read-then-write pre-check (both see 1000)...
  assert.equal(voucherIneligibility(ACTIVE, 700, NOW), null);
  assert.equal(voucherIneligibility(ACTIVE, 700, NOW), null);
  // ...but the conditional decrement decides.
  const results = await Promise.allSettled([
    redeemUserVoucherInTx(tx, 5, 700, NOW),
    redeemUserVoucherInTx(tx, 5, 700, NOW),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof BadRequestException);
  assert.equal(
    failed[0].reason.message,
    "voucher 5 insufficient: balance 300 < requested 700",
  );
  assert.equal(row.balance, 300);
});

test("ineligible voucher → same messages as the pre-check, balance untouched", async () => {
  const cases: [Partial<VoucherEligibilityRow>, string][] = [
    [{ status: "EXPIRED" }, "voucher 5 is expired, not ACTIVE"],
    [{ validFrom: new Date("2026-10-09T00:00:00Z") }, "voucher 5 not yet valid"],
    [{ validTo: new Date("2026-10-08T00:00:00Z") }, "voucher 5 expired"],
    [{ balance: 100 }, "voucher 5 insufficient: balance 100 < requested 700"],
  ];
  for (const [over, msg] of cases) {
    const v = { ...ACTIVE, ...over };
    const { row, tx } = store(v);
    await assert.rejects(redeemUserVoucherInTx(tx, 5, 700, NOW), (e: unknown) => {
      assert.ok(e instanceof BadRequestException);
      assert.equal(e.message, msg);
      return true;
    });
    assert.equal(voucherIneligibility(v, 700, NOW)?.message, msg);
    assert.equal(row.balance, v.balance);
  }
});

test("missing voucher → 404 with the pre-check text", async () => {
  const { tx } = store(ACTIVE);
  await assert.rejects(redeemUserVoucherInTx(tx, 6, 100, NOW), (e: unknown) => {
    assert.ok(e instanceof NotFoundException);
    assert.equal(e.message, "voucher 6 not found");
    return true;
  });
});

test("exact balance spend succeeds and leaves 0", async () => {
  const { row, tx, calls } = store(ACTIVE);
  await redeemUserVoucherInTx(tx, 5, 1000, NOW);
  assert.equal(row.balance, 0);
  assert.deepEqual(calls, ["updateMany"]);
});

test("daily issue: P2002 is recognised as a unique violation", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation({ code: "P2025" }), false);
  assert.equal(isUniqueViolation(new Error("x")), false);
  assert.equal(isUniqueViolation(null), false);
});
