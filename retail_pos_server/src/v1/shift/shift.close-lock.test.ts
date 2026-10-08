import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma, Terminal, User } from "../../generated/prisma/client";
import { HttpException } from "../../libs/exceptions";
import { assertShiftOpenInTx } from "./shift.lock";
import {
  closeTerminalShiftService,
  type ShiftAggregate,
  type ShiftCloseDeps,
} from "./shift.service";

// T-24 (audit R-7) — shift close vs an in-flight sale, with a fake database
// that models Postgres row locks (FOR SHARE / FOR UPDATE, READ COMMITTED:
// a lock taken after waiting sees the latest committed row). No real DB —
// pos-retail has no isolated test database, so the true race is not run here.

const SHIFT_ID = 3;
const TERMINAL_ID = 1;

function zeroAggregate(): ShiftAggregate {
  return {
    salesCash: 0,
    salesCredit: 0,
    salesUserVoucher: 0,
    salesCustomerVoucher: 0,
    salesGiftcard: 0,
    salesLinesTotal: 0,
    salesRounding: 0,
    salesCount: 0,
    repayCount: 0,
    salesCreditSurcharge: 0,
    salesTax: 0,
    refundsCash: 0,
    refundsCredit: 0,
    refundsUserVoucher: 0,
    refundsCustomerVoucher: 0,
    refundsGiftcard: 0,
    refundsLinesTotal: 0,
    refundsRounding: 0,
    refundsCount: 0,
    refundsCreditSurcharge: 0,
    refundsTax: 0,
    spendCount: 0,
    spendRetailValue: 0,
    totalCashIn: 0,
    totalCashOut: 0,
  };
}

