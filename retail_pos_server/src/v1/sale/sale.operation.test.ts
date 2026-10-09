import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import type { SaleInvoiceModel } from "../../generated/prisma/models";
import {
  createSaleService,
  type PersistSaleArgs,
  type SaleContext,
  type SaleCreateDeps,
} from "./sale.create.service";
import { normalizeOperationId, operationPayloadHash, releaseOperation } from "./sale.operation";
import type { SaleCreatePayload } from "./sale.types";
import { FakeCrm, FakeOpsStore } from "../customer-voucher/customer-voucher.test-fakes";
import {
  reconcileCustomerVoucherOperations,
  type ReconcileDeps,
} from "../customer-voucher/customer-voucher.reconcile.service";

// T-15 (platform/D-10) — R-3/V-1 sale operation identity and R-4/V-2 ledger
// states, with an in-memory CRM, ledger and invoice table (no DB, no network).

const CONTEXT = {
  terminal: { id: 1, name: "T1" },
  storeSetting: { companyId: 1 },
  user: { id: 9, name: "Kim" },
  shift: { id: 3 },
} as unknown as SaleContext;

const MEMBER = { id: "m-1", name: "Lee", level: 1, phoneLast4: "123" };

function salePayload(over: Partial<SaleCreatePayload> = {}): SaleCreatePayload {
  return {
    type: "SALE",
    member: MEMBER,
    linesTotal: 1000,
    rounding: 0,
    creditSurchargeAmount: 0,
    lineTax: 0,
    surchargeTax: 0,
    total: 1000,
    cashChange: 0,
    rows: [
      {
        index: 0,
        type: "NORMAL",
        itemId: 1,
        name_en: "Item",
        name_ko: "아이템",
        barcode: "1",
        uom: "ea",
        taxable: false,
        isPointExcluded: false,
        unit_price_original: 1000,
        unit_price_discounted: null,
        unit_price_adjusted: null,
        unit_price_effective: 1000,
        qty: 1000,
        measured_weight: null,
        total: 1000,
        tax_amount: 0,
        net: 1000,
        adjustments: [],
        ppMarkdownType: null,
        ppMarkdownAmount: null,
      },
    ],
    payments: [
      { type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7, entityLabel: "CV-7" },
      { type: "CASH", amount: 600 },
    ],
    ...over,
  };
}

function harness() {
  const crm = new FakeCrm();
  const ops = new FakeOpsStore();
  const invoices: SaleInvoiceModel[] = [];
  const invoicePayments = new Map<number, SaleCreatePayload["payments"]>();
  let persistMode: "ok" | "fail" | "hang" | "commit-then-throw" = "ok";
  let persistCalled: () => void = () => {};
  const persistReached = new Promise<void>((resolve) => (persistCalled = resolve));

  const deps: SaleCreateDeps = {
    crm,
    ops,
    findInvoiceByOperationId: async (operationId) =>
      invoices.find((inv) => inv.operationId === operationId) ?? null,
    findInvoiceByExternalOrderId: async () => null,
    persistSale: async (args: PersistSaleArgs) => {
      persistCalled();
      if (persistMode === "hang") return new Promise<SaleInvoiceModel>(() => {});
      if (persistMode === "fail") throw new Error("disk full");
      const invoice = {
        id: invoices.length + 1,
        type: "SALE",
        serial: `3-20261008-S${invoices.length + 1}`,
        total: args.payload.total,
        operationId: args.operationId,
        operationPayloadHash: args.payloadHash,
        externalOrderId: args.externalOrderId,
      } as unknown as SaleInvoiceModel;
      ops.link(args.linkOperationRowIds, invoice.id); // same tx as the invoice
      invoices.push(invoice);
      invoicePayments.set(invoice.id, args.payload.payments);
      if (persistMode === "commit-then-throw") {
        persistMode = "ok";
        throw new Error("Connection terminated unexpectedly"); // COMMIT landed, ack lost
      }
      return invoice;
    },
    afterCommit: async () => ({}),
  };
  const reconcileDeps = (minutesLater: number): ReconcileDeps => ({
    crm,
    ops,
    findInvoiceByOperationId: async (operationId) => {
      const inv = invoices.find((i) => i.operationId === operationId);
      if (!inv) return null;
      const payments = (invoicePayments.get(inv.id) ?? []).map((p) => ({
        type: p.type,
        amount: p.amount,
        entityType: p.entityType ?? null,
        entityId: p.entityId ?? null,
      }));
      return { id: inv.id, type: inv.type, payments };
    },
    now: () => new Date(Date.now() + minutesLater * 60_000),
  });
  return {
    crm,
    ops,
    invoices,
    deps,
    reconcileDeps,
    persistReached,
    setPersist: (mode: "ok" | "fail" | "hang" | "commit-then-throw") => (persistMode = mode),
  };
}

