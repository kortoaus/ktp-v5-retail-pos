import assert from "node:assert/strict";
import test from "node:test";

import type { SaleInvoiceModel } from "../../generated/prisma/models";
import { createSaleService, type PersistSaleArgs, type SaleContext, type SaleCreateDeps } from "./sale.create.service";
import { substituteIssuedVoucher } from "./sale.refund.service";
import { applyCrmRedeemResults, type ConfirmedRedeemRow } from "../customer-voucher/customer-voucher.operation";
import { buildInvoicePayload, type PendingInvoice } from "../cloud/cloud.sync.service";
import type { PaymentPayload, SaleCreatePayload } from "./sale.types";
import { FakeCrm, FakeOpsStore } from "../customer-voucher/customer-voucher.test-fakes";
import { HttpException } from "../../libs/exceptions";

// T-25 (platform, T-14 V-7 / audit O-17) — the CRM event id of a customer-voucher
// tender is kept on the ledger row AND the Invoice payment, the receipt label
// comes from CRM's answer, and the cloud invoice DTO carries the id.

const CONTEXT = {
  terminal: { id: 1, name: "T1" },
  storeSetting: { companyId: 1 },
  user: { id: 9, name: "Kim" },
  shift: { id: 3 },
} as unknown as SaleContext;

const OP = "aaaaaaaa-2222-4333-8444-555555555555";
const KEY7 = `${OP}:cv:7:400`;

function salePayload(payments?: PaymentPayload[]): SaleCreatePayload {
  return {
    type: "SALE",
    member: { id: "m-1", name: "Lee", level: 1, phoneLast4: "123" },
    linesTotal: 1000,
    rounding: 0,
    creditSurchargeAmount: 0,
    lineTax: 0,
    surchargeTax: 0,
    total: 1000,
    cashChange: 0,
    rows: [
      {
        index: 0, type: "NORMAL", itemId: 1, name_en: "Item", name_ko: "아이템", barcode: "1", uom: "ea",
        taxable: false, isPointExcluded: false, unit_price_original: 1000, unit_price_discounted: null,
        unit_price_adjusted: null, unit_price_effective: 1000, qty: 1000, measured_weight: null,
        total: 1000, tax_amount: 0, net: 1000, adjustments: [], ppMarkdownType: null, ppMarkdownAmount: null,
      },
    ],
    payments: payments ?? [
      // the till's label is ignored; a forged crmEventId on cash is dropped
      { type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7, entityLabel: "anything the till says", crmEventId: 999 },
      { type: "CASH", amount: 600, crmEventId: 998 },
    ],
    operationId: OP,
  };
}

function harness() {
  const crm = new FakeCrm();
  const ops = new FakeOpsStore();
  const invoices: SaleInvoiceModel[] = [];
  const persisted: PersistSaleArgs[] = [];
  const deps: SaleCreateDeps = {
    crm,
    ops,
    findInvoiceByOperationId: async (operationId) => invoices.find((i) => i.operationId === operationId) ?? null,
    findInvoiceByExternalOrderId: async () => null,
    persistSale: async (args) => {
      persisted.push(args);
      const invoice = {
        id: invoices.length + 1,
        type: "SALE",
        operationId: args.operationId,
        operationPayloadHash: args.payloadHash,
      } as unknown as SaleInvoiceModel;
      ops.link(args.linkOperationRowIds, invoice.id);
      invoices.push(invoice);
      return invoice;
    },
    afterCommit: async () => ({}),
  };
  return { crm, ops, invoices, persisted, deps };
}

test("redeem stores the CRM event id on the ledger row and the Invoice payment; label from CRM", async () => {
  const h = harness();
  await createSaleService(salePayload(), CONTEXT, h.deps);
  const row = h.ops.byKey(KEY7)!;
  assert.equal(typeof row.crmEventId, "number");
  const [cv, cash] = h.persisted[0].payload.payments;
  assert.equal(cv.crmEventId, row.crmEventId, "payment carries the ledger's CRM event id");
  assert.equal(cv.entityLabel, "CV-SEVEN (exp 31/12/2026)", "label is CRM's, not the till's");
  assert.equal(cash.crmEventId, null, "other tenders carry no CRM event id");
});

test("CRM answer without a label → server-built label, never the till's", async () => {
  const h = harness();
  h.crm.labels.set(7, null);
  await createSaleService(salePayload(), CONTEXT, h.deps);
  assert.equal(h.persisted[0].payload.payments[0].entityLabel, "Customer Voucher #7");
});

test("replay keeps the original CRM event id (answer lost after the debit, then retry)", async () => {
  const h = harness();
  h.crm.mode.redeem = ["unknown-after-effect"];
  await assert.rejects(createSaleService(salePayload(), CONTEXT, h.deps), (e: unknown) => e instanceof HttpException && e.statusCode === 503);
  const originalEventId = h.crm.redeems.get(KEY7)!.eventId;
  const res = await createSaleService(salePayload(), CONTEXT, h.deps);
  assert.equal(res.ok, true);
  assert.equal(h.ops.byKey(KEY7)!.crmEventId, originalEventId);
  assert.equal(h.persisted[0].payload.payments[0].crmEventId, originalEventId);
  assert.equal(h.crm.balances.get(7), 600, "one debit only");
  // a further lost-response retry replays the recorded invoice; nothing new is persisted
  const again = await createSaleService(salePayload(), CONTEXT, h.deps);
  assert.equal(again.replayed, true);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.ops.byKey(KEY7)!.crmEventId, originalEventId);
});

test("applyCrmRedeemResults refuses a customer-voucher tender with no confirmed redeem", () => {
  assert.throws(
    () => applyCrmRedeemResults(OP, [{ type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7 }], []),
    HttpException,
  );
  const rows = [{ crmRequestId: KEY7, crmEventId: 41, crmVoucherLabel: "L" } as ConfirmedRedeemRow];
  const [p] = applyCrmRedeemResults(OP, [{ type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7 }], rows);
  assert.equal(p.crmEventId, 41);
});

test("refund: the issued refund voucher's REFUND_ISSUE event id rides on its payment", () => {
  const payments: PaymentPayload[] = [
    { type: "CASH", amount: 100 },
    { type: "VOUCHER", amount: 300, entityType: "customer-voucher", crmEventId: 999 },
  ];
  const out = substituteIssuedVoucher(payments, {
    tenderIndex: 1,
    issued: {
      row: { crmEventId: 77 } as ConfirmedRedeemRow,
      voucher: { id: 501, label: "CV-R (exp 30/11/2027)" } as never,
    },
  });
  assert.equal(out[1].crmEventId, 77);
  assert.equal(out[1].entityId, 501);
  assert.equal(out[1].entityLabel, "CV-R (exp 30/11/2027)");
  assert.equal(out[0].crmEventId, undefined);
});

test("cloud invoice DTO carries crmEventId per payment", () => {
  const inv = {
    id: 5,
    rows: [],
    payments: [
      { type: "VOUCHER", amount: 400, entityType: "customer-voucher", entityId: 7, entityLabel: "CV-SEVEN", crmEventId: 41 },
      { type: "CASH", amount: 600, entityType: null, entityId: null, entityLabel: null, crmEventId: null },
    ],
  } as unknown as PendingInvoice;
  const dto = buildInvoicePayload(inv, null);
  assert.equal(dto.payments[0].crmEventId, 41);
  assert.equal(dto.payments[1].crmEventId, null);
});