type FakeTx = {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  terminalShift: {
    findFirst(args: { where: { terminalId: number } }): Promise<{ id: number } | null>;
    findUniqueOrThrow(): Promise<{ startedCash: number }>;
    update(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  insertInvoice(inv: { shiftId: number; total: number }): void;
};

class FakeLockingDb {
  shift = {
    id: SHIFT_ID,
    terminalId: TERMINAL_ID,
    startedCash: 10_000,
    closedAt: null as Date | null,
    totals: null as Record<string, unknown> | null,
  };
  invoices: Array<{ shiftId: number; total: number }> = [];
  private exclusive: number | null = null;
  private shared = new Set<number>();
  private waiters: Array<() => void> = [];
  private seq = 0;
  lockLog: string[] = [];

  private async acquire(tx: number, mode: "share" | "update") {
    for (;;) {
      const ok =
        mode === "share"
          ? this.exclusive == null || this.exclusive === tx
          : (this.exclusive == null || this.exclusive === tx) &&
            [...this.shared].every((h) => h === tx);
      if (ok) break;
      await new Promise<void>((r) => this.waiters.push(r));
    }
    if (mode === "share") this.shared.add(tx);
    else this.exclusive = tx;
    this.lockLog.push(`tx${tx}:${mode}`);
  }

  private release(tx: number) {
    this.shared.delete(tx);
    if (this.exclusive === tx) this.exclusive = null;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }

  transaction = async <R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> => {
    const id = ++this.seq;
    const pending = {
      invoices: [] as Array<{ shiftId: number; total: number }>,
      shiftUpdate: null as Record<string, unknown> | null,
    };
    const tx: FakeTx = {
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join("?");
        const mode = /FOR UPDATE/.test(sql) ? "update" : /FOR SHARE/.test(sql) ? "share" : null;
        if (!mode || values[0] !== this.shift.id) throw new Error(`unexpected SQL: ${sql}`);
        await this.acquire(id, mode);
        return [{ id: this.shift.id, closedAt: this.shift.closedAt }];
      },
      terminalShift: {
        findFirst: async ({ where }) =>
          this.shift.closedAt == null && this.shift.terminalId === where.terminalId
            ? { id: this.shift.id }
            : null,
        findUniqueOrThrow: async () => ({ startedCash: this.shift.startedCash }),
        update: async ({ data }) => {
          pending.shiftUpdate = data;
          return { ...this.shift, ...data };
        },
      },
      insertInvoice: (inv) => pending.invoices.push(inv),
    };
    try {
      const result = await fn(tx as unknown as Prisma.TransactionClient);
      // commit
      this.invoices.push(...pending.invoices);
      if (pending.shiftUpdate) {
        this.shift.closedAt = pending.shiftUpdate.closedAt as Date;
        this.shift.totals = pending.shiftUpdate;
      }
      return result;
    } finally {
      this.release(id);
    }
  };

  // Committed rows only (READ COMMITTED snapshot per statement).
  aggregate = async (): Promise<ShiftAggregate> => {
    const mine = this.invoices.filter((i) => i.shiftId === SHIFT_ID);
    return {
      ...zeroAggregate(),
      salesCount: mine.length,
      salesCash: mine.reduce((s, i) => s + i.total, 0),
    };
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

// The financial writers' shape: shift row FOR SHARE first, then the insert.
function saleWriter(db: FakeLockingDb, midPayment: Promise<void>) {
  return db.transaction(async (tx) => {
    await assertShiftOpenInTx(tx, SHIFT_ID, "sale");
    await midPayment;
    (tx as unknown as FakeTx).insertInvoice({ shiftId: SHIFT_ID, total: 500 });
    return "committed";
  });
}

function closeDeps(db: FakeLockingDb, aggregateGate?: Promise<void>): ShiftCloseDeps {
  return {
    transaction: db.transaction,
    aggregate: async () => {
      if (aggregateGate) await aggregateGate;
      return db.aggregate();
    },
    now: () => new Date("2026-10-09T07:00:00.000Z"),
    afterClose: () => {},
    countOpenCustomerVoucherOperations: async () => 0,
  };
}

const TERMINAL = { id: TERMINAL_ID, name: "T1" } as Terminal;
const USER = { id: 9, name: "Kim" } as User;

test("a sale that locked first and commits after close started is counted in the close", async () => {
  const db = new FakeLockingDb();
  const midPayment = deferred();
  const sale = saleWriter(db, midPayment.promise);
  await tick(); // sale holds the shift row FOR SHARE

  const close = closeTerminalShiftService(TERMINAL, USER, { endedCashActual: 10_500 }, closeDeps(db));
  await tick();
  await tick();
  assert.equal(db.shift.closedAt, null, "close waits for the in-flight sale");

  midPayment.resolve();
  assert.equal(await sale, "committed");
  const closed = await close;

  assert.equal(db.invoices.length, 1);
  assert.equal(closed.result.salesCount, 1, "the sale is in the closed totals");
  assert.equal(closed.result.salesCash, 500);
  assert.equal(closed.result.endedCashExpected, 10_500);
  assert.deepEqual(db.lockLog, ["tx1:share", "tx2:update"]);
});

test("a sale that arrives while close holds the lock is rejected with the shift-closed error", async () => {
  const db = new FakeLockingDb();
  const aggregating = deferred();
  const close = closeTerminalShiftService(
    TERMINAL,
    USER,
    { endedCashActual: 10_000 },
    closeDeps(db, aggregating.promise),
  );
  await tick(); // close holds the shift row FOR UPDATE, aggregating

  const midPayment = deferred();
  midPayment.resolve();
  const sale = saleWriter(db, midPayment.promise).then(
    () => null,
    (e: unknown) => e,
  );
  await tick();
  aggregating.resolve();

  const closed = await close;
  const err = await sale;

  assert.ok(err instanceof HttpException, "sale rejected");
  assert.equal((err as HttpException).statusCode, 400);
  assert.equal((err as HttpException).message, "No open shift — sale cannot be created");
  assert.equal(db.invoices.length, 0, "nothing written under a closed shift");
  assert.equal(closed.result.salesCount, 0);
  assert.ok(db.shift.closedAt);
});

test("a second close of the same shift answers 'No open shift found'", async () => {
  const db = new FakeLockingDb();
  await closeTerminalShiftService(TERMINAL, USER, { endedCashActual: 0 }, closeDeps(db));
  await assert.rejects(
    closeTerminalShiftService(TERMINAL, USER, { endedCashActual: 0 }, closeDeps(db)),
    /No open shift found/,
  );
});
