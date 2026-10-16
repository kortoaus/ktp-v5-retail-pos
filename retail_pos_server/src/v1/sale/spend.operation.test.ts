import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import type { SaleInvoiceModel } from "../../generated/prisma/models";
import {
  createSpendService,
  type PersistSpendArgs,
  type SpendContext,
  type SpendCreateDeps,
} from "./spend.create.service";
import { OPERATION_CODES, claimOperation, releaseOperation } from "./sale.operation";
import type { SaleCreatePayload } from "./sale.types";

// T-10 (retail-runner, F-27) — SPEND operation identity: the sale discipline
// (sale.operation.test.ts) with an in-memory invoice table (no DB).

const CONTEXT = {
  terminal: { id: 1, name: "T1" },
  storeSetting: { companyId: 1 },
  user: { id: 9, name: "Kim" },
  shift: { id: 3 },
} as unknown as SpendContext;

function spendPayload(over: Partial<SaleCreatePayload> = {}): SaleCreatePayload {
  return {
    type: "SPEND",
    member: null,
    linesTotal: 0,
    rounding: 0,
    creditSurchargeAmount: 0,
    lineTax: 0,
    surchargeTax: 0,
    total: 0,
    cashChange: 0,
    rows: [
      {
        index: 0,
        type: "NORMAL",
        itemId: 1,
        name_en: "Milk",
        name_ko: "우유",
        barcode: "1",
        uom: "ea",
        taxable: false,
        isPointExcluded: false,
        unit_price_original: 450,
        unit_price_discounted: null,
        unit_price_adjusted: 0,
        unit_price_effective: 0,
        qty: 1000,
        measured_weight: null,
        total: 0,
        tax_amount: 0,
        net: 0,
        adjustments: [],
        ppMarkdownType: null,
        ppMarkdownAmount: null,
      },
    ],
    payments: [],
    ...over,
  };
}

type PersistMode = "ok" | "fail" | "commit-then-throw" | "unique-race";

function harness() {
  const invoices: SaleInvoiceModel[] = [];
  const persisted: PersistSpendArgs[] = [];
  let mode: PersistMode = "ok";
  const record = (args: PersistSpendArgs, type = "SPEND") => {
    const invoice = {
      id: invoices.length + 1,
      type,
      serial: `3-20261016-P${invoices.length + 1}`,
      total: 0,
      operationId: args.operationId,
      operationPayloadHash: args.payloadHash,
    } as unknown as SaleInvoiceModel;
    invoices.push(invoice);
    return invoice;
  };
  const deps: SpendCreateDeps = {
    findInvoiceByOperationId: async (operationId) =>
      invoices.find((inv) => inv.operationId === operationId) ?? null,
    persistSpend: async (args) => {
      persisted.push(args);
      if (mode === "fail") throw new Error("disk full");
      if (mode === "commit-then-throw") {
        mode = "ok";
        record(args);
        throw new Error("Connection terminated unexpectedly"); // COMMIT landed, ack lost
      }
      if (mode === "unique-race") {
        mode = "ok";
        record(args); // a racing request committed the same id first
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      return record(args);
    },
  };
  return {
    invoices,
    persisted,
    deps,
    record,
    setPersist: (m: PersistMode) => (mode = m),
  };
}

const OP = "aaaaaaaa-1111-4222-8333-444444444444";

const is409 = (code: string) => (e: unknown) =>
  e instanceof HttpException &&
  e.statusCode === 409 &&
  (e.result as { code?: string }).code === code;

test("SPEND with an operationId stores it with the payload hash", async () => {
  const h = harness();
  const res = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.replayed, false);
  assert.equal(res.result.operationId, OP);
  assert.equal(h.persisted[0].operationId, OP);
  assert.equal(typeof h.persisted[0].payloadHash, "string");
});

test("lost-answer retry returns the same SPEND invoice (replayed), one row", async () => {
  const h = harness();
  const first = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  const retry = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.replayed, true);
  assert.equal(retry.result.id, first.result.id);
  assert.equal(h.invoices.length, 1);
  assert.equal(h.persisted.length, 1, "the replay never reaches the write");
});

test("same operationId with a different payload → 409 PAYLOAD_MISMATCH, nothing written", async () => {
  const h = harness();
  await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  await assert.rejects(
    createSpendService(spendPayload({ operationId: OP, note: "kitchen" }), CONTEXT, h.deps),
    is409(OPERATION_CODES.PAYLOAD_MISMATCH),
  );
  assert.equal(h.invoices.length, 1);
});

test("the id already belongs to a SALE from that cart → 409 PAYLOAD_MISMATCH naming the invoice, no SPEND", async () => {
  const h = harness();
  h.record({ payload: spendPayload(), context: CONTEXT, operationId: OP, payloadHash: "sale-hash" }, "SALE");
  await assert.rejects(
    createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) =>
      is409(OPERATION_CODES.PAYLOAD_MISMATCH)(e) && /recorded as SALE invoice 3-20261016-P1/.test((e as Error).message),
  );
  assert.equal(h.invoices.length, 1);
});

test("payload without operationId (older till) still works; server mints one each time", async () => {
  const h = harness();
  const a = await createSpendService(spendPayload(), CONTEXT, h.deps);
  const b = await createSpendService(spendPayload(), CONTEXT, h.deps);
  assert.equal(a.ok, true);
  assert.equal(a.replayed, false);
  assert.ok(a.result.operationId);
  assert.notEqual(a.result.operationId, b.result.operationId);
  assert.equal(h.invoices.length, 2);
});

test("a malformed operationId is a 400 before anything is written", async () => {
  const h = harness();
  await assert.rejects(
    createSpendService(spendPayload({ operationId: "bad:id-1234" }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.persisted.length, 0);
});

test("the same id in flight → 409 OPERATION_IN_PROGRESS", async () => {
  const h = harness();
  assert.equal(claimOperation(OP), true);
  try {
    await assert.rejects(
      createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps),
      is409(OPERATION_CODES.IN_PROGRESS),
    );
  } finally {
    releaseOperation(OP);
  }
  assert.equal(h.persisted.length, 0);
});

test("COMMIT landed but its ack was lost → the recorded SPEND is returned, not a 500", async () => {
  const h = harness();
  h.setPersist("commit-then-throw");
  const res = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.result.id, h.invoices[0].id);
  assert.equal(h.invoices.length, 1);
});

test("a racing request committed the same id first (P2002) → replayed", async () => {
  const h = harness();
  h.setPersist("unique-race");
  const res = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(res.replayed, true);
  assert.equal(h.invoices.length, 1);
});

test("a persistence failure with nothing committed is a 500 and the retry records once", async () => {
  const h = harness();
  h.setPersist("fail");
  await assert.rejects(
    createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 500,
  );
  assert.equal(h.invoices.length, 0);
  h.setPersist("ok");
  const retry = await createSpendService(spendPayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(retry.replayed, false);
  assert.equal(h.invoices.length, 1);
});

test("SPEND shape guards still run first (payments → 400)", async () => {
  const h = harness();
  await assert.rejects(
    createSpendService(
      spendPayload({ operationId: OP, payments: [{ type: "CASH", amount: 100 }] }),
      CONTEXT,
      h.deps,
    ),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.persisted.length, 0);
});