const OP = "11111111-2222-4333-8444-555555555555";
const KEY7 = `${OP}:cv:7:400`;

test("operationId format: UUID accepted, colon / short ids rejected", () => {
  assert.equal(normalizeOperationId(OP), OP);
  assert.equal(normalizeOperationId(undefined), null);
  assert.throws(() => normalizeOperationId("abc:def-1234"), HttpException);
  assert.throws(() => normalizeOperationId("short"), HttpException);
});

test("payload hash ignores operationId and key order", () => {
  const a = salePayload({ operationId: "aaaaaaaa-1" });
  const b = { ...salePayload(), operationId: "bbbbbbbb-2" };
  assert.equal(operationPayloadHash(a), operationPayloadHash(b));
  assert.notEqual(operationPayloadHash(a), operationPayloadHash(salePayload({ cashChange: 5 })));
});

test("success path: ledger INTENT → CONFIRMED → LINKED, one CRM debit", async () => {
  const h = harness();
  const res = await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.replayed, false);
  assert.deepEqual(h.ops.history.get(KEY7), ["INTENT", "CONFIRMED", "LINKED"]);
  assert.equal(h.ops.byKey(KEY7)!.invoiceId, res.result.id);
  assert.equal(h.crm.balances.get(7), 600);
});

test("lost-response retry returns the same invoice (replayed) and never debits twice", async () => {
  const h = harness();
  const first = await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  const retry = await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.id, first.result.id);
  assert.equal(h.invoices.length, 1);
  assert.equal(h.crm.balances.get(7), 600);
  assert.equal(h.crm.calls.filter((c) => c.startsWith("redeem")).length, 1);
});

test("same operationId with a different payload → 409, nothing written", async () => {
  const h = harness();
  await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP, note: "changed" }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 409,
  );
  assert.equal(h.invoices.length, 1);
});

test("two different operation ids → two invoices", async () => {
  const h = harness();
  const a = await createSaleService(salePayload({ operationId: "op-aaaaaaaa" }), CONTEXT, h.deps);
  const b = await createSaleService(salePayload({ operationId: "op-bbbbbbbb" }), CONTEXT, h.deps);
  assert.notEqual(a.result.id, b.result.id);
  assert.equal(h.invoices.length, 2);
  assert.equal(h.crm.balances.get(7), 200);
});

test("payload without operationId (old till / Runner) still works; server mints one each time", async () => {
  const h = harness();
  const a = await createSaleService(salePayload(), CONTEXT, h.deps);
  const b = await createSaleService(salePayload(), CONTEXT, h.deps);
  assert.equal(a.ok, true);
  assert.notEqual(a.result.operationId, b.result.operationId);
  assert.equal(h.invoices.length, 2);
});

test("CRM debits but the answer is lost → UNRESOLVED, 503; retry with the same id replays the key, one debit", async () => {
  const h = harness();
  h.crm.mode.redeem = ["unknown-after-effect"];
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED");
  assert.equal(h.invoices.length, 0);
  assert.equal(h.crm.balances.get(7), 600);

  const retry = await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(retry.ok, true);
  assert.equal(h.invoices.length, 1);
  assert.equal(h.crm.balances.get(7), 600, "CRM replayed the key instead of debiting again");
  assert.equal(h.ops.byKey(KEY7)!.status, "LINKED");
});

test("process exit between CONFIRMED and LINKED leaves the row CONFIRMED without invoice; the reconciler voids it", async () => {
  const h = harness();
  h.setPersist("hang");
  void createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  await h.persistReached;
  const row = h.ops.byKey(KEY7)!;
  assert.equal(row.status, "CONFIRMED");
  assert.equal(row.invoiceId, null);
  assert.equal(h.crm.balances.get(7), 600);

  // Restart: in-process claims are gone with the old process.
  releaseOperation(OP);
  const tooEarly = await reconcileCustomerVoucherOperations(h.reconcileDeps(0));
  assert.equal(tooEarly.checked, 0, "rows younger than 2 minutes are left alone");
  const summary = await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(summary.voided, 1);
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000, "member balance is back");
});

test("local failure → redeem voided → VOIDED; a retry of the same id is cancelled (409)", async () => {
  const h = harness();
  h.setPersist("fail");
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  assert.deepEqual(h.ops.history.get(KEY7), ["INTENT", "CONFIRMED", "VOIDED"]);
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.kind, "VOID_REDEEM");
  assert.equal(h.crm.balances.get(7), 1000);

  h.setPersist("ok");
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      (e.result as { code?: string }).code === "OPERATION_CANCELLED",
  );
  assert.equal(h.crm.balances.get(7), 1000);
});

test("void failure → UNRESOLVED (not only logged); the reconciler later voids it", async () => {
  const h = harness();
  h.setPersist("fail");
  h.crm.mode.voidRedeem = ["unknown"];
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED");
  assert.equal(h.crm.balances.get(7), 600);

  const summary = await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(summary.voided, 1);
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("partial multi-voucher failure: the first redeem is voided, the rejected one FAILED, 400", async () => {
  const h = harness();
  h.crm.balances.set(8, 100);
  const payload = salePayload({
    operationId: OP,
    payments: [
      { type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7 },
      { type: "VOUCHER", amount: 300, entityType: "customer-voucher", entityId: 8 },
      { type: "CASH", amount: 300 },
    ],
  });
  await assert.rejects(
    createSaleService(payload, CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.ops.byKey(`${OP}:cv:8:300`)!.status, "FAILED");
  assert.equal(h.crm.balances.get(7), 1000);
  assert.equal(h.invoices.length, 0);
});

test("CRM replays a voided redeem (V-12) → never read as payment: VOIDED, 409, no invoice", async () => {
  const h = harness();
  // A previous attempt redeemed and voided this key at CRM; the local row is gone.
  await h.crm.redeem({ memberId: "m-1", voucherId: 7, amount: 400, requestId: KEY7, entityType: "pos-sale-request", entityId: OP });
  await h.crm.voidRedeem({ redeemRequestId: KEY7, requestId: `${KEY7}:void` });
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 409,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.invoices.length, 0);
});

test("F-3: UNRESOLVED redeem whose retry gets 404 stays UNRESOLVED (503), and the reconciler later voids it", async () => {
  const h = harness();
  h.crm.mode.redeem = ["unknown-after-effect", "reject404"];
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED");
  assert.equal(h.crm.balances.get(7), 600, "CRM did debit");

  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED", "a rejected retry never marks FAILED");
  assert.equal(h.invoices.length, 0);

  const summary = await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(summary.voided, 1);
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000, "member balance is back");
});

test("F-3: a definitive rejection on the first call (no earlier attempt) still marks FAILED (400)", async () => {
  const h = harness();
  h.crm.mode.redeem = ["reject404"];
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400,
  );
  assert.equal(h.ops.byKey(KEY7)!.status, "FAILED");
});

test("F-6: lost redeem answer, then the cashier swaps the voucher for cash → 409 EFFECT_PENDING, never two charges; reconciler gives it back", async () => {
  const h = harness();
  h.crm.mode.redeem = ["unknown-after-effect"];
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 503,
  );
  assert.equal(h.crm.balances.get(7), 600, "CRM did debit");

  const cashOnly = salePayload({ operationId: OP, payments: [{ type: "CASH", amount: 1000 }] });
  await assert.rejects(
    createSaleService(cashOnly, CONTEXT, h.deps),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      (e.result as { code?: string }).code === "CUSTOMER_VOUCHER_EFFECT_PENDING",
  );
  assert.equal(h.invoices.length, 0, "no cash-only invoice under the pending id");

  // A different voucher amount is not the same effect either.
  await assert.rejects(
    createSaleService(
      salePayload({
        operationId: OP,
        payments: [
          { type: "VOUCHER", amount: 300, entityType: "customer-voucher", entityId: 7 },
          { type: "CASH", amount: 700 },
        ],
      }),
      CONTEXT,
      h.deps,
    ),
    (e: unknown) => e instanceof HttpException && e.statusCode === 409,
  );
  assert.equal(h.crm.balances.get(7), 600);

  // Cashier clears the cart (new attempt, new id): the reconciler voids the old debit.
  const summary = await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(summary.voided, 1);
  assert.equal(h.crm.balances.get(7), 1000);
  const fresh = await createSaleService(
    salePayload({ operationId: "op-cccccccc", payments: [{ type: "CASH", amount: 1000 }] }),
    CONTEXT,
    h.deps,
  );
  assert.equal(fresh.ok, true);
  assert.equal(h.crm.balances.get(7), 1000, "charged once: cash only");
});

test("F-6: putting the same voucher tender back after a lost answer replays the key and records one sale", async () => {
  const h = harness();
  h.crm.mode.redeem = ["unknown-after-effect"];
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  const retry = await createSaleService(salePayload({ operationId: OP, note: "same tender" }), CONTEXT, h.deps);
  assert.equal(retry.ok, true);
  assert.equal(h.crm.balances.get(7), 600);
  assert.equal(h.ops.byKey(KEY7)!.status, "LINKED");
});

test("F-8: the sale committed but its ack was lost (non-unique error) → redeem NOT voided, the Invoice is returned", async () => {
  const h = harness();
  h.setPersist("commit-then-throw");
  const res = await createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps);
  assert.equal(res.ok, true);
  assert.equal(res.result.id, h.invoices[0].id);
  assert.equal(h.ops.byKey(KEY7)!.status, "LINKED");
  assert.equal(h.crm.balances.get(7), 600, "charged once, not given back");
  assert.equal(h.crm.calls.filter((c) => c.startsWith("voidRedeem")).length, 0);
});

test("F-11: local failure + void answer lost → retry with the same payload is 409 EFFECT_PENDING, no Invoice; reconciler completes the void", async () => {
  const h = harness();
  h.setPersist("fail");
  h.crm.mode.voidRedeem = ["unknown"];
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "UNRESOLVED");

  h.setPersist("ok");
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      (e.result as { code?: string }).code === "CUSTOMER_VOUCHER_EFFECT_PENDING",
  );
  assert.equal(h.invoices.length, 0, "the still-active redeem never became payment");

  const summary = await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(summary.voided, 1);
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "CONFIRMED");
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("F-13: void timed out, the re-sent void gets 404 → void row stays UNRESOLVED and checkout stays 409; lookup 'voided' settles it", async () => {
  const h = harness();
  h.setPersist("fail");
  h.crm.mode.voidRedeem = ["unknown", "reject404"];
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "UNRESOLVED");

  // Reconciler: CRM still shows the redeem → re-sends the same void → 404.
  await reconcileCustomerVoucherOperations(h.reconcileDeps(3));
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "UNRESOLVED", "a rejected re-send never marks the void FAILED");
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED");

  h.setPersist("ok");
  await assert.rejects(
    createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps),
    (e: unknown) =>
      e instanceof HttpException &&
      e.statusCode === 409 &&
      (e.result as { code?: string }).code === "CUSTOMER_VOUCHER_EFFECT_PENDING",
  );
  assert.equal(h.invoices.length, 0);

  // The first void lands late at CRM; the next sweep's lookup says voided.
  await h.crm.voidRedeem({ redeemRequestId: KEY7, requestId: `${KEY7}:void` });
  await reconcileCustomerVoucherOperations(h.reconcileDeps(6));
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "CONFIRMED");
  assert.equal(h.ops.byKey(KEY7)!.status, "VOIDED");
  assert.equal(h.crm.balances.get(7), 1000);
});

test("F-13: a void refused on its FIRST send is FAILED (CRM did nothing); the primary stays UNRESOLVED", async () => {
  const h = harness();
  h.setPersist("fail");
  h.crm.mode.voidRedeem = ["reject404"];
  await assert.rejects(createSaleService(salePayload({ operationId: OP }), CONTEXT, h.deps));
  assert.equal(h.ops.byKey(`${KEY7}:void`)!.status, "FAILED");
  assert.equal(h.ops.byKey(KEY7)!.status, "UNRESOLVED");
});

test("F-24 D-14: a lost-response retry after a surcharge-rate change returns the recorded Sale; a new operation at the new rate is a 400", async () => {
  const h = harness();
  const card = (operationId: string) =>
    salePayload({
      operationId,
      member: null,
      creditSurchargeAmount: 15,
      surchargeTax: 1,
      total: 1015,
      payments: [{ type: "CREDIT", amount: 1015 }],
    });
  const at = (rate: number) =>
    ({ ...CONTEXT, storeSetting: { companyId: 1, credit_surcharge_rate: rate } }) as unknown as SaleContext;

  const first = await createSaleService(card(OP), at(15), h.deps);
  assert.equal(first.replayed, false);
  const retry = await createSaleService(card(OP), at(20), h.deps);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.id, first.result.id);
  assert.equal(h.invoices.length, 1);

  await assert.rejects(
    createSaleService(card("op-cccccccc"), at(20), h.deps),
    (e: unknown) => e instanceof HttpException && e.statusCode === 400 && /creditSurchargeAmount mismatch/.test(e.message),
  );
  assert.equal(h.invoices.length, 1);
});
